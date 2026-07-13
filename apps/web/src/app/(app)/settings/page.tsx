import { Suspense } from "react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { SettingsView } from "@/components/settings/settings-view";
import { AuditLog } from "@/components/settings/audit-log";
import type { LlmSettings } from "@/lib/browser-api";
import SettingsLoading from "./loading";

export const dynamic = "force-dynamic";

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

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  const shell = await requireShell();
  const auth = { token: shell.token, orgId: shell.orgId };
  const isAdmin = shell.role === "Owner" || shell.role === "Admin";
  // Server-fetch everything with the reliable server session (no client auth race).
  const [members, invites, llm] = await Promise.all([
    apiGet<ApiOk<MemberDto[]>>(`/orgs/${shell.orgId}/members`, auth).then(
      (r) => r.body?.data ?? [],
    ),
    apiGet<ApiOk<InvitationDto[]>>(`/orgs/${shell.orgId}/invitations`, auth).then(
      (r) => r.body?.data ?? [],
    ),
    apiGet<ApiOk<LlmSettings | null>>("/ai/settings", auth).then((r) => r.body?.data ?? null),
  ]);

  return (
    <SettingsView
      orgId={shell.orgId}
      orgName={shell.orgName}
      orgLogoUrl={shell.orgLogoUrl}
      email={shell.email}
      role={shell.role}
      name={shell.name}
      avatarUrl={shell.avatarUrl}
      members={members}
      invites={invites}
      llm={llm}
      securitySlot={isAdmin ? <AuditLog orgId={shell.orgId} token={shell.token} /> : null}
    />
  );
}
