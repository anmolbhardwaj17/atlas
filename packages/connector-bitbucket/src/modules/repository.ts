import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import { projectUrn, repositoryUrn, packageUrn } from "../urn";
import { readContext, obj, str } from "./context";
import { parseManifest } from "../parsers/manifest";

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
  if (!slug) return [];
  const self = repositoryUrn(workspace, slug);
  const edges: EdgeUpsert[] = [];

  // project CONTAINS repo
  const projectKey = str(obj(payload, "project"), "key");
  if (projectKey) {
    edges.push({
      type: "CONTAINS",
      fromUrn: projectUrn(workspace, projectKey),
      toUrn: self,
      origin: "observed",
    });
  }

  // repo DEPENDS_ON_PKG <package> (from the dependency manifests fetched in discover).
  const manifests = (payload as { _manifests?: Array<{ path: string; content: string }> })
    ._manifests;
  for (const m of manifests ?? []) {
    for (const dep of parseManifest(m.path, m.content)) {
      edges.push({
        type: "DEPENDS_ON_PKG",
        fromUrn: self,
        toUrn: packageUrn(dep.ecosystem, dep.name),
        origin: "observed",
        attributes: { version: dep.version, manifest: m.path },
      });
    }
  }
  return edges;
}
