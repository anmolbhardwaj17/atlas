/**
 * Deterministic GitHub URN construction (docs/05 §2.2 / §2.3). URNs are stable,
 * recomputable identities that make node upsert idempotent (`uq_node_urn`, docs/04).
 *
 * Schemes (docs/05 §2.2; connectors own the per-provider scheme, grammar owned by 05):
 *   repository  github:<owner>/<repo>
 *   pull req    github:<owner>/<repo>:pr:<number>
 *   workflow    github:<owner>/<repo>:workflow:<path>     (path on the default branch)
 *   team        github:<owner>:team:<slug>
 *   user        github:user:<login>
 *   package     external:<ecosystem>:package:<name>       (DEPENDS_ON_PKG target)
 *
 * Case: the provider/type segments are literal-lowercase; natural keys that GitHub
 * treats as case-significant (owner, repo, package name) are PRESERVED (docs/05 §2.3);
 * `login` and `ecosystem` are lowercased (GitHub logins are case-insensitive).
 */

function req(value: string, what: string): string {
  const v = value.trim();
  if (!v) throw new Error(`github URN: ${what} is required`);
  return v;
}

export function repoUrn(owner: string, repo: string): string {
  return `github:${req(owner, "owner")}/${req(repo, "repo")}`;
}

export function pullRequestUrn(owner: string, repo: string, number: number | string): string {
  const n = String(number).trim();
  if (!/^\d+$/.test(n)) throw new Error("github URN: pull request number must be numeric");
  return `${repoUrn(owner, repo)}:pr:${n}`;
}

export function workflowUrn(owner: string, repo: string, path: string): string {
  return `${repoUrn(owner, repo)}:workflow:${req(path, "workflow path")}`;
}

export function teamUrn(owner: string, slug: string): string {
  return `github:${req(owner, "owner")}:team:${req(slug, "team slug")}`;
}

export function userUrn(login: string): string {
  return `github:user:${req(login, "login").toLowerCase()}`;
}

export function packageUrn(ecosystem: string, name: string): string {
  return `external:${req(ecosystem, "ecosystem").toLowerCase()}:package:${req(name, "package name")}`;
}
