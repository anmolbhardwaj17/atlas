// Org logo. Organizations can carry a brand logo (uploaded to a public Supabase Storage bucket;
// only the resulting public URL is stored here). Nullable — logos are optional, the UI falls back
// to a generated monogram/Building glyph. The app_user_memberships resolver (0003) also returns the
// logo so the org switcher can render it without an extra round-trip. Adding a column to a RETURNS
// TABLE function changes its return type, so the function is DROP+CREATEd (CREATE OR REPLACE can't
// change the signature) and its grants re-applied — same SECURITY DEFINER hardening as 0003.

export const up: string[] = [
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url text`,
  `DROP FUNCTION IF EXISTS app_user_memberships(uuid)`,
  `CREATE FUNCTION app_user_memberships(p_user_id uuid)
     RETURNS TABLE (org_id uuid, org_slug citext, org_name text, org_logo_url text, role text)
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT m.org_id, o.slug, o.name, o.logo_url, m.role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = p_user_id
       AND m.status = 'active'
       AND o.status <> 'deleting'
     ORDER BY o.created_at, o.slug
   $$`,
  `REVOKE ALL ON FUNCTION app_user_memberships(uuid) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_user_memberships(uuid) TO atlas_app`,
];

export const down: string[] = [
  `DROP FUNCTION IF EXISTS app_user_memberships(uuid)`,
  `ALTER TABLE organizations DROP COLUMN IF EXISTS logo_url`,
];
