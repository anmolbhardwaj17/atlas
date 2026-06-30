// Knowledge / graph persist schema (docs/04 §5.3–§5.4, §6; docs/05). The heart of
// the product (P1). Created in F2 so the staged sync can persist (nodes + raw
// snapshots + provenance + observed edges); the inference engine that *derives*
// edges is G1.
//
// Tenant isolation (R8): org-scoped tables get an org-scope RLS policy TO atlas_app
// (Supabase auto-enables RLS on every public table). Cross-tenant edges are made
// structurally impossible via COMPOSITE FKs (from/to, org_id) → nodes(id, org_id)
// (BR-EDGE-1). node_kinds/inference_rules are global vocab (policy TO atlas_app).
//
// Trust spine (P4): every edge REQUIRES a provenance row (BR-EDGE-2); inferred edges
// REQUIRE a rule (BR-EDGE-3); observed edges must carry 'observed' confidence.
//
// uq_edge uses NULLS NOT DISTINCT (PG15+) so observed edges (inference_rule_id NULL)
// dedupe by (org, from, to, type) — realizing the documented "one edge per type per
// rule" intent for the NULL-rule case (docs/04 §5.4).
//
// Idempotent-friendly (guarded policy drops). FK checks bypass RLS, so org-scoped
// inserts validate against node_kinds / nodes regardless of the GUC.

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,

  // ── Controlled vocabularies (global reference tables) ──────────────────────
  `CREATE TABLE node_kinds (
     kind        text PRIMARY KEY,
     provider    text NOT NULL,
     category    text NOT NULL,
     description text NOT NULL,
     CHECK (kind ~ '^[a-z][a-z0-9_.]+$')
   )`,
  `CREATE TABLE inference_rules (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     key             text NOT NULL,
     version         int  NOT NULL DEFAULT 1,
     name            text NOT NULL,
     description     text NOT NULL,
     produces_type   text NOT NULL,
     confidence_tier text NOT NULL CHECK (confidence_tier IN ('inferred-high','inferred-low')),
     enabled         boolean NOT NULL DEFAULT true,
     created_at      timestamptz NOT NULL DEFAULT now(),
     UNIQUE (key, version)
   )`,

  // ── Nodes ──────────────────────────────────────────────────────────────────
  `CREATE TABLE nodes (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
     urn           text NOT NULL,
     kind          text NOT NULL REFERENCES node_kinds(kind),
     name          text,
     provider      text NOT NULL,
     region        text,
     account_ref   text,
     tags          jsonb NOT NULL DEFAULT '{}'::jsonb,
     attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
     status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','deleted')),
     confidence    text NOT NULL DEFAULT 'observed'
                     CHECK (confidence IN ('observed','inferred-high','inferred-low')),
     first_seen    timestamptz NOT NULL DEFAULT now(),
     last_seen     timestamptz NOT NULL DEFAULT now(),
     last_sync_run_id uuid REFERENCES sync_runs(id),
     deleted_at    timestamptz,
     created_at    timestamptz NOT NULL DEFAULT now(),
     updated_at    timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_node_urn UNIQUE (org_id, urn)
   )`,
  `ALTER TABLE nodes ADD CONSTRAINT uq_node_id_org UNIQUE (id, org_id)`,
  `CREATE TRIGGER trg_nodes_updated BEFORE UPDATE ON nodes
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

  // ── Raw snapshots (append-only, immutable) ────────────────────────────────
  `CREATE TABLE raw_snapshots (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     node_id      uuid REFERENCES nodes(id) ON DELETE SET NULL,
     storage_ref  text NOT NULL,
     content_hash text NOT NULL,
     sync_run_id  uuid REFERENCES sync_runs(id),
     captured_at  timestamptz NOT NULL DEFAULT now()
   )`,

  // ── Provenance (trust spine) ──────────────────────────────────────────────
  `CREATE TABLE provenance (
     id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     source            text NOT NULL,
     sync_run_id       uuid REFERENCES sync_runs(id),
     observed_at       timestamptz NOT NULL DEFAULT now(),
     confidence        text NOT NULL DEFAULT 'observed'
                         CHECK (confidence IN ('observed','inferred-high','inferred-low')),
     inference_rule_id uuid REFERENCES inference_rules(id),
     evidence          jsonb NOT NULL DEFAULT '{}'::jsonb,
     raw_snapshot_id   uuid REFERENCES raw_snapshots(id)
   )`,

  // ── Edges (typed, directed, provenance-bearing) ───────────────────────────
  `CREATE TABLE edges (
     id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     from_node_id      uuid NOT NULL,
     to_node_id        uuid NOT NULL,
     type              text NOT NULL,
     origin            text NOT NULL CHECK (origin IN ('observed','inferred')),
     confidence        text NOT NULL CHECK (confidence IN ('observed','inferred-high','inferred-low')),
     provenance_id     uuid NOT NULL REFERENCES provenance(id),
     inference_rule_id uuid REFERENCES inference_rules(id),
     status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
     first_seen        timestamptz NOT NULL DEFAULT now(),
     last_seen         timestamptz NOT NULL DEFAULT now(),
     last_sync_run_id  uuid REFERENCES sync_runs(id),
     retired_at        timestamptz,
     created_at        timestamptz NOT NULL DEFAULT now(),
     updated_at        timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT no_self_edge CHECK (from_node_id <> to_node_id),
     CONSTRAINT inferred_needs_rule CHECK (origin <> 'inferred' OR inference_rule_id IS NOT NULL),
     CONSTRAINT observed_is_observed_conf CHECK (origin <> 'observed' OR confidence = 'observed'),
     CONSTRAINT uq_edge UNIQUE NULLS NOT DISTINCT (org_id, from_node_id, to_node_id, type, inference_rule_id)
   )`,
  // Composite FKs: an edge's endpoints must be in the SAME org → cross-tenant edges
  // are structurally impossible (BR-EDGE-1 / R8).
  `ALTER TABLE edges
     ADD CONSTRAINT fk_edge_from FOREIGN KEY (from_node_id, org_id)
         REFERENCES nodes(id, org_id) ON DELETE CASCADE,
     ADD CONSTRAINT fk_edge_to   FOREIGN KEY (to_node_id, org_id)
         REFERENCES nodes(id, org_id) ON DELETE CASCADE`,
  `CREATE TRIGGER trg_edges_updated BEFORE UPDATE ON edges
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

  // ── Indexes (docs/04 §6; org-prefixed, partial on hot status) ─────────────
  `CREATE INDEX ix_nodes_org_kind        ON nodes(org_id, kind) WHERE status <> 'deleted'`,
  `CREATE INDEX ix_nodes_org_status_seen ON nodes(org_id, status, last_seen DESC)`,
  `CREATE INDEX ix_nodes_org_region      ON nodes(org_id, region)`,
  `CREATE INDEX ix_nodes_org_conn        ON nodes(org_id, connection_id)`,
  `CREATE INDEX ix_nodes_tags_gin        ON nodes USING gin (tags jsonb_path_ops)`,
  `CREATE INDEX ix_nodes_attrs_gin       ON nodes USING gin (attributes jsonb_path_ops)`,
  `CREATE INDEX ix_nodes_name_trgm       ON nodes USING gin (name gin_trgm_ops)`,
  `CREATE INDEX ix_edges_from ON edges(org_id, from_node_id, type) WHERE status = 'active'`,
  `CREATE INDEX ix_edges_to   ON edges(org_id, to_node_id,   type) WHERE status = 'active'`,
  `CREATE INDEX ix_edges_type ON edges(org_id, type)              WHERE status = 'active'`,
  `CREATE INDEX ix_edges_rule ON edges(inference_rule_id)`,
  `CREATE INDEX ix_prov_org       ON provenance(org_id)`,
  `CREATE INDEX ix_snapshots_node ON raw_snapshots(org_id, node_id)`,
  `CREATE INDEX ix_snapshots_hash ON raw_snapshots(org_id, content_hash)`,

  // ── RLS ────────────────────────────────────────────────────────────────────
  // Global vocab tables: readable/writable by atlas_app (not anon/authenticated).
  `ALTER TABLE node_kinds ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS app_rw_node_kinds ON node_kinds`,
  `CREATE POLICY app_rw_node_kinds ON node_kinds FOR ALL TO atlas_app USING (true) WITH CHECK (true)`,
  `ALTER TABLE inference_rules ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS app_rw_inference_rules ON inference_rules`,
  `CREATE POLICY app_rw_inference_rules ON inference_rules FOR ALL TO atlas_app USING (true) WITH CHECK (true)`,

  // Org-scoped knowledge tables.
  `ALTER TABLE nodes ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_nodes ON nodes`,
  `CREATE POLICY org_scope_nodes ON nodes FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `ALTER TABLE raw_snapshots ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_raw_snapshots ON raw_snapshots`,
  `CREATE POLICY org_scope_raw_snapshots ON raw_snapshots FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `ALTER TABLE provenance ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_provenance ON provenance`,
  `CREATE POLICY org_scope_provenance ON provenance FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `ALTER TABLE edges ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_edges ON edges`,
  `CREATE POLICY org_scope_edges ON edges FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
];

export const down: string[] = [
  `DROP TABLE IF EXISTS edges CASCADE`,
  `DROP TABLE IF EXISTS provenance CASCADE`,
  `DROP TABLE IF EXISTS raw_snapshots CASCADE`,
  `DROP TABLE IF EXISTS nodes CASCADE`,
  `DROP TABLE IF EXISTS inference_rules CASCADE`,
  `DROP TABLE IF EXISTS node_kinds CASCADE`,
];
