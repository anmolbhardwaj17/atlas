// Search-backed fuzzy PR↔issue linking (op-intel next-steps #2, docs/plans/intent-verification.md).
// The no-key fuzzy linker (`suggestIntentLinks`) was O(PR × ISSUE_CAP): it loaded the 600 most-recent
// issues and compared every unlinked PR against all of them. That both scales poorly AND caps recall —
// a PR implementing an older ticket beyond the 600-row window was never even a candidate.
//
// This partial GIN full-text index lets the linker retrieve the top-K *relevant* issues per PR (by
// word overlap with the PR's title/branch) directly from Postgres — the "OpenSearch BM25 top-K"
// candidate step, in the DB we already run, swap-in-later (same story as the search provider, docs/11).
// We index the SAME expression the query uses (summary ++ description, the flattened ADF where
// acceptance criteria live) so the planner serves the `@@` match from the index instead of building a
// tsvector per row. Partial (kind = 'jira.issue') so it stays tiny and only covers the rows we probe.
//
// NOTE (at scale): plain CREATE INDEX (the migration runner is transactional → instant on today's
// tables). If `nodes` is already large at first real deploy, build this CONCURRENTLY out-of-band
// (same caveat as migrations 0055 / 0063).

export const up: string[] = [
  `CREATE INDEX IF NOT EXISTS ix_jira_issue_fts ON nodes USING gin (
     to_tsvector('english',
       coalesce(attributes->>'summary', '') || ' ' || coalesce(attributes->>'description', ''))
   ) WHERE kind = 'jira.issue'`,
];

export const down: string[] = [`DROP INDEX IF EXISTS ix_jira_issue_fts`];
