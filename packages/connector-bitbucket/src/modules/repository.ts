import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import { projectUrn, repositoryUrn } from "../urn";
import { readContext, obj, str } from "./context";

/**
 * A Bitbucket repository → bitbucket.repository node. Observed edges: the repo's project
 * CONTAINS it (docs/05; matches the demo estate). Language is emitted as a signal for later
 * inference (e.g. dependency/ownership rules), never as an edge here (connectors observe,
 * they don't infer — P4).
 */
export function repositoryNode(payload: unknown): NodeUpsert {
  const { workspace } = readContext(payload);
  const slug = str(payload, "slug") ?? "";
  return {
    urn: repositoryUrn(workspace, slug),
    kind: "bitbucket.repository",
    displayName: str(payload, "name") ?? slug,
    attributes: {
      slug,
      fullName: str(payload, "full_name"),
      description: str(payload, "description"),
      language: str(payload, "language"),
      isPrivate: (payload as Record<string, unknown>)?.is_private === true,
      mainBranch: str(obj(payload, "mainbranch"), "name"),
      updatedOn: str(payload, "updated_on"),
    },
  };
}

export function repositorySignals(payload: unknown): Signal[] {
  const { workspace } = readContext(payload);
  const slug = str(payload, "slug");
  const language = str(payload, "language");
  if (!slug || !language) return [];
  return [
    {
      kind: "repo_language",
      subjectUrn: repositoryUrn(workspace, slug),
      data: { language },
    },
  ];
}

export function repositoryEdges(payload: unknown): EdgeUpsert[] {
  const { workspace } = readContext(payload);
  const slug = str(payload, "slug");
  const project = obj(payload, "project");
  const projectKey = str(project, "key");
  if (!slug || !projectKey) return [];
  return [
    {
      type: "CONTAINS",
      fromUrn: projectUrn(workspace, projectKey),
      toUrn: repositoryUrn(workspace, slug),
      origin: "observed",
    },
  ];
}
