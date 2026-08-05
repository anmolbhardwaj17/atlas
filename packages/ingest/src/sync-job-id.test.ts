import { describe, it, expect } from "vitest";
import { syncJobId } from "./sync-worker";

/**
 * These assert a BullMQ constraint, not our own preference — which is exactly why they're needed.
 *
 * BullMQ refuses a custom job id containing `:` (`Custom Id cannot contain :`), because it
 * namespaces its own Redis keys with colons. Dev and CI run with `REDIS_URL` unset and fall back to
 * the in-memory queue, which accepts any string, so nothing in the test suite exercised the real
 * constraint: the first time this code met a real BullMQ was the first production sync, where every
 * enqueue failed and each run was marked failed before it started.
 */
const ORG = "6f1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6a7b";
const CONN = "11111111-2222-4333-8444-555555555555";
const RUN = "99999999-8888-4777-8666-555555555555";

describe("syncJobId", () => {
  // The bug, pinned. BullMQ's rule is a hard reject, not a sanitisation.
  it("never contains a colon — BullMQ rejects such ids outright", () => {
    expect(syncJobId({ orgId: ORG, connectionId: CONN, runId: RUN })).not.toContain(":");
  });

  it("is deterministic, so a retried enqueue dedupes instead of double-syncing", () => {
    const a = syncJobId({ orgId: ORG, connectionId: CONN, runId: RUN });
    const b = syncJobId({ orgId: ORG, connectionId: CONN, runId: RUN });
    expect(a).toBe(b);
  });

  it("is distinct per run, so a genuine re-sync is not swallowed as a duplicate", () => {
    const first = syncJobId({ orgId: ORG, connectionId: CONN, runId: RUN });
    const second = syncJobId({
      orgId: ORG,
      connectionId: CONN,
      runId: "00000000-1111-4222-8333-444444444444",
    });
    expect(first).not.toBe(second);
  });

  // Belt and braces: the id is built from UUIDs, so nothing else should sneak in either.
  it("uses only characters BullMQ accepts in a custom id", () => {
    expect(syncJobId({ orgId: ORG, connectionId: CONN, runId: RUN })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
