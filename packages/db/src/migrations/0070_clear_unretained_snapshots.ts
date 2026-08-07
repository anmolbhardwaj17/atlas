// Clear provenance references to raw snapshots that were never retained (P4 repair).
//
// Background: the snapshot store falls back to an in-memory implementation when Supabase Storage
// isn't configured. That store accepts every write, returns a `mem://<org>/<hash>` ref, and drops
// the payload. The on-demand sync CLI (`apps/api/scripts/sync.ts`) hardcoded that store while its
// own docstring promised "the SAME code path production runs" — so every terminal-run sync against
// the production database recorded provenance pointing at evidence that had already been thrown
// away. 1132 such rows accumulated between 2026-07-09 and 2026-07-12.
//
// Why this matters beyond tidiness: P4 says every claim cites a real node/edge and no edge is
// un-sourced. A `mem://` ref *looks* like a citation — it renders in the node/edge detail panel as
// a "Raw snapshot" value — but resolves to nothing. Provenance that lies is worse than provenance
// that is absent, because "I don't know" is a designed state (docs/09 §7) and a dangling pointer
// isn't; it silently converts an honest gap into a false assurance.
//
// The repair, in order (the FK is NO ACTION, so the update must precede the delete):
//  1. Null the `provenance.raw_snapshot_id` links — 413 rows. The rest of the provenance record
//     (source, sync run, confidence, rule) is untouched and still true; only the pointer to a
//     non-existent payload goes. The API then returns `rawSnapshotRef: null` and the UI omits the
//     row entirely, which is the honest state.
//  2. Delete the `raw_snapshots` rows themselves.
//
// This also HEALS rather than merely hiding. Incremental sync skips re-uploading a payload whose
// `(node_id, content_hash)` already exists in `raw_snapshots` — so as long as these rows stayed,
// an unchanged resource would never be re-snapshotted and the gap would persist forever. Removing
// them makes the next sync see those nodes as changed and write real, durable refs.
//
// Idempotent: the predicate matches nothing on a second run. Deliberately NOT scoped to one org —
// any `mem://` ref is unretained by definition, whoever wrote it.
export const up: string[] = [
  `UPDATE provenance SET raw_snapshot_id = NULL
     WHERE raw_snapshot_id IN (SELECT id FROM raw_snapshots WHERE storage_ref LIKE 'mem://%')`,

  `DELETE FROM raw_snapshots WHERE storage_ref LIKE 'mem://%'`,
];
