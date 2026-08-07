/**
 * Live GitHub crawl (docs/07 §4/§6/§7). `listInstallationRepos` powers plan() — one
 * scope per repo (bounded, resumable). `crawlRepo` fetches a repo's structural files
 * (CODEOWNERS, manifests, workflows) and recent PRs, and yields the repo node plus the
 * workflow/PR nodes AND the target nodes (team/user/package) the repo's edges point at —
 * so those observed edges resolve within the scope (docs/07 §7.2/§7.3).
 */
import type { ResourceRef } from "@atlas/connector-sdk";
import type { GithubClient } from "./client";
import { parseCodeowners, distinctOwners } from "../parsers/codeowners";
import { parseManifest } from "../parsers/manifest";

export interface Discovered {
  ref: ResourceRef;
  payload: unknown;
}

const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
const MANIFEST_PATHS = ["package.json", "requirements.txt", "go.mod"];
const PR_BACKFILL = 30;
/** Max changed files collected per PR (CH2). The old single-page request kept only the first 100,
 *  silently dropping the rest — which could lose the very file that links a PR to a service (r6/r18).
 *  We now page (100/page) up to this bound: generous enough that real PRs are captured whole, while a
 *  pathological mega-PR still can't bloat the graph (GitHub's own files endpoint caps at 3000). */
const MAX_PR_FILES = 600;

export async function listInstallationRepos(
  client: GithubClient,
): Promise<Array<{ owner: string; repo: string }>> {
  const out: Array<{ owner: string; repo: string }> = [];
  for await (const r of client.paginate<{ name?: string; owner?: { login?: string } }>(
    "/installation/repositories",
    { itemsKey: "repositories" },
  )) {
    if (r.name && r.owner?.login) out.push({ owner: r.owner.login, repo: r.name });
  }
  return out;
}

/**
 * Resolve a CODEOWNERS team to its members (US-10, docs/07 §7.2).
 *
 * Without this, CODEOWNERS gives you "this repo is owned by @acme/platform" — a label, not a set of
 * people. During an incident the question is "who do I actually talk to", and a team name doesn't
 * answer it. Membership turns ownership into contactable humans.
 *
 * Returns [] rather than throwing when the read isn't possible. `members:read` is an ORG-level
 * permission a customer can decline while still granting everything else, so a 403 here is a
 * legitimate configuration, not a failure — and failing the scope would throw away the repo, PR and
 * workflow data we did get. Missing membership is surfaced honestly through the existing
 * `missingPermissions` path (connection → `degraded`), and a missing edge beats a wrong one (P3).
 */
export async function listTeamMembers(
  client: GithubClient,
  org: string,
  slug: string,
): Promise<string[]> {
  const logins: string[] = [];
  try {
    for await (const m of client.paginate<{ login?: string }>(
      `/orgs/${org}/teams/${slug}/members`,
    )) {
      if (m.login) logins.push(m.login);
    }
  } catch {
    return [];
  }
  return logins;
}

