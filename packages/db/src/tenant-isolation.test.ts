import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createDb, withOrgScope, type Db } from "./client";

/**
 * Integration test for the RLS tenant-isolation backstop (docs/04 §10, docs/13 §6,
 * the foundation of US-12). Requires a real Postgres with migrations applied.
 * Env-gated: skipped when TEST_DATABASE_URL is unset (so unit `pnpm test`/CI stay
 * green without a DB). The harness sets it after running migrations.
 */
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("tenant isolation (RLS on memberships)", () => {
  let db: Db;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];

  const newSlug = () => `test-${randomUUID().slice(0, 8)}`;
  const newEmail = () => `${randomUUID().slice(0, 12)}@example.com`;

  beforeAll(async () => {
    db = createDb(url as string);
    // Seed as the connecting (owner) role, which bypasses RLS — set up two orgs,
    // each with one member.
    const org = async (): Promise<string> => {
      const row = await db
        .insertInto("organizations")
        .values({ slug: newSlug(), name: "Test Org" })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    };
    const user = async (): Promise<string> => {
      const row = await db
        .insertInto("users")
        .values({ email: newEmail() })
        .returning("id")
        .executeTakeFirstOrThrow();
      userIds.push(row.id);
      return row.id;
    };

    orgA = await org();
    orgB = await org();
    const uA = await user();
    const uB = await user();
    await db
      .insertInto("memberships")
      .values({ org_id: orgA, user_id: uA, role: "Owner" })
      .execute();
    await db
      .insertInto("memberships")
      .values({ org_id: orgB, user_id: uB, role: "Owner" })
      .execute();
  });

  afterAll(async () => {
    if (!db) return;
    await db.deleteFrom("organizations").where("id", "in", [orgA, orgB]).execute();
    if (userIds.length) {
      await db.deleteFrom("users").where("id", "in", userIds).execute();
    }
    await db.destroy();
  });

  it("under an org context, sees only that org's memberships", async () => {
    const rows = await withOrgScope(db, orgA, (trx) =>
      trx.selectFrom("memberships").selectAll().execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === orgA)).toBe(true);
    expect(rows.some((r) => r.org_id === orgB)).toBe(false);
  });

  it("cannot reach another org by switching context", async () => {
    const rowsB = await withOrgScope(db, orgB, (trx) =>
      trx.selectFrom("memberships").selectAll().execute(),
    );
    expect(rowsB.every((r) => r.org_id === orgB)).toBe(true);
    expect(rowsB.some((r) => r.org_id === orgA)).toBe(false);
  });

  it("fails closed: no org context (as atlas_app) sees nothing", async () => {
    const rows = await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL ROLE atlas_app`.execute(trx);
      return trx.selectFrom("memberships").selectAll().execute();
    });
    expect(rows.length).toBe(0);
  });
});
