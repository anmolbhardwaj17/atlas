/**
 * Repository module (docs/07 §4). The repo node, plus the observed edges parsed from
 * its repo-level files: OWNED_BY (CODEOWNERS → team/user, §7.2) and DEPENDS_ON_PKG
 * (dependency manifests → external package, §7.3). Target nodes (team/user/package)
 * are discovered as their own resources so these edges resolve (else G1 handles the
 * forward ref). Deploy edges are inferred (R1), not emitted here.
 */
import { repoUrn, teamUrn, userUrn, packageUrn } from "../urn";
import { observed, type GithubModule } from "./module";
import { parseCodeowners, distinctOwners } from "../parsers/codeowners";
import { parseManifest } from "../parsers/manifest";

export interface RepositoryPayload {
  owner: string;
  repo: string;
  data: {
    defaultBranch?: string;
    visibility?: string;
    language?: string | null;
    topics?: string[];
    archived?: boolean;
    pushedAt?: string;
  };
  /** CODEOWNERS content on the default branch (null/absent if none). */
  codeowners?: string | null;
  /** Dependency manifests fetched from the default branch. */
  manifests?: Array<{ path: string; content: string }>;
}

export const repositoryModule: GithubModule<RepositoryPayload> = {
  kind: "github.repository",
  normalize({ owner, repo, data }) {
    return {
      urn: repoUrn(owner, repo),
      kind: "github.repository",
      displayName: `${owner}/${repo}`,
      attributes: {
        owner,
        repo,
        defaultBranch: data.defaultBranch,
        visibility: data.visibility,
        language: data.language ?? null,
        topics: data.topics ?? [],
        archived: data.archived ?? false,
        pushedAt: data.pushedAt,
      },
    };
  },
  observedEdges({ owner, repo, codeowners, manifests }) {
    const self = repoUrn(owner, repo);
    const edges = [];

    for (const ref of distinctOwners(parseCodeowners(codeowners ?? ""))) {
      const toUrn = ref.type === "team" ? teamUrn(ref.org, ref.slug) : userUrn(ref.login);
      edges.push(observed("OWNED_BY", self, toUrn));
    }

    for (const m of manifests ?? []) {
      for (const dep of parseManifest(m.path, m.content)) {
        edges.push(
          observed("DEPENDS_ON_PKG", self, packageUrn(dep.ecosystem, dep.name), {
            version: dep.version,
            manifest: m.path,
          }),
        );
      }
    }
    return edges;
  },
  extractSignals() {
    return [];
  },
};
