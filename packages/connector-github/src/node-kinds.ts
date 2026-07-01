/**
 * GitHub node-kind catalog (docs/05 §3.2, docs/07). The matching `node_kinds` rows are
 * seeded in db migrations 0008 (github.*) and 0009 (external.package). Unlike AWS,
 * GitHub kinds are not region/global-scoped, so this is a flat catalog used mainly for
 * validation and documentation; per-kind URN construction lives in urn.ts.
 */
export interface GithubKindDescriptor {
  readonly kind: string;
  readonly provider: "github" | "external";
  readonly category: string;
}

export const GITHUB_NODE_KINDS = {
  "github.repository": { kind: "github.repository", provider: "github", category: "scm" },
  "github.pull_request": { kind: "github.pull_request", provider: "github", category: "scm" },
  "github.workflow": { kind: "github.workflow", provider: "github", category: "scm" },
  "github.team": { kind: "github.team", provider: "github", category: "scm" },
  "github.user": { kind: "github.user", provider: "github", category: "scm" },
  "external.package": { kind: "external.package", provider: "external", category: "dependency" },
} as const satisfies Record<string, GithubKindDescriptor>;

export type GithubNodeKind = keyof typeof GITHUB_NODE_KINDS;

export const GITHUB_NODE_KIND_LIST: readonly GithubKindDescriptor[] =
  Object.values(GITHUB_NODE_KINDS);
