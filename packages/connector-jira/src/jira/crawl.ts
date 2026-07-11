import type { ResourceRef } from "@atlas/connector-sdk";
import { JiraHttpError, type JiraClient } from "./client";
import { withContext } from "../modules/context";

/**
 * Live discovery over the Jira Cloud REST API. Each generator yields a `Discovered` (a cheap ref +
 * the site-context-enriched payload the pure modules transform). Issues are pulled per project via
 * JQL, most-recently-updated first and capped, so a huge backlog can't flood the graph or the sync.
 */
export interface Discovered {
  ref: ResourceRef;
  payload: unknown;
}

type Json = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Cap on issues crawled per project (recent-first) — the coverage/linking use cases need the active
 *  slice, not full history; keeps the sync fast over a remote DB. */
const ISSUE_CAP = 200;
/** How far back to pull issues (by last update). */
const ISSUE_WINDOW_DAYS = 120;
/** Fields we need for intent capture + linking. */
const ISSUE_FIELDS =
  "summary,description,status,issuetype,parent,subtasks,comment,labels,assignee,reporter,created,updated,project";

/** Project keys to crawl: explicit config wins, else every project the token can see. */
export async function resolveProjectKeys(
  client: JiraClient,
  configKeys?: string[],
): Promise<string[]> {
  if (configKeys && configKeys.length > 0) return configKeys;
  const keys: string[] = [];
  for await (const p of client.paginate<Json>("/project/search", "values")) {
    const key = s(p.key);
    if (key) keys.push(key);
  }
  return keys;
}

export async function* discoverProjects(
  client: JiraClient,
  site: string,
  keys: string[],
  scopeKey: string,
): AsyncIterable<Discovered> {
  // Fetch each project's detail (so name/type are present) — /project/{key} is one cheap GET.
  for (const key of keys) {
    try {
      const proj = (await client.request<Json>(`/project/${encodeURIComponent(key)}`)).data;
      yield {
        ref: { scopeKey, externalId: `project:${key}`, kind: "jira.project" },
        payload: withContext(proj, { site }),
      };
    } catch {
      // project not readable — skip (partial coverage beats a failed sync, P3)
    }
  }
}

export async function* discoverIssues(
  client: JiraClient,
  site: string,
  projectKey: string,
  scopeKey: string,
): AsyncIterable<Discovered> {
  const since = new Date(Date.now() - ISSUE_WINDOW_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  const jql = `project = "${projectKey}" AND updated >= "${since}" ORDER BY updated DESC`;
  let count = 0;
  // `/search/jql` is the current enhanced-search endpoint (the old `/search` was removed for Jira
  // Cloud on 2025-05-01). It uses TOKEN pagination (`nextPageToken`/`isLast`), not startAt/total, so
  // we page it by hand rather than via the offset-based `client.paginate`.
  let nextPageToken: string | undefined;
  for (;;) {
    let res;
    try {
      res = await client.request<Json>("/search/jql", {
        params: {
          jql,
          fields: ISSUE_FIELDS,
          maxResults: 100,
          ...(nextPageToken ? { nextPageToken } : {}),
        },
      });
    } catch (err) {
      // A forbidden project is fine to skip (partial coverage beats a failed sync, P3); any OTHER
      // failure must surface (the scope fails visibly) rather than silently yielding zero issues.
      if (err instanceof JiraHttpError && (err.status === 401 || err.status === 403)) return;
      throw err;
    }
    const issues = (res.data.issues as Json[] | undefined) ?? [];
    for (const issue of issues) {
      if (count >= ISSUE_CAP) return;
      const key = s(issue.key);
      if (!key) continue;
      count += 1;
      yield {
        ref: { scopeKey, externalId: `issue:${key}`, kind: "jira.issue" },
        payload: withContext(issue, { site }),
      };
    }
    const token = typeof res.data.nextPageToken === "string" ? res.data.nextPageToken : undefined;
    if (res.data.isLast === true || !token || issues.length === 0) break;
    nextPageToken = token;
  }
}
