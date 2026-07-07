"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Building2, Users, Plug, Bell, Sparkles, ShieldCheck, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/certainty";
import { EmptyState } from "@/components/patterns/empty-state";
import { OrgPanel } from "@/app/org-panel";
import { LlmSettingsCard } from "@/components/settings/llm-settings";
import { NotificationsSettingsCard } from "@/components/settings/notifications-settings";
import type { LlmSettings, NotificationStatus } from "@/lib/browser-api";

interface ConnectionDto {
  id: string;
  provider: string;
  displayName: string;
  status: string;
}
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

type Section = "general" | "members" | "integrations" | "notifications" | "ai" | "security";

/**
 * Settings, sectioned. A left sub-nav (top tabs on mobile) splits a growing set of settings
 * into focused panels instead of one long scroll. Admin-only sections (notifications, AI,
 * audit) are hidden from the nav for non-admins - matching what the API enforces.
 */
export function SettingsView({
  orgId,
  orgName,
  email,
  role,
  connections,
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
  connections: ConnectionDto[];
  members: MemberDto[];
  invites: InvitationDto[];
  llm: LlmSettings | null;
  notify: NotificationStatus | null;
  /** Server-rendered audit log, passed as a slot (it's an async server component and can't be
      imported into this client component). */
  securitySlot: ReactNode;
}) {
  const isAdmin = role === "Owner" || role === "Admin";
  const [section, setSection] = useState<Section>("general");

  const nav = (
    [
      { id: "general", label: "General", icon: Building2, show: true },
      { id: "members", label: "Members", icon: Users, show: true },
      { id: "integrations", label: "Integrations", icon: Plug, show: true },
      { id: "notifications", label: "Notifications", icon: Bell, show: isAdmin },
      { id: "ai", label: "AI model", icon: Sparkles, show: isAdmin },
      { id: "security", label: "Security", icon: ShieldCheck, show: isAdmin },
    ] as const
  ).filter((n) => n.show);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization, connected sources, and access.
        </p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-48 md:flex-col md:pb-0">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                section === n.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <n.icon className="size-4 shrink-0" /> {n.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {section === "general" ? (
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
          ) : null}

          {section === "members" ? (
            <OrgPanel orgId={orgId} initialMembers={members} initialInvites={invites} />
          ) : null}

          {section === "integrations" ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Connected sources</CardTitle>
                <Link
                  href="/integrations"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Manage <ArrowUpRight className="size-3.5" />
                </Link>
              </CardHeader>
              <CardContent>
                {connections.length === 0 ? (
                  <EmptyState
                    bare
                    icon={Plug}
                    title="No sources connected"
                    description="Connecting AWS or GitHub starts building your graph. From the dashboard you can also load sample data to explore Atlas without credentials."
                  />
                ) : (
                  <ul className="divide-y divide-border rounded-md border">
                    {connections.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <span>
                          <span className="text-muted-foreground">{c.provider}</span> ·{" "}
                          {c.displayName}
                        </span>
                        <StatusBadge status={c.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {section === "notifications" && isAdmin ? (
            <NotificationsSettingsCard orgId={orgId} initial={notify} />
          ) : null}

          {section === "ai" && isAdmin ? <LlmSettingsCard orgId={orgId} initial={llm} /> : null}

          {section === "security" && isAdmin ? securitySlot : null}
        </div>
      </div>
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
