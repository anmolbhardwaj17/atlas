"use client";

import { type ReactNode } from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrgPanel } from "@/app/org-panel";
import { ProfileCard } from "@/components/settings/profile-card";
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
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your organization, team, and access.</p>
      </div>

      {/* Profile + Organization sit side by side on wider screens, stretched to equal height
          (grid's default align-items: stretch) so they stay level even while editing. */}
      <div className="grid gap-6 md:grid-cols-2">
        <ProfileCard name={name} email={email} avatarUrl={avatarUrl} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4" /> Organization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Name" value={orgName} />
              <Row label="Organization ID" value={orgId} mono />
              <Row label="Your role" value={role} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {isAdmin ? <LlmSettingsCard orgId={orgId} initial={llm} /> : null}

      <OrgPanel orgId={orgId} initialMembers={members} initialInvites={invites} />

      {isAdmin ? securitySlot : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono ? "font-mono text-xs" : "font-medium")}>{value}</dd>
    </div>
  );
}
