// Follow-up to 0041: an AI-suggested edge writes a `provenance` row at confidence 'ai-suggested',
// but 0041 only widened the CHECK on `edges` — the `provenance` table has its own confidence CHECK
// (same 3 values). Widen it too so the suggested-edge write path succeeds (it was 500ing on
// provenance_confidence_check). Forward-only, so this is a separate migration.

export const up: string[] = [
  `ALTER TABLE provenance DROP CONSTRAINT IF EXISTS provenance_confidence_check`,
  `ALTER TABLE provenance ADD CONSTRAINT provenance_confidence_check
     CHECK (confidence IN ('observed','inferred-high','inferred-low','ai-suggested'))`,
];

export const down: string[] = [
  `ALTER TABLE provenance DROP CONSTRAINT IF EXISTS provenance_confidence_check`,
  `ALTER TABLE provenance ADD CONSTRAINT provenance_confidence_check
     CHECK (confidence IN ('observed','inferred-high','inferred-low'))`,
];
