import { describe, it, expect } from "vitest";
import type { Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import { InvitationService } from "./invitation.service";
import type { UserMirrorService } from "../auth/user-mirror.service";
import type { EmailService } from "../core/email.service";
import type { RateLimitService } from "../core/rate-limit.service";
import type { AuthClaims } from "../auth/auth.types";

// Security sweep H4: the invite-accept email gate is what stops one person's token from joining
// another person's org. Every rejection branch returns BEFORE the membership write, so a stubbed
// `db` (returning a canned invite from app_invitation_by_token) unit-tests them without a real DB.

interface CannedInvite {
  id: string;
  org_id: string;
  email: string;
  role: "Member";
  status: string;
  expires_at: Date;
}

function service(invite: CannedInvite | null): InvitationService {
  const db = {
    query: async () => ({ rows: invite ? [invite] : [] }),
  } as unknown as Db;
  return new InvitationService(
    db,
    {} as Env,
    {} as UserMirrorService,
    {} as EmailService,
    {} as RateLimitService,
  );
}

const claims = (over: Partial<AuthClaims> = {}): AuthClaims =>
  ({
    userId: "user-1",
    email: "invitee@acme.com",
    emailVerified: true,
    ...over,
  }) as AuthClaims;

const pendingInvite = (over: Partial<CannedInvite> = {}): CannedInvite => ({
  id: "inv-1",
  org_id: "org-1",
  email: "invitee@acme.com",
  role: "Member",
  status: "pending",
  expires_at: new Date(Date.now() + 60_000),
  ...over,
});

describe("InvitationService.accept — email gate", () => {
  it("refuses an unverified email → 403 (before any lookup)", async () => {
    await expect(
      service(pendingInvite()).accept("tok", claims({ emailVerified: false })),
    ).rejects.toMatchObject({ code: "org_access_denied" });
  });

  it("refuses when the token matches no invite → 404", async () => {
    await expect(service(null).accept("tok", claims())).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a non-pending (revoked/accepted) invite → 422", async () => {
    await expect(
      service(pendingInvite({ status: "revoked" })).accept("tok", claims()),
    ).rejects.toMatchObject({ code: "invalid_state_transition" });
  });

  it("refuses an expired invite → 422", async () => {
    await expect(
      service(pendingInvite({ expires_at: new Date(Date.now() - 1000) })).accept("tok", claims()),
    ).rejects.toMatchObject({ code: "invalid_state_transition" });
  });

  it("refuses when the signed-in email differs from the invited email → 403", async () => {
    await expect(
      service(pendingInvite({ email: "someone-else@acme.com" })).accept("tok", claims()),
    ).rejects.toMatchObject({ code: "org_access_denied" });
  });

  it("matches the invited email case-insensitively (gate passes, proceeds past the check)", async () => {
    // Same address, different case — must NOT be rejected by the email gate. It then proceeds to
    // ensureUser (undefined stub) and throws there, so we assert it is NOT a 403 email refusal.
    await expect(
      service(pendingInvite({ email: "Invitee@ACME.com" })).accept("tok", claims()),
    ).rejects.not.toMatchObject({ code: "org_access_denied" });
  });
});
