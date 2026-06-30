import { Inject, Injectable } from "@nestjs/common";
import type { Db } from "@atlas/db";
import { PG_POOL } from "../core/tokens";
import type { AuthClaims } from "./auth.types";

export interface MirroredUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * Mirrors the Supabase identity into Atlas's own `public.users` (id = auth uid)
 * and `auth_identities` (docs/12 §2.2). Idempotent upsert, run on the post-login
 * `/me` call so a `users` row always exists before any org/membership write (F1.6).
 * These tables are not RLS-scoped, so the atlas_app pool writes them directly.
 */
@Injectable()
export class UserMirrorService {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  async ensureUser(claims: AuthClaims): Promise<MirroredUser> {
    const { rows } = await this.db.query<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
    }>(
      `INSERT INTO users (id, email, name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             name = COALESCE(EXCLUDED.name, users.name),
             avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
       RETURNING id, email, name, avatar_url`,
      [claims.userId, claims.email, claims.name, claims.avatarUrl],
    );
    await this.db.query(
      `INSERT INTO auth_identities (user_id, provider, provider_subject, email_domain)
       VALUES ($1, 'google', $2, $3)
       ON CONFLICT (provider, provider_subject) DO UPDATE
         SET email_domain = EXCLUDED.email_domain`,
      [claims.userId, claims.googleSubject, claims.emailDomain],
    );

    const row = rows[0];
    if (!row) throw new Error("user upsert returned no row");
    return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url };
  }
}
