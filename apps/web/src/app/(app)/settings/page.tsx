import { Plug } from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { OrgPanel } from "@/app/org-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/certainty";
import { EmptyState } from "@/components/patterns/empty-state";
import { AuditLog } from "@/components/settings/audit-log";

export const dynamic = "force-dynamic";

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

export default async function SettingsPage() {
  const shell = await requireShell();
  const auth = { token: shell.token, orgId: shell.orgId };
  // Server-fetch everything with the reliable server session (no client auth race).
  const [conns, members, invites] = await Promise.all([
    apiGet<ApiOk<ConnectionDto[]>>("/connections", auth).then((r) => r.body?.data ?? []),
    apiGet<ApiOk<MemberDto[]>>(`/orgs/${shell.orgId}/members`, auth).then(
      (r) => r.body?.data ?? [],
    ),
    apiGet<ApiOk<InvitationDto[]>>(`/orgs/${shell.orgId}/invitations`, auth).then(
      (r) => r.body?.data ?? [],
    ),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Organization, connected sources, and access.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{shell.orgName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Organization ID</dt>
              <dd className="font-mono text-xs">{shell.orgId}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Signed in as</dt>
              <dd>{shell.email}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected sources</CardTitle>
        </CardHeader>
        <CardContent>
          {conns.length === 0 ? (
            <EmptyState
              bare
              icon={Plug}
              title="No sources connected"
              description="Connecting AWS or GitHub starts building your graph. From the dashboard you can also load sample data to explore Atlas without credentials."
            />
          ) : (
            <ul className="divide-y divide-border rounded-md border">
              {conns.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    <span className="text-muted-foreground">{c.provider}</span> · {c.displayName}
                  </span>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <OrgPanel orgId={shell.orgId} initialMembers={members} initialInvites={invites} />

      {/* Activity log is Admin+ (names actors + actions); the API also enforces this. */}
      {shell.role === "Owner" || shell.role === "Admin" ? (
        <AuditLog orgId={shell.orgId} token={shell.token} />
      ) : null}
    </div>
  );
}
