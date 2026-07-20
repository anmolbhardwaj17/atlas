import { describe, it, expect, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import type { Db } from "@atlas/db";

const dbWith = (query: () => Promise<unknown>) => ({ query }) as unknown as Db;

describe("HealthController", () => {
  it("liveness reports ok without touching the DB", () => {
    const controller = new HealthController(dbWith(() => Promise.reject(new Error("unused"))));
    expect(controller.check()).toEqual({ status: "ok" });
  });

  it("readiness returns ready when the DB responds", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const controller = new HealthController(dbWith(query));
    await expect(controller.ready()).resolves.toEqual({ status: "ready", db: "up" });
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });

  it("readiness throws 503 when the DB is unreachable", async () => {
    const controller = new HealthController(dbWith(() => Promise.reject(new Error("pool dead"))));
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
