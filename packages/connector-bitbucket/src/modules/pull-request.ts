import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import { pullRequestUrn, repositoryUrn, userUrn } from "../urn";
import { readContext, obj, str } from "./context";
import { userKeyOf } from "./nodes";

/**
 * A Bitbucket pull request → bitbucket.pullrequest node. Observed edges: the repo CONTAINS
 * it, and it is OWNED_BY its author (resolves to the user node the members crawl created;
 * skipped gracefully if the author isn't a workspace member — sync-runner drops unresolved
 * endpoints).
 */
function prId(payload: unknown): string {
  const id = (payload as Record<string, unknown>)?.id;
  return typeof id === "number" ? String(id) : (str(payload, "id") ?? "");
}

export function pullRequestNode(payload: unknown): NodeUpsert {
  const { workspace, repoSlug } = readContext(payload);
  const repo = repoSlug ?? "";
  const id = prId(payload);
  const title = str(payload, "title") ?? `PR #${id}`;
  return {
    urn: pullRequestUrn(workspace, repo, id),
    kind: "bitbucket.pullrequest",
    displayName: `#${id} — ${title}`,
    attributes: {
      repoSlug: repo,
      state: str(payload, "state"),
      sourceBranch: str(obj(obj(payload, "source"), "branch"), "name"),
      destinationBranch: str(obj(obj(payload, "destination"), "branch"), "name"),
      updatedOn: str(payload, "updated_on"),
    },
  };
}

export function pullRequestSignals(): Signal[] {
  return [];
}

export function pullRequestEdges(payload: unknown): EdgeUpsert[] {
  const { workspace, repoSlug } = readContext(payload);
  if (!repoSlug) return [];
  const id = prId(payload);
  const edges: EdgeUpsert[] = [
    {
      type: "CONTAINS",
      fromUrn: repositoryUrn(workspace, repoSlug),
      toUrn: pullRequestUrn(workspace, repoSlug, id),
      origin: "observed",
    },
  ];
  const authorKey = userKeyOf(obj(payload, "author"));
  if (authorKey) {
    edges.push({
      type: "OWNED_BY",
      fromUrn: pullRequestUrn(workspace, repoSlug, id),
      toUrn: userUrn(workspace, authorKey),
      origin: "observed",
    });
  }
  return edges;
}
