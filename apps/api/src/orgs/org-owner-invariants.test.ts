import { describe, it, expect } from "vitest";
import type { Role } from "@atlas/db";
import { memberMutationAuthError, dropsLastOwner } from "./org.service";

/**
 * RBAC Owner-protection invariants (BR-MEM-2/3, BR-ORG-1; docs/12 §5.2), unit-tested exhaustively.
 * These are the rules that keep an org from losing its last Owner or letting a non-Owner tamper with
 * ownership — previously reachable only through DB-gated integration tests (rbac-audit.md §residual).
 * The logic is pure, so we can enumerate every actor × target × new-role combination directly.
 */
const ROLES: Role[] = ["Owner", "Admin", "Member"];

describe("memberMutationAuthError (BR-MEM-3)", () => {
  it("lets an Owner do anything (modify an Owner, grant Owner)", () => {
    for (const target of ROLES) {
      for (const next of [...ROLES, null] as (Role | null)[]) {
        expect(memberMutationAuthError("Owner", target, next)).toBeNull();
      }
    }
  });

  it("blocks a non-Owner from modifying or removing an Owner", () => {
    for (const caller of ["Admin", "Member"] as Role[]) {
      const modify = memberMutationAuthError(caller, "Owner", "Member");
      expect(modify?.code).toBe("insufficient_role");
      expect(modify?.message).toContain("modify an Owner");

      const remove = memberMutationAuthError(caller, "Owner", null);
      expect(remove?.code).toBe("insufficient_role");
      expect(remove?.message).toContain("remove an Owner");
    }
  });

  it("blocks a non-Owner from granting the Owner role (escalation)", () => {
    for (const caller of ["Admin", "Member"] as Role[]) {
      for (const target of ["Admin", "Member"] as Role[]) {
        const err = memberMutationAuthError(caller, target, "Owner");
        expect(err?.code).toBe("insufficient_role");
        expect(err?.message).toContain("grant the Owner role");
      }
    }
  });

  it("allows an Admin to manage non-Owner members", () => {
    expect(memberMutationAuthError("Admin", "Member", "Admin")).toBeNull();
    expect(memberMutationAuthError("Admin", "Admin", "Member")).toBeNull();
    expect(memberMutationAuthError("Admin", "Member", null)).toBeNull();
  });
});

describe("dropsLastOwner (BR-MEM-2 / BR-ORG-1)", () => {
  it("blocks demoting the last (sole) Owner", () => {
    expect(dropsLastOwner("Owner", "Admin", 1)).toBe(true);
    expect(dropsLastOwner("Owner", "Member", 1)).toBe(true);
  });

  it("blocks removing the last (sole) Owner (newRole null)", () => {
    expect(dropsLastOwner("Owner", null, 1)).toBe(true);
  });

  it("allows demoting/removing an Owner when another Owner remains", () => {
    expect(dropsLastOwner("Owner", "Admin", 2)).toBe(false);
    expect(dropsLastOwner("Owner", null, 2)).toBe(false);
  });

  it("never fires when the target stays an Owner, or isn't an Owner", () => {
    expect(dropsLastOwner("Owner", "Owner", 1)).toBe(false); // no ownership change
    expect(dropsLastOwner("Admin", "Member", 1)).toBe(false);
    expect(dropsLastOwner("Member", null, 1)).toBe(false);
  });
});
