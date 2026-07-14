import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope } from "@atlas/db";
import { NotificationService } from "./notification.service";
import type { Env } from "@atlas/config";
import type { AiService } from "../ai/ai.service";

/**
 * Per-user email preferences (incident alerts + weekly digest) and the incident-recipient exclusion
 * they drive (#44 follow-up). getEmailPrefs/setEmailPrefs only touch the DB, so the env + ai deps are
 * stubbed. Env-gated on the same DBs as the other integration suites.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("NotificationService email prefs", () => {
  let admin: Pool;
  let app: Pool;
  let svc: NotificationService;
  let orgId: string;
  let userId: string;

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    svc = new NotificationService(app, {} as Env, {} as AiService);
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    orgId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
          [`ep-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    userId = one(
      (
        await admin.query<{ id: string }>("INSERT INTO users (email) VALUES ($1) RETURNING id", [
          `ep-${randomUUID().slice(0, 8)}@example.com`,
        ])
      ).rows,
    ).id;
    await admin.query(
      "INSERT INTO memberships (org_id, user_id, role, status) VALUES ($1,$2,'Member','active')",
      [orgId, userId],
    );
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
    await admin.query("DELETE FROM users WHERE id = $1", [userId]);
  });

  it("defaults to opted-in for both emails", async () => {
    expect(await svc.getEmailPrefs(orgId, userId)).toEqual({
      incidentEmail: true,
      weeklyDigest: true,
    });
  });

  it("updates only the provided pref and persists it", async () => {
    const after = await svc.setEmailPrefs(orgId, userId, { incidentEmail: false });
    expect(after).toEqual({ incidentEmail: false, weeklyDigest: true }); // digest untouched
    // Re-read confirms it stuck.
    expect(await svc.getEmailPrefs(orgId, userId)).toEqual({
      incidentEmail: false,
      weeklyDigest: true,
    });
    // Toggling it back on works too.
    expect((await svc.setEmailPrefs(orgId, userId, { incidentEmail: true })).incidentEmail).toBe(
      true,
    );
  });

  it("excludes an opted-out member from the incident-email recipient set", async () => {
    // The exact recipient query proactive-incidents uses.
    const recipients = () =>
      withOrgScope(app, orgId, async (c) =>
        (
          await c.query<{ email: string }>(
            `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.status = 'active' AND u.email IS NOT NULL
                AND m.incident_email_opt_out = false`,
          )
        ).rows.map((r) => r.email),
      );

    expect((await recipients()).length).toBe(1); // opted-in by default → receives
    await svc.setEmailPrefs(orgId, userId, { incidentEmail: false });
    expect(await recipients()).toEqual([]); // now excluded
  });
});
