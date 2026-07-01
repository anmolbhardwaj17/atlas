import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { FreshnessTag } from "@/components/certainty";
import { apiGet, type ApiOk } from "@/lib/api";

interface ConnectionDto {
  id: string;
  provider: string;
  displayName: string;
  status: string;
}
interface NodeDto {
  id: string;
  kind: string;
  name: string | null;
  region: string | null;
  status: string;
}

const STATUS_COLOR: Record<string, string> = {
  connected: "text-observed",
  degraded: "text-inferred-low",
  error: "text-danger",
  verifying: "text-muted",
  pending: "text-muted",
  disconnected: "text-stale",
};

/** Dashboard (docs/09 §5.2) — the authenticated home: connections + a recent-nodes preview. */
export async function Dashboard({ orgId, token }: { orgId: string; token: string }) {
  const [conns, nodes] = await Promise.all([
    apiGet<ApiOk<ConnectionDto[]>>("/connections", { token, orgId }),
    apiGet<ApiOk<NodeDto[]>>("/nodes?limit=8", { token, orgId }),
  ]);
  const connections = conns.body?.data ?? [];
  const recentNodes = nodes.body?.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted">
          The knowledge graph of your infrastructure and code — continuously updated, cited, and
          confidence-tiered.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Connections</CardTitle>
            <Link href="/settings" className="text-xs text-primary hover:underline">
              Manage
            </Link>
          </CardHeader>
          <CardBody>
            {connections.length === 0 ? (
              <EmptyState
                title="No sources connected"
                hint="Connect AWS or GitHub to start building your graph."
              />
            ) : (
              <ul className="space-y-2">
                {connections.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <span>
                      <span className="text-muted">{c.provider}</span> · {c.displayName}
                    </span>
                    <span className={STATUS_COLOR[c.status] ?? "text-muted"}>{c.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Recent resources</CardTitle>
            <Link href="/explore" className="text-xs text-primary hover:underline">
              Explore all
            </Link>
          </CardHeader>
          <CardBody>
            {recentNodes.length === 0 ? (
              <EmptyState
                title="No resources yet"
                hint="Once a source is connected and synced, resources appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentNodes.map((n) => (
                  <li key={n.id} className="flex items-center justify-between py-1.5 text-sm">
                    <Link href={`/explore/${n.id}`} className="truncate hover:text-primary">
                      <span className="text-muted">{n.kind}</span> · {n.name ?? n.id.slice(0, 8)}
                    </Link>
                    <FreshnessTag status={n.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-fg">{title}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
