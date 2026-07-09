"use client";

import { type ReactNode } from "react";
import { OrgPanel } from "@/app/org-panel";
import { ProfileCard } from "@/components/settings/profile-card";
import { OrgCard } from "@/components/settings/org-card";
import { LlmSettingsCard } from "@/components/settings/llm-settings";
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

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your organization, team, and access.</p>
      </div>

      {/* Profile + Organization sit side by side on wider screens, stretched to equal height
          (grid's default align-items: stretch) so they stay level even while editing. */}
      <div className="grid gap-6 md:grid-cols-2">
        <ProfileCard name={name} email={email} avatarUrl={avatarUrl} />
        <OrgCard
          orgId={orgId}
          orgName={orgName}
          role={role}
          memberCount={members.length}
          canEdit={isAdmin}
        />
      </div>

      {isAdmin ? <LlmSettingsCard orgId={orgId} initial={llm} /> : null}

      <OrgPanel
        orgId={orgId}
        currentRole={role}
        currentEmail={email}
        initialMembers={members}
        initialInvites={invites}
      />

      {isAdmin ? securitySlot : null}
    </div>
  );
}
