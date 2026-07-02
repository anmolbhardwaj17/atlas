import { Inject, Injectable } from "@nestjs/common";
import type { Db } from "@atlas/db";
import type { Role } from "@atlas/db";
import { PG_POOL } from "../core/tokens";

export interface OrgMembership {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

/**
 * Resolves which orgs the authenticated user belongs to (docs/12 §4 step 2). Uses
 * the `app_user_memberships` SECURITY DEFINER function (migration 0003) - the only
 * sanctioned cross-org read, keyed strictly to one user - so the atlas_app pool
 * stays non-bypass. Returns active memberships only; empty for a brand-new user.
 */
@Injectable()
export class MembershipService {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  async listForUser(userId: string): Promise<OrgMembership[]> {
    const { rows } = await this.db.query<{
      org_id: string;
      org_slug: string;
      org_name: string;
      role: Role;
    }>("SELECT org_id, org_slug, org_name, role FROM app_user_memberships($1)", [userId]);
    return rows.map((r) => ({ id: r.org_id, slug: r.org_slug, name: r.org_name, role: r.role }));
  }
}
