import { describe, it, expect } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { TenantScopeGuard } from "./tenant-scope.guard";
import type { MembershipService, OrgMembership } from "./membership.service";
import { ApiException } from "../common/errors";

// Security sweep H4: the R8 404-vs-403 distinction is existential — a cross-tenant PATH id must 404
// (never confirm another org exists), while a bad X-Atlas-Org HEADER is a 403. Pure request logic,
// no DB: a stub MembershipService returns a fixed membership set.

const MEMBER_ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";

function stubMemberships(orgs: string[]): MembershipService {
  return {
    listForUser: async (): Promise<OrgMembership[]> =>
      orgs.map((id) => ({
        id,
        slug: `s-${id.slice(0, 4)}`,
        name: "Org",
        logoUrl: null,
        role: "Member",
      })),
  } as unknown as MembershipService;
}

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const guard = (orgs: string[]): TenantScopeGuard => new TenantScopeGuard(stubMemberships(orgs));

const authed = { auth: { userId: "user-1", email: "u@acme.com" } };

describe("TenantScopeGuard", () => {
  it("attaches req.org and allows a member (via header)", async () => {
    const req: Record<string, unknown> = {
      ...authed,
      params: {},
      headers: { "x-atlas-org": MEMBER_ORG },
    };
    await expect(guard([MEMBER_ORG]).canActivate(ctx(req))).resolves.toBe(true);
    expect((req.org as { id: string }).id).toBe(MEMBER_ORG);
  });

  it("a non-member PATH id → 404 (existence not leaked, R8)", async () => {
    const req = { ...authed, params: { orgId: OTHER_ORG }, headers: {} };
    await expect(guard([MEMBER_ORG]).canActivate(ctx(req))).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("a non-member HEADER org → 403 org_access_denied", async () => {
    const req = { ...authed, params: {}, headers: { "x-atlas-org": OTHER_ORG } };
    await expect(guard([MEMBER_ORG]).canActivate(ctx(req))).rejects.toMatchObject({
      code: "org_access_denied",
    });
  });

  it("no org selected at all → 403 org_access_denied", async () => {
    const req = { ...authed, params: {}, headers: {} };
    await expect(guard([MEMBER_ORG]).canActivate(ctx(req))).rejects.toBeInstanceOf(ApiException);
  });

  it("missing auth context → throws (must run after AuthGuard)", async () => {
    const req = { params: {}, headers: { "x-atlas-org": MEMBER_ORG } };
    await expect(guard([MEMBER_ORG]).canActivate(ctx(req))).rejects.toBeTruthy();
  });
});
