import type { ResourceRef } from "@atlas/connector-sdk";
import type { BitbucketClient } from "./client";
import { withContext, type AtlasContext } from "../modules/context";
import { userKeyOf } from "../modules/nodes";
import { parseManifest, MANIFEST_PATHS } from "../parsers/manifest";

/**
 * Live discovery over the Bitbucket REST API (docs/07b). Each discover* generator yields a
 * `Discovered` (a cheap ref + the context-enriched payload the pure modules will transform).
 * `externalId` is only a per-run cache key (unique within the run); the stable URN is derived
 * from the payload at normalize time. Optional sub-resources (environments, PRs) that 403/404
 * for a repo are skipped, never fatal — partial coverage beats a failed sync (P3/A21).
 */
export interface Discovered {
  ref: ResourceRef;
  payload: unknown;
}

type Json = Record<string, unknown>;

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Resolve the workspace: explicit config wins, else the first the token can see. */
export async function resolveWorkspace(
  client: BitbucketClient,
  configWorkspace?: string,
): Promise<string> {
  if (configWorkspace) return configWorkspace;
  for await (const ws of client.paginate<Json>("/workspaces")) {
    const slug = s(ws.slug);
    if (slug) return slug;
  }
  throw new Error("No Bitbucket workspace is accessible to this token.");
}

/** Repo slugs in a workspace (used by plan() to build one scope per repo). */
export async function listRepoSlugs(client: BitbucketClient, workspace: string): Promise<string[]> {
  const slugs: string[] = [];
  for await (const r of client.paginate<Json>(`/repositories/${workspace}`)) {
    const slug = s(r.slug);
    if (slug) slugs.push(slug);
  }
  return slugs;
}

export async function* discoverProjects(
  client: BitbucketClient,
  workspace: string,
  scopeKey: string,
): AsyncIterable<Discovered> {
  for await (const p of client.paginate<Json>(`/workspaces/${workspace}/projects`)) {
    const key = s(p.key);
    if (!key) continue;
    yield {
      ref: { scopeKey, externalId: `project:${key}`, kind: "bitbucket.project" },
      payload: withContext(p, { workspace }),
    };
  }
}

export async function* discoverMembers(
  client: BitbucketClient,
  workspace: string,
  scopeKey: string,
): AsyncIterable<Discovered> {
  for await (const m of client.paginate<Json>(`/workspaces/${workspace}/members`)) {
    const user = (m.user && typeof m.user === "object" ? m.user : m) as Json;
    const key = userKeyOf(user);
    if (!key) continue;
    yield {
      ref: { scopeKey, externalId: `user:${key}`, kind: "bitbucket.user" },
      payload: withContext(user, { workspace }),
    };
  }
}

/** A repo scope: the repo + its deployment environments (pipelines) + open PRs. */
export async function* discoverRepo(
  client: BitbucketClient,
  workspace: string,
  repoSlug: string,
  scopeKey: string,
): AsyncIterable<Discovered> {
  const ctx = { workspace, repoSlug };

  const repo = (await client.request<Json>(`/repositories/${workspace}/${repoSlug}`)).data;

  // Dependency manifests (docs/plans/security-vulnerabilities.md) — fetch a few well-known files
  // from the default branch; parse → package nodes + DEPENDS_ON_PKG edges (the OSV stage then
  // turns those into vulnerabilities). Best-effort: a missing/forbidden file is simply skipped.
  const branch = s((repo.mainbranch as Json | undefined)?.name) || "main";
  const manifests: Array<{ path: string; content: string }> = [];
  for (const path of MANIFEST_PATHS) {
    const content = await client.content(workspace, repoSlug, branch, path);
    if (content != null) manifests.push({ path, content });
  }

  yield {
    ref: { scopeKey, externalId: `repo:${repoSlug}`, kind: "bitbucket.repository" },
    payload: withContext({ ...repo, _manifests: manifests }, ctx),
  };

  // The dependency (external.package) nodes the repo's DEPENDS_ON_PKG edges point at.
  const seenPkg = new Set<string>();
  for (const m of manifests) {
    for (const dep of parseManifest(m.path, m.content)) {
      const key = `${dep.ecosystem}:${dep.name}`;
      if (seenPkg.has(key)) continue;
      seenPkg.add(key);
      yield {
        ref: { scopeKey, externalId: `pkg:${key}`, kind: "external.package" },
        payload: { ecosystem: dep.ecosystem, name: dep.name, version: dep.version },
      };
    }
  }

  // Deployment environments → pipeline (deploy-target) nodes. Absent/forbidden ⇒ skip.
  try {
    for await (const env of client.paginate<Json>(
      `/repositories/${workspace}/${repoSlug}/environments/`,
    )) {
      const id = s(env.uuid) || s(env.name);
      if (!id) continue;
      yield {
        ref: { scopeKey, externalId: `env:${repoSlug}:${id}`, kind: "bitbucket.pipeline" },
        payload: withContext(env, ctx),
      };
    }
  } catch {
    // environments not configured / not permitted — skip this repo's pipelines
  }

  // Open pull requests (in-flight work). Absent/forbidden ⇒ skip.
  try {
    for await (const pr of client.paginate<Json>(
      `/repositories/${workspace}/${repoSlug}/pullrequests`,
      { params: { state: "OPEN" } },
    )) {
      yield prRef(pr, repoSlug, scopeKey, ctx);
    }
  } catch {
    // PRs not permitted — skip
  }

  // MERGED pull requests active in the last 30 days (shipped work → contribution + repo
  // activity). Window + sort by `updated_on` (last activity = the merge), NOT `created_on`: a
  // PR opened weeks ago but merged today is *recent activity*, and sorting by created_on would
  // rank it below the per-repo cap in a busy repo and miss it. updated_on ⊇ created_on for the
  // window (creation is an update), so the created-date insights still see everything they need.
  // Capped per repo so a hyper-active repo keeps a recent slice, not full history.
  try {
    const since = new Date(Date.now() - PR_WINDOW_DAYS * 86400 * 1000).toISOString();
    let count = 0;
    for await (const pr of client.paginate<Json>(
      `/repositories/${workspace}/${repoSlug}/pullrequests`,
      { params: { state: "MERGED", sort: "-updated_on", q: `updated_on >= "${since}"` } },
    )) {
      if (count >= MERGED_PR_CAP) break;
      count += 1;
      yield prRef(pr, repoSlug, scopeKey, ctx);
    }
  } catch {
    // merged PRs not permitted — skip
  }
}

/** Per-repo cap on merged PRs crawled (keeps a busy repo from flooding the graph — and the
 *  sync fast over a remote DB; the leaderboards need ranking, not every PR). */
const MERGED_PR_CAP = 40;
/** How far back to pull merged PRs (contribution/activity window). */
const PR_WINDOW_DAYS = 30;

function prRef(pr: Json, repoSlug: string, scopeKey: string, ctx: AtlasContext): Discovered {
  const id = typeof pr.id === "number" ? pr.id : s(pr.id);
  return {
    ref: { scopeKey, externalId: `pr:${repoSlug}:${id}`, kind: "bitbucket.pullrequest" },
    payload: withContext(pr, ctx),
  };
}
