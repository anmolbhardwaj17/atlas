/**
 * Deterministic Jira URN construction (docs/05 §2.2). Stable, recomputable identities so node
 * upsert is idempotent (`uq_node_urn`).
 *
 * Scheme:  jira:<site>:<type>/<key>
 *   project  jira:<site>:project/<PROJECTKEY>
 *   issue    jira:<site>:issue/<ISSUE-KEY>        (e.g. ENG-142)
 *
 * The site slug is lowercased; issue/project keys are UPPERCASED (Jira keys are upper-case by
 * convention and case-insensitive), so a PR referencing `eng-142` still resolves to `ENG-142`.
 */

function req(value: string, what: string): string {
  const v = value.trim();
  if (!v) throw new Error(`jira URN: ${what} is required`);
  return v;
}

export function projectUrn(site: string, key: string): string {
  return `jira:${req(site, "site").toLowerCase()}:project/${req(key, "project key").toUpperCase()}`;
}

export function issueUrn(site: string, key: string): string {
  return `jira:${req(site, "site").toLowerCase()}:issue/${req(key, "issue key").toUpperCase()}`;
}
