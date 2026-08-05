import { ScrollText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/patterns/empty-state";
import { apiGet, type ApiOk } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface AuditEventView {
  id: string;
  action: string;
  actor: { userId: string | null; email: string | null };
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
  createdAt: string;
}

/** Human labels for the stable action verbs the API records (docs/13 §8). */
const ACTION_LABEL: Record<string, string> = {
  "org.create": "Created the organization",
  "member.role_change": "Changed a member’s role",
  "member.remove": "Removed a member",
  "invitation.create": "Invited a member",
  "invitation.revoke": "Revoked an invitation",
  "connection.verify": "Verified a connection",
  "connection.disconnect": "Disconnected a source",
  "demo.seed": "Loaded sample data",
};

/**
 * Activity log (docs/13 §8 - "trust is visible"). Admin-only view of the org's recent
 * security-relevant actions. Server-rendered; reads the append-only `/audit` feed.
 */
export async function AuditLog({ orgId, token }: { orgId: string; token: string }) {
  const res = await apiGet<ApiOk<AuditEventView[]>>("/audit?limit=50", { token, orgId });
  const events = res.body?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4" /> Activity log
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState
            bare
            icon={ScrollText}
            title="No activity yet"
            description="Security-relevant actions — organization, member, and connection changes — will appear here."
          />
        ) : (
          <ul className="-mr-2 max-h-96 divide-y divide-border overflow-y-auto pr-2">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
                  {e.targetType && e.targetId ? (
                    <span className="ml-1 text-muted-foreground">
                      · {e.targetType} {shortId(e.targetId)}
                    </span>
                  ) : null}
                  <div className="truncate text-xs text-muted-foreground">
                    {e.actor.email ?? "system"}
                  </div>
                </div>
                <time
                  dateTime={e.createdAt}
                  className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
                  title={new Date(e.createdAt).toLocaleString()}
                >
                  {timeAgo(e.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
