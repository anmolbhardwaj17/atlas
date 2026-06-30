import { describe, it, expect } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { Role } from "@atlas/db";
import { RolesGuard } from "./roles.guard";
import { ApiException } from "../common/errors";

function context(role?: Role): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ org: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(min: Role | undefined): RolesGuard {
  const reflector = { getAllAndOverride: () => min } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe("RolesGuard", () => {
  it("allows when no role is required", () => {
    expect(guardRequiring(undefined).canActivate(context())).toBe(true);
  });

  it("allows when the caller's role meets or exceeds the minimum", () => {
    expect(guardRequiring("Member").canActivate(context("Owner"))).toBe(true);
    expect(guardRequiring("Admin").canActivate(context("Admin"))).toBe(true);
    expect(guardRequiring("Member").canActivate(context("Member"))).toBe(true);
  });

  it("denies (insufficient_role) when the role is too low", () => {
    for (const [min, role] of [
      ["Admin", "Member"],
      ["Owner", "Admin"],
      ["Owner", "Member"],
    ] as Array<[Role, Role]>) {
      try {
        guardRequiring(min).canActivate(context(role));
        throw new Error(`expected denial for ${role} < ${min}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ApiException);
        expect((e as ApiException).code).toBe("insufficient_role");
      }
    }
  });

  it("denies when there is no org role at all", () => {
    expect(() => guardRequiring("Member").canActivate(context())).toThrow(ApiException);
  });
});
