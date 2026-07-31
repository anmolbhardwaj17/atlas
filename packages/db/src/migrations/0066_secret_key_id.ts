// Secret key-rotation support (compliance close-out). The Secrets Broker encrypted every
// connection credential with a single env key (SECRET_ENCRYPTION_KEY) and stored no record of WHICH
// key — so the key could never be rotated without losing access to every existing secret. This adds
// a `key_id` tag per row (a non-secret hash of the key that wrote it), so the broker can hold a
// PRIMARY key (new writes) plus RETIRED keys (decrypt-only) and re-wrap old rows onto the primary.
// Existing rows keep key_id NULL (written before rotation was possible); the broker falls back to
// trying every configured key (GCM's auth tag makes that safe) until one authenticates.

export const up: string[] = [`ALTER TABLE connection_secrets ADD COLUMN IF NOT EXISTS key_id text`];

export const down: string[] = [`ALTER TABLE connection_secrets DROP COLUMN IF EXISTS key_id`];