export async function* crawlRepo(
  client: GithubClient,
  owner: string,
  repo: string,
  scopeKey: string,
): AsyncGenerator<Discovered> {
  const ref = (externalId: string, kind: string): ResourceRef => ({ scopeKey, externalId, kind });

  const repoDetail = (await client.request<GithubRepo>(`/repos/${owner}/${repo}`)).data;

  const codeowners = await firstContent(client, owner, repo, CODEOWNERS_PATHS);
  const manifests: Array<{ path: string; content: string }> = [];
  for (const path of MANIFEST_PATHS) {
    const content = await tryContent(client, owner, repo, path);
    if (content != null) manifests.push({ path, content });
  }

  // Repo node (carries codeowners + manifests so its module emits OWNED_BY / DEPENDS_ON_PKG).
  yield {
    ref: ref("repo", "github.repository"),
    payload: {
      owner,
      repo,
      data: {
        defaultBranch: repoDetail.default_branch,
        visibility: repoDetail.visibility,
        language: repoDetail.language ?? null,
        topics: repoDetail.topics ?? [],
        archived: repoDetail.archived ?? false,
        pushedAt: repoDetail.pushed_at,
      },
      codeowners,
      manifests,
    },
  };

  // Workflow nodes.
  for (const file of await listWorkflowFiles(client, owner, repo)) {
    const content = await tryContent(client, owner, repo, file.path);
    if (content == null) continue;
    yield {
      ref: ref(`wf:${file.path}`, "github.workflow"),
      payload: { owner, repo, path: file.path, content, data: { name: file.name } },
    };
  }

  // Target nodes for the repo's observed edges (so they resolve in-scope).
  for (const o of distinctOwners(parseCodeowners(codeowners ?? ""))) {
    if (o.type === "team") {
      // Resolve the team to its people (US-10). The members ride on the team payload so its module
      // can emit HAS_MEMBER, and each member is also yielded as a user node so those edges resolve
      // in-scope — the same pattern the repo's OWNED_BY targets follow.
      const members = await listTeamMembers(client, o.org, o.slug);
      yield {
        ref: ref(`team:${o.org}/${o.slug}`, "github.team"),
        payload: { owner: o.org, data: { slug: o.slug }, members },
      };
      for (const login of members) {
        yield { ref: ref(`user:${login}`, "github.user"), payload: { data: { login } } };
      }
    } else {
      yield { ref: ref(`user:${o.login}`, "github.user"), payload: { data: { login: o.login } } };
    }
  }
  const seenPkg = new Set<string>();
  for (const m of manifests) {
    for (const dep of parseManifest(m.path, m.content)) {
      const key = `${dep.ecosystem}:${dep.name}`;
      if (seenPkg.has(key)) continue;
      seenPkg.add(key);
      yield {
        ref: ref(`pkg:${key}`, "external.package"),
        payload: { ecosystem: dep.ecosystem, name: dep.name, version: dep.version },
      };
    }
  }

  // PR nodes (recent backfill) + their authors.
  const seenUser = new Set<string>();
  for (const pr of await recentPulls(client, owner, repo)) {
    const files = await pullFiles(client, owner, repo, pr.number);
    yield {
      ref: ref(`pr:${pr.number}`, "github.pull_request"),
      payload: {
        owner,
        repo,
        data: {
          number: pr.number,
          title: pr.title,
          user: pr.user ? { login: pr.user.login } : undefined,
          state: pr.state,
          mergedAt: pr.merged_at ?? null,
          baseRef: pr.base?.ref,
          headRef: pr.head?.ref,
          changedFiles: files,
        },
      },
    };
    if (pr.user?.login && !seenUser.has(pr.user.login)) {
      seenUser.add(pr.user.login);
      yield {
        ref: ref(`user:${pr.user.login}`, "github.user"),
        payload: { data: { login: pr.user.login } },
      };
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

interface GithubRepo {
  default_branch?: string;
  visibility?: string;
  language?: string | null;
  topics?: string[];
  archived?: boolean;
  pushed_at?: string;
}
interface GithubPull {
  number: number;
  title?: string;
  user?: { login: string };
  state?: string;
  merged_at?: string | null;
  base?: { ref?: string };
  head?: { ref?: string };
}

async function firstContent(
  client: GithubClient,
  owner: string,
  repo: string,
  paths: string[],
): Promise<string | null> {
  for (const path of paths) {
    const content = await tryContent(client, owner, repo, path);
    if (content != null) return content;
  }
  return null;
}

async function tryContent(
  client: GithubClient,
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  try {
    const res = await client.request<{ content?: string; encoding?: string }>(
      `/repos/${owner}/${repo}/contents/${path}`,
    );
    if (!res.data.content) return null;
    return Buffer.from(res.data.content, "base64").toString("utf8");
  } catch (err) {
    if (/GitHub 404/.test((err as Error).message)) return null;
    throw err;
  }
}

async function listWorkflowFiles(
  client: GithubClient,
  owner: string,
  repo: string,
): Promise<Array<{ name: string; path: string }>> {
  try {
    const res = await client.request<Array<{ name?: string; path?: string; type?: string }>>(
      `/repos/${owner}/${repo}/contents/.github/workflows`,
    );
    return (res.data ?? [])
      .filter((f) => f.type === "file" && !!f.path && /\.ya?ml$/.test(f.path))
      .map((f) => ({ name: f.name ?? f.path ?? "", path: f.path as string }));
  } catch (err) {
    if (/GitHub 404/.test((err as Error).message)) return [];
    throw err;
  }
}

async function recentPulls(
  client: GithubClient,
  owner: string,
  repo: string,
): Promise<GithubPull[]> {
  const res = await client.request<GithubPull[]>(`/repos/${owner}/${repo}/pulls`, {
    params: { state: "all", sort: "updated", direction: "desc", per_page: PR_BACKFILL },
  });
  return res.data ?? [];
}

async function pullFiles(
  client: GithubClient,
  owner: string,
  repo: string,
  number: number,
): Promise<string[]> {
  const files: string[] = [];
  // Page through the PR's changed files (100/page via the client) up to MAX_PR_FILES, instead of
  // taking only the first 100 — a large PR could otherwise lose the file that links it to a service.
  for await (const f of client.paginate<{ filename?: string }>(
    `/repos/${owner}/${repo}/pulls/${number}/files`,
  )) {
    if (f.filename) files.push(f.filename);
    if (files.length >= MAX_PR_FILES) break;
  }
  return files;
}
