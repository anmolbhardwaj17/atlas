// AI-suggested edges + rejection memory (docs/05 §6, docs/10). On top of the deterministic
// inference engine, the AI can PROPOSE edges (e.g. repo→runtime) that name-matching can't catch.
// These are a distinct, lowest-trust state the user confirms or rejects in the graph — never
// asserted as fact (P3), always carrying the model's reasoning as provenance (P4).
//
//   edges.origin      += 'ai_suggested' (unconfirmed AI proposal) and 'confirmed' (human-vouched).
//   edges.confidence  += 'ai-suggested' (styled distinctly; sits below inferred-low).
//
// The existing table CHECKs (inferred_needs_rule / observed_is_observed_conf) already exempt any
// non-'inferred'/non-'observed' origin, so these new origins slot in with no rule id required.
// Crucially, the deterministic retire pass keys on origin='inferred', so it never touches an
// AI-suggested or confirmed edge — they live outside the sync/inference lifecycle.
//
// edge_suggestion_rejections mirrors muted_findings (0030): a tiny org-scoped "user said no,
// remember it" table so a rejected pair is never re-proposed. Rejecting DELETES the edge row and
// records the pair here (edges have no 'deleted' status).

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  // Widen the origin CHECK (inline constraint → auto-named edges_origin_check).
  `ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_origin_check`,
  `ALTER TABLE edges ADD CONSTRAINT edges_origin_check
     CHECK (origin IN ('observed','inferred','ai_suggested','confirmed'))`,

  // Widen the confidence CHECK to add the AI-suggested tier.
  `ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_confidence_check`,
  `ALTER TABLE edges ADD CONSTRAINT edges_confidence_check
     CHECK (confidence IN ('observed','inferred-high','inferred-low','ai-suggested'))`,

  // Rejection memory — one row per rejected (from,to,type) pair, org-scoped (mirrors 0030).
  `CREATE TABLE IF NOT EXISTS edge_suggestion_rejections (
     org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     from_node_id uuid NOT NULL,
     to_node_id   uuid NOT NULL,
     type         text NOT NULL,
     reason       text,
     rejected_by  uuid REFERENCES users(id) ON DELETE SET NULL,
     rejected_at  timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (org_id, from_node_id, to_node_id, type)
   )`,
  `GRANT SELECT, INSERT, DELETE ON edge_suggestion_rejections TO atlas_app`,
  `ALTER TABLE edge_suggestion_rejections ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_edge_rej ON edge_suggestion_rejections`,
  `CREATE POLICY org_scope_edge_rej ON edge_suggestion_rejections FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
];

export const down: string[] = [
  `DROP TABLE IF EXISTS edge_suggestion_rejections CASCADE`,
  `ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_origin_check`,
  `ALTER TABLE edges ADD CONSTRAINT edges_origin_check CHECK (origin IN ('observed','inferred'))`,
  `ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_confidence_check`,
  `ALTER TABLE edges ADD CONSTRAINT edges_confidence_check
     CHECK (confidence IN ('observed','inferred-high','inferred-low'))`,
];
