// Org-scoped access for `organizations` + capability-based invitation lookup
// (docs/12 §4–§6, F1.6).
//
// `organizations` had RLS auto-enabled by Supabase but no policy (like the F1.4
// tables) → atlas_app was denied. We add ONE org-scoped policy: a row is visible/
// writable only when its id equals the active `atlas.current_org` GUC. This covers
// creation too — org creation runs inside withOrgScope(newOrgId), so the INSERT's
// WITH CHECK (id = guc) passes (the app generates the id up front).
//
// `app_invitation_by_token` mirrors the membership resolver (0003): accepting an
// invite is a cross-org lookup keyed by the *secret token* (the capability), which
// org-scoped RLS would otherwise hide. SECURITY DEFINER, EXECUTE → atlas_app only.
//
// Idempotent. Fail-closed via the same NULLIF(...,'') GUC pattern as 0002.

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `ALTER TABLE organizations ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope ON organizations`,
  `CREATE POLICY org_scope ON organizations FOR ALL TO atlas_app
     USING (id = ${ORG_GUC})
     WITH CHECK (id = ${ORG_GUC})`,

  `CREATE OR REPLACE FUNCTION app_invitation_by_token(p_token_hash text)
     RETURNS TABLE (id uuid, org_id uuid, email citext, role text, status text, expires_at timestamptz)
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT id, org_id, email, role, status, expires_at
     FROM invitations
     WHERE token_hash = p_token_hash
   $$`,
  `REVOKE ALL ON FUNCTION app_invitation_by_token(text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_invitation_by_token(text) TO atlas_app`,
];

export const down: string[] = [
  `DROP FUNCTION IF EXISTS app_invitation_by_token(text)`,
  `DROP POLICY IF EXISTS org_scope ON organizations`,
];
