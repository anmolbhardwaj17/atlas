import { Inject, Injectable } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import { PG_POOL } from "../core/tokens";

export type AlertPolicy = "off" | "prod" | "all";
export const ALERT_POLICIES: readonly AlertPolicy[] = ["off", "prod", "all"];
const DEFAULT_POLICY: AlertPolicy = "prod";

/**
 * Per-org alert policy (docs/plans/proactive-incidents.md) — the gate on proactive paging. `off` =
 * monitoring only (the map still turns red, nothing auto-opens); `prod` = only production regressions;
 * `all`. Default `prod`, so a fresh org is never flooded (combined with regression-only + baseline).
 */
@Injectable()
export class AlertPolicyService {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  async get(orgId: string): Promise<AlertPolicy> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ policy: AlertPolicy }>(
        `SELECT policy FROM org_alert_settings LIMIT 1`,
      );
      return rows[0]?.policy ?? DEFAULT_POLICY;
    });
  }

  async set(orgId: string, policy: AlertPolicy): Promise<AlertPolicy> {
    return withOrgScope(this.db, orgId, async (c) => {
      await c.query(
        `INSERT INTO org_alert_settings (org_id, policy)
         VALUES (NULLIF(current_setting('atlas.current_org', true), '')::uuid, $1)
         ON CONFLICT (org_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
        [policy],
      );
      return policy;
    });
  }
}
