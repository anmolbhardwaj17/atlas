import { describe, it, expect } from "vitest";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("reports ok status", () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: "ok" });
  });
});
