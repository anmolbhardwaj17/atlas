import { describe, it, expect } from "vitest";
import { DEFAULT_JOB_OPTIONS } from "./bullmq-queue";

/**
 * The production queue's resilience defaults are load-bearing: without bounded retries a worker
 * crash / thrown handler is a silently-lost sync, and without removeOnComplete/Fail Redis grows
 * without bound. These aren't behavioral (that needs a live Redis — ledgered), they pin the config
 * so it can't regress back to the "attempts:1, keep-forever" default this fixed.
 */
describe("BullMQ resilience defaults", () => {
  it("retries with exponential backoff", () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toMatchObject({ type: "exponential" });
    expect((DEFAULT_JOB_OPTIONS.backoff as { delay: number }).delay).toBeGreaterThan(0);
  });

  it("bounds Redis growth (trims completed + failed job records)", () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toBeTruthy();
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBeTruthy();
  });
});
