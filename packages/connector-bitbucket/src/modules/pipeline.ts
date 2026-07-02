import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import { pipelineUrn, repositoryUrn } from "../urn";
import { readContext, obj, str } from "./context";

/**
 * A Bitbucket deployment environment → bitbucket.pipeline node (a deploy target — the
 * graph-valuable "where does this repo ship to"). Observed edge: the repo CONTAINS it.
 * The environment_type (Test/Staging/Production) is emitted as a signal so the inference
 * engine can later map it to an environment lane.
 */
function envKey(payload: unknown): string {
  // Prefer the human name (unique within a repo); fall back to the uuid.
  return (str(payload, "name") ?? str(payload, "uuid") ?? "env").replace(/[{}]/g, "");
}

export function pipelineNode(payload: unknown): NodeUpsert {
  const { workspace, repoSlug } = readContext(payload);
  const repo = repoSlug ?? "";
  return {
    urn: pipelineUrn(workspace, repo, envKey(payload)),
    kind: "bitbucket.pipeline",
    displayName: str(payload, "name") ?? "environment",
    attributes: {
      repoSlug: repo,
      environmentType: str(obj(payload, "environment_type"), "name"),
      uuid: str(payload, "uuid"),
    },
  };
}

export function pipelineSignals(payload: unknown): Signal[] {
  const { workspace, repoSlug } = readContext(payload);
  const type = str(obj(payload, "environment_type"), "name");
  if (!repoSlug || !type) return [];
  return [
    {
      kind: "deploy_environment",
      subjectUrn: pipelineUrn(workspace, repoSlug, envKey(payload)),
      data: { environmentType: type, repoSlug },
    },
  ];
}

export function pipelineEdges(payload: unknown): EdgeUpsert[] {
  const { workspace, repoSlug } = readContext(payload);
  if (!repoSlug) return [];
  return [
    {
      type: "CONTAINS",
      fromUrn: repositoryUrn(workspace, repoSlug),
      toUrn: pipelineUrn(workspace, repoSlug, envKey(payload)),
      origin: "observed",
    },
  ];
}
