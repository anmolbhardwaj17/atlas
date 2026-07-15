"use client";

import { type ReactNode } from "react";
import { OrgPanel } from "@/app/org-panel";
import { ProfileCard } from "@/components/settings/profile-card";
import { OrgCard } from "@/components/settings/org-card";
import { DangerZoneCard } from "@/components/settings/danger-zone-card";
import { LlmSettingsCard } from "@/components/settings/llm-settings";
import { AlertSettingsCard } from "@/components/settings/alert-settings";
import { EmailPrefsCard } from "@/components/settings/email-prefs";
import { PrivacyDataCard } from "@/components/settings/privacy-data";
import type { LlmSettings } from "@/lib/browser-api";

interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
}
interface InvitationDto {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

/**
 * Settings - a single, constrained column. There isn't enough here to warrant tabs or a
 * sub-nav; everything is visible at a glance. Admin-only blocks (AI model, activity log)
 * simply don't render for non-admins - matching what the API enforces. Alert channels
 * (Slack/Discord/Teams) live in the Integrations hub, not here.
 */
export function SettingsView({
  orgId,
  orgName,
  orgLogoUrl,
  email,
  role,
  name,
  avatarUrl,
  members,
  invites,
  llm,
  securitySlot,
}: {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  email: string;
  role: string;
  name: string | null;
  avatarUrl: string | null;
  members: MemberDto[];
  invites: InvitationDto[];
  llm: LlmSettings | null;
  /** Server-rendered audit log, passed as a slot (it's an async server component and can't be
      imported into this client component). */
  securitySlot: ReactNode;
}) {
  const isAdmin = role === "Owner" || role === "Admin";
  const isOwner = role === "Owner";

  return (
    <div className="motion-stagger space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your organization, team, and access.</p>
      </div>

      {/* Profile + Organization side by side; cards stretch to equal height (default `stretch`). */}
      <div className="grid gap-6 md:grid-cols-2">
        <ProfileCard name={name} email={email} avatarUrl={avatarUrl} />
        <OrgCard orgId={orgId} orgName={orgName} orgLogoUrl={orgLogoUrl} canEdit={isAdmin} />
      </div>

      {isAdmin ? <LlmSettingsCard orgId={orgId} initial={llm} /> : null}

      {isAdmin ? <AlertSettingsCard orgId={orgId} /> : null}

      {/* Per-user email prefs — self-scoped, so every member sees this (not admin-gated). */}
      <EmailPrefsCard orgId={orgId} />

      <OrgPanel
        orgId={orgId}
        currentRole={role}
        currentEmail={email}
        initialMembers={members}
        initialInvites={invites}
      />

      {/* DSAR admin surface (export + person erasure) — Admin-only, matching the API. */}
      {isAdmin ? <PrivacyDataCard orgId={orgId} /> : null}

      {isAdmin ? securitySlot : null}

      {/* Deleting the org is Owner-only — the most destructive action, kept at the very bottom. */}
      {isOwner ? <DangerZoneCard orgId={orgId} orgName={orgName} /> : null}
    </div>
  );
}
