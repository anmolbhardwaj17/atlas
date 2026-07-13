// Manual graph editing (docs/05): let a user hand-draw a link the connectors/inference missed
// ("fix the flow" — e.g. wire a bottom-shelf repo to the service it deploys to), and remove a wrong
// link. A user-asserted edge is `origin='manual'`, `confidence='observed'` (a human vouched for it,
// high trust), and provenance-backed like everything else (source='manual', evidence={by:userId}).
// Removal reuses the existing edge_suggestion_rejections "remember the no" table so inference /
// AI-suggestion never re-adds a link the user killed (the inference engine now honours it too).

export const up: string[] = [
  `ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_origin_check`,
  `ALTER TABLE edges ADD CONSTRAINT edges_origin_check
     CHECK (origin IN ('observed','inferred','ai_suggested','confirmed','manual'))`,
];

export const down: string[] = [
  // Retire any manual edges first so the narrower constraint can re-apply.
  `UPDATE edges SET status = 'retired', retired_at = now() WHERE origin = 'manual'`,
  `ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_origin_check`,
  `ALTER TABLE edges ADD CONSTRAINT edges_origin_check
     CHECK (origin IN ('observed','inferred','ai_suggested','confirmed'))`,
];
