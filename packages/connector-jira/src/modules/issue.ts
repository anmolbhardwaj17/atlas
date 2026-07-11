import type { EdgeUpsert, NodeUpsert } from "@atlas/connector-sdk";
import { issueUrn, projectUrn } from "../urn";
import { adfToText } from "../adf";
import { readContext, str, obj } from "./context";

/**
 * A Jira issue (story / task / bug / subtask) — the INTENT node. Captures what the ticket asked for:
 * summary, the full description (ADF flattened to text — acceptance criteria usually live here),
 * labels, status, and — crucially for intent verification — its subtasks and comments (intent often
 * lives in the clarifying comments, not the summary). PR↔issue linking + coverage judging come later
 * as inference/AI over these attributes; the connector just captures them faithfully (P4).
 */
export function issueNode(payload: unknown): NodeUpsert {
  const { site } = readContext(payload);
  const p = payload as Record<string, unknown>;
  const key = str(p, "key") ?? "UNKNOWN";
  const f = obj(p, "fields") ?? {};
  const summary = str(f, "summary") ?? key;
  const status = obj(f, "status");
  const labels = Array.isArray(f.labels)
    ? f.labels.filter((l): l is string => typeof l === "string")
    : [];

  const subtasksRaw = Array.isArray(f.subtasks) ? f.subtasks : [];
  const subtasks = subtasksRaw
    .map((s) => ({
      key: str(s, "key") ?? null,
      summary: str(obj(s, "fields"), "summary") ?? null,
      status: str(obj(obj(s, "fields"), "status"), "name") ?? null,
    }))
    .filter((s) => s.key);

  const commentsRaw = Array.isArray(obj(f, "comment")?.comments)
    ? (obj(f, "comment")?.comments as unknown[])
    : [];
  const comments = commentsRaw
    .slice(0, 25)
    .map((c) => ({
      author: str(obj(c, "author"), "displayName") ?? null,
      text: adfToText((c as Record<string, unknown>)?.body),
      createdAt: str(c, "created") ?? null,
    }))
    .filter((c) => c.text);

  return {
    urn: issueUrn(site, key),
    kind: "jira.issue",
    displayName: `${key} — ${summary}`,
    attributes: {
      key,
      summary,
      description: adfToText(f.description),
      issueType: str(obj(f, "issuetype"), "name"),
      isSubtask: obj(f, "issuetype")?.subtask === true,
      status: str(status, "name"),
      statusCategory: str(obj(status, "statusCategory"), "key"),
      labels,
      assignee: str(obj(f, "assignee"), "displayName"),
      reporter: str(obj(f, "reporter"), "displayName"),
      parentKey: str(obj(f, "parent"), "key") ?? null,
      subtasks,
      comments,
      createdAt: str(f, "created"),
      updatedAt: str(f, "updated"),
      url: `https://${site}.atlassian.net/browse/${key}`,
    },
  };
}

export function issueEdges(payload: unknown): EdgeUpsert[] {
  const { site } = readContext(payload);
  const p = payload as Record<string, unknown>;
  const key = str(p, "key");
  if (!key) return [];
  const f = obj(p, "fields") ?? {};
  const edges: EdgeUpsert[] = [];
  const projectKey = str(obj(f, "project"), "key");
  if (projectKey) {
    edges.push({
      type: "CONTAINS",
      fromUrn: projectUrn(site, projectKey),
      toUrn: issueUrn(site, key),
      origin: "observed",
    });
  }
  // A subtask belongs to its parent story. (Dropped later if the parent wasn't crawled — P3.)
  const parentKey = str(obj(f, "parent"), "key");
  if (parentKey) {
    edges.push({
      type: "CONTAINS",
      fromUrn: issueUrn(site, parentKey),
      toUrn: issueUrn(site, key),
      origin: "observed",
    });
  }
  return edges;
}
