// Self-healing sync reaper (BR-SYNC-1). sync_runs had no `updated_at`, so the orphaned-run reaper
// could only key off `started_at` (a blunt 60-min timeout). The staged runner writes the checkpoint
// after every scope, so with an `updated_at` that bumps on those writes we can reap on STALENESS
// (no progress) instead: a live-but-slow sync keeps updated_at fresh; a run orphaned by a worker
// restart goes stale within minutes. The trigger reuses set_updated_at() (0001).
//
// Backfill: set existing rows' updated_at to their real activity time (started/created) — NOT the
// migration's now() default — so any run stranded before this migration is immediately stale and
// gets reaped on the next connections list, instead of getting a fresh 15-min grace.

export const up: string[] = [
  `ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
  `UPDATE sync_runs SET updated_at = COALESCE(started_at, created_at)`,
  `DROP TRIGGER IF EXISTS set_sync_runs_updated_at ON sync_runs`,
  `CREATE TRIGGER set_sync_runs_updated_at BEFORE UPDATE ON sync_runs
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
];

export const down: string[] = [
  `DROP TRIGGER IF EXISTS set_sync_runs_updated_at ON sync_runs`,
  `ALTER TABLE sync_runs DROP COLUMN IF EXISTS updated_at`,
];
