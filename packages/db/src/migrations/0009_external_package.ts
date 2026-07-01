// Adds the `external.package` node kind (docs/07 §7.3): the lightweight target of
// observed DEPENDS_ON_PKG edges (repo → dependency). Introduced by the GitHub crawler
// (I2); purely additive (a data insert, docs/04 DD-1 / docs/06 §9) — no schema change.
// Provider "external" (not a source connector); it's a shared vocabulary node any
// connector's manifest parsing can point at. Idempotent.

export const up: string[] = [
  `INSERT INTO node_kinds (kind, provider, category, description)
   VALUES ('external.package', 'external', 'dependency',
           'External software dependency (npm/pypi/go/maven/…) — DEPENDS_ON_PKG target')
   ON CONFLICT (kind) DO NOTHING`,
];

export const down: string[] = [`DELETE FROM node_kinds WHERE kind = 'external.package'`];
