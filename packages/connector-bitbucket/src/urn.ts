/**
 * Deterministic Bitbucket URN construction (docs/05 §2.2, docs/07b). URNs are stable,
 * recomputable identities that make node upsert idempotent (`uq_node_urn`, docs/04) — and
 * match the scheme the demo estate + migration 0017 node-kinds already use.
 *
 * Scheme:  bitbucket:<workspace>:<type>/<key>
 *   project      bitbucket:<ws>:project/<projectKey>
 *   repository   bitbucket:<ws>:repository/<repoSlug>
 *   pipeline     bitbucket:<ws>:pipeline/<repoSlug>/<envKey>     (a deployment environment)
 *   pull request bitbucket:<ws>:pullrequest/<repoSlug>/<id>
 *   user         bitbucket:<ws>:user/<key>                       (account_id or nickname)
 *
 * Case: the provider/type segments are literal-lowercase; workspace + natural keys are
 * lowercased (Bitbucket workspace/repo slugs are case-insensitive), ids preserved.
 */

function req(value: string, what: string): string {
  const v = value.trim();
  if (!v) throw new Error(`bitbucket URN: ${what} is required`);
  return v;
}

function slug(value: string, what: string): string {
  return req(value, what).toLowerCase();
}

export function projectUrn(workspace: string, key: string): string {
  return `bitbucket:${slug(workspace, "workspace")}:project/${slug(key, "project key")}`;
}

export function repositoryUrn(workspace: string, repoSlug: string): string {
  return `bitbucket:${slug(workspace, "workspace")}:repository/${slug(repoSlug, "repo slug")}`;
}

export function pipelineUrn(workspace: string, repoSlug: string, envKey: string): string {
  return `bitbucket:${slug(workspace, "workspace")}:pipeline/${slug(repoSlug, "repo slug")}/${slug(envKey, "environment key")}`;
}

export function pullRequestUrn(workspace: string, repoSlug: string, id: number | string): string {
  const n = String(id).trim();
  if (!/^\d+$/.test(n)) throw new Error("bitbucket URN: pull request id must be numeric");
  return `bitbucket:${slug(workspace, "workspace")}:pullrequest/${slug(repoSlug, "repo slug")}/${n}`;
}

/**
 * External dependency package — the SHARED, cross-provider vocabulary node (same scheme the GitHub
 * connector uses), so a Bitbucket repo and a GitHub repo depending on the same package resolve to
 * ONE package node. `external:<ecosystem>:package:<name>`.
 */
export function packageUrn(ecosystem: string, name: string): string {
  return `external:${req(ecosystem, "ecosystem").toLowerCase()}:package:${req(name, "package name")}`;
}

export function userUrn(workspace: string, key: string): string {
  return `bitbucket:${slug(workspace, "workspace")}:user/${slug(key, "user key")}`;
}
