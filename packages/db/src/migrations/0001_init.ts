// Core platform tables (docs/04 §5.1). Plain SQL statements run by our migration
// runner (src/migrate.ts) via the simple query protocol.

export const up: string[] = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `CREATE EXTENSION IF NOT EXISTS citext`,

  `CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
     BEGIN NEW.updated_at = now(); RETURN NEW; END;
   $$ LANGUAGE plpgsql`,

  `CREATE TABLE organizations (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     slug        citext NOT NULL UNIQUE,
     name        text   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
     plan        text   NOT NULL DEFAULT 'trial',
     status      text   NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','suspended','deleting')),
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now(),
     deleted_at  timestamptz,
     CONSTRAINT slug_format CHECK (slug ~ '^[a-z0-9-]{3,40}$')
   )`,
  `CREATE TRIGGER trg_org_updated BEFORE UPDATE ON organizations
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

  `CREATE TABLE users (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     email       citext NOT NULL UNIQUE,
     name        text,
     avatar_url  text,
     status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,

  `CREATE TABLE auth_identities (
     id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     provider         text NOT NULL CHECK (provider IN ('google','password')),
     provider_subject text,
     email_domain     text,
     password_hash    text,
     created_at       timestamptz NOT NULL DEFAULT now(),
     UNIQUE (provider, provider_subject),
     CHECK ( (provider='password' AND password_hash    IS NOT NULL)
          OR (provider='google'   AND provider_subject IS NOT NULL) )
   )`,

  `CREATE TABLE memberships (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role        text NOT NULL CHECK (role IN ('Owner','Admin','Member')),
     status      text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','invited','revoked','requested')),
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now(),
     UNIQUE (org_id, user_id)
   )`,
  `CREATE TRIGGER trg_mem_updated BEFORE UPDATE ON memberships
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE INDEX ix_memberships_user ON memberships(user_id)`,

  `CREATE TABLE invitations (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     email       citext NOT NULL,
     role        text NOT NULL CHECK (role IN ('Admin','Member')),
     token_hash  text NOT NULL,
     status      text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','expired','revoked')),
     invited_by  uuid REFERENCES users(id),
     created_at  timestamptz NOT NULL DEFAULT now(),
     expires_at  timestamptz NOT NULL,
     CHECK (expires_at > created_at)
   )`,
  `CREATE UNIQUE INDEX uq_invite_live ON invitations(org_id, email) WHERE status = 'pending'`,
];

export const down: string[] = [
  `DROP TABLE IF EXISTS invitations, memberships, auth_identities, users, organizations CASCADE`,
  `DROP FUNCTION IF EXISTS set_updated_at()`,
];
