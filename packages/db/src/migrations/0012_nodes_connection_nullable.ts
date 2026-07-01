// Derived nodes (docs/05 §3.3 — `atlas.service`) are synthesized by the inference engine
// (G1) from cross-source evidence, not crawled from a single connection. So `connection_id`
// must be nullable for them (observed nodes still set it). Connection-scoped stale-reconcile
// (WHERE connection_id = $conn) naturally skips derived nodes — they're reconciled by the
// inference engine's own retire pass, not by a sync. (docs/04 §5.3 updated in the same change.)

export const up: string[] = [`ALTER TABLE nodes ALTER COLUMN connection_id DROP NOT NULL`];

export const down: string[] = [`ALTER TABLE nodes ALTER COLUMN connection_id SET NOT NULL`];
