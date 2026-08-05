import { describe, it, expect, vi } from "vitest";
import type { Db } from "@atlas/db";
import { LeaderLockService } from "./leader-lock.service";

/**
 * The lock's contract, at the level that matters for the deploy hazard it exists to close: exactly
 * one instance runs a given tick, the connection is always returned to the pool, and losing the race
 * is a silent no-op rather than an error. (The advisory-lock semantics themselves are Postgres's;
 * these assert our wrapper honours them.)
 */
function mockDb(locked: boolean) {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked }] };
      return { rows: [] };
    }),
    release: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const db = { connect: vi.fn(async () => client) } as unknown as Db;
  return { db, client };
}

const unlockCalls = (client: { query: { mock: { calls: unknown[][] } } }) =>
  client.query.mock.calls.filter((c) => String(c[0]).includes("pg_advisory_unlock")).length;

describe("LeaderLockService", () => {
  it("runs the tick and releases the lock when it wins", async () => {
    const { db, client } = mockDb(true);
    const fn = vi.fn().mockResolvedValue(undefined);

    await expect(new LeaderLockService(db).runExclusive("healthPoll", fn)).resolves.toBe(true);

    expect(fn).toHaveBeenCalledOnce();
    expect(unlockCalls(client)).toBe(1);
    expect(client.release).toHaveBeenCalledWith(false); // healthy client goes back to the pool
  });

  it("skips the tick without erroring when another instance holds the lock", async () => {
    const { db, client } = mockDb(false);
    const fn = vi.fn();

    await expect(new LeaderLockService(db).runExclusive("healthPoll", fn)).resolves.toBe(false);

    expect(fn).not.toHaveBeenCalled();
    expect(unlockCalls(client)).toBe(0); // never held it — must not unlock someone else's lock
    expect(client.release).toHaveBeenCalled();
  });

  it("releases the lock even when the tick throws (a failed tick must not wedge the schedule)", async () => {
    const { db, client } = mockDb(true);
    const boom = new Error("tick exploded");

    await expect(
      new LeaderLockService(db).runExclusive("notificationDispatch", () => Promise.reject(boom)),
    ).rejects.toThrow(boom);

    expect(unlockCalls(client)).toBe(1);
    expect(client.release).toHaveBeenCalled();
  });

  it("uses a distinct key per scheduler so different ticks never block each other", async () => {
    const { db, client } = mockDb(true);
    const svc = new LeaderLockService(db);

    await svc.runExclusive("healthPoll", async () => {});
    await svc.runExclusive("notificationDispatch", async () => {});
    await svc.runExclusive("syncSchedule", async () => {});

    const keys = client.query.mock.calls
      .filter((c) => String(c[0]).includes("pg_try_advisory_lock"))
      .map((c) => (c[1] as number[])[1]);
    expect(new Set(keys).size).toBe(3);
  });
});
