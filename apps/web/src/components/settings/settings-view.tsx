"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrgPanel } from "@/app/org-panel";
import { LlmSettingsCard } from "@/components/settings/llm-settings";
import { NotificationsSettingsCard } from "@/components/settings/notifications-settings";
import type { LlmSettings, NotificationStatus } from "@/lib/browser-api";

interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
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
 * sub-nav; everything is visible at a glance. Admin-only blocks (alerts, AI model, activity
 * log) simply don't render for non-admins - matching what the API enforces.
 */
export function SettingsView({
  orgId,
  orgName,
  email,
  role,
  members,
  invites,
  llm,
  notify,
  securitySlot,
}: {
  orgId: string;
  orgName: string;
  email: string;
  role: string;
  members: MemberDto[];
  invites: InvitationDto[];
  llm: LlmSettings | null;
  notify: NotificationStatus | null;
  /** Server-rendered audit log, passed as a slot (it's an async server component and can't be
      imported into this client component). */
  securitySlot: ReactNode;
}) {
  const isAdmin = role === "Owner" || role === "Admin";

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your organization, team, and access.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={orgName} />
            <Row label="Organization ID" value={orgId} mono />
            <Row label="Signed in as" value={email} />
            <Row label="Your role" value={role} />
          </dl>
        </CardContent>
      </Card>

      <OrgPanel orgId={orgId} initialMembers={members} initialInvites={invites} />

      {isAdmin ? (
        <>
          <NotificationsSettingsCard orgId={orgId} initial={notify} />
          <LlmSettingsCard orgId={orgId} initial={llm} />
          {securitySlot}
        </>
      ) : null}
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
