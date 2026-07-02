import type { ResourceRef } from "@atlas/connector-sdk";
import type { BitbucketClient } from "./client";
import { withContext, type AtlasContext } from "../modules/context";
import { userKeyOf } from "../modules/nodes";

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
  yield {
    ref: { scopeKey, externalId: `repo:${repoSlug}`, kind: "bitbucket.repository" },
    payload: withContext(repo, ctx),
  };

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

  // Recently MERGED pull requests (shipped work → contribution). Windowed to the last 90 days
  // and bounded to one page per repo (single request, no pagination) so the current-state graph
  // keeps a recent, useful slice rather than years of history.
  try {
    const since = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    const res = await client.request<{ values?: Json[] }>(
      `/repositories/${workspace}/${repoSlug}/pullrequests`,
      {
        params: {
          state: "MERGED",
          sort: "-updated_on",
          pagelen: 25,
          q: `updated_on >= "${since}"`,
        },
      },
    );
    for (const pr of res.data.values ?? []) {
      yield prRef(pr, repoSlug, scopeKey, ctx);
    }
  } catch {
    // merged PRs not permitted — skip
  }
}

function prRef(pr: Json, repoSlug: string, scopeKey: string, ctx: AtlasContext): Discovered {
  const id = typeof pr.id === "number" ? pr.id : s(pr.id);
  return {
    ref: { scopeKey, externalId: `pr:${repoSlug}:${id}`, kind: "bitbucket.pullrequest" },
    payload: withContext(pr, ctx),
  };
}
