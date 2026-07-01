import Link from "next/link";
import { Boxes, GitBranch, Sparkles, Plug } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FreshnessTag } from "@/components/certainty";
import { Onboarding } from "@/components/onboarding";
import { apiGet, type ApiOk } from "@/lib/api";

interface Overview {
  nodeCount: number;
  edgeCount: number;
  byKind: Array<{ kind: string; n: number }>;
  edgesByConfidence: { observed: number; inferredHigh: number; inferredLow: number };
  connections: Array<{ id: string; provider: string; displayName: string; status: string }>;
  lastSyncAt: string | null;
}
interface NodeDto {
  id: string;
  kind: string;
  name: string | null;
  status: string;
}

/** Dashboard (docs/09 §5.2) — the authenticated home: headline metrics, graph
 *  composition, certainty mix, and a recent-resources peek. */
export async function Dashboard({
  orgId,
  token,
  role,
}: {
  orgId: string;
  token: string;
  role: string;
}) {
  const [ovRes, nodesRes] = await Promise.all([
    apiGet<ApiOk<Overview>>("/overview", { token, orgId }),
    apiGet<ApiOk<NodeDto[]>>("/nodes?limit=6", { token, orgId }),
  ]);
  const ov = ovRes.body?.data;
  const recent = nodesRes.body?.data ?? [];

  // Empty graph → the onboarding first-run experience (choose a source / load sample data).
  if (!ov || ov.nodeCount === 0) {
    return <Onboarding orgId={orgId} canSeed={role === "Owner" || role === "Admin"} />;
  }

  const inferred = ov.edgesByConfidence.inferredHigh + ov.edgesByConfidence.inferredLow;
  const inferredPct = ov.edgeCount > 0 ? Math.round((inferred / ov.edgeCount) * 100) : 0;
  const topKinds = ov.byKind.slice(0, 8);
  const maxKind = topKinds[0]?.n ?? 1;

  return (
    <div className="space-y-6">
      <Header lastSyncAt={ov.lastSyncAt} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Boxes className="size-4" />} label="Resources" value={ov.nodeCount} />
        <Stat icon={<GitBranch className="size-4" />} label="Relationships" value={ov.edgeCount} />
        <Stat
          icon={<Sparkles className="size-4" />}
          label="Inferred edges"
          value={`${inferred}`}
          sub={`${inferredPct}% of graph`}
        />
        <Stat icon={<Plug className="size-4" />} label="Sources" value={ov.connections.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Certainty mix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ConfBar
              label="Observed"
              n={ov.edgesByConfidence.observed}
              total={ov.edgeCount}
              shade="bg-foreground"
            />
            <ConfBar
              label="Inferred · high"
              n={ov.edgesByConfidence.inferredHigh}
              total={ov.edgeCount}
              shade="bg-foreground/60"
            />
            <ConfBar
              label="Inferred · low"
              n={ov.edgesByConfidence.inferredLow}
              total={ov.edgeCount}
              shade="bg-foreground/30"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Composition</CardTitle>
            <Link href="/explore" className="text-xs text-muted-foreground hover:text-foreground">
              Explore all
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {topKinds.map((k) => (
              <div key={k.kind} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 truncate text-muted-foreground">{k.kind}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: `${Math.max(6, Math.round((k.n / maxKind) * 100))}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right tabular-nums">{k.n}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Recent resources</CardTitle>
          <Link href="/explore" className="text-xs text-muted-foreground hover:text-foreground">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {recent.map((n) => (
              <li key={n.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/explore/${n.id}`} className="truncate hover:text-primary">
                  <span className="text-muted-foreground">{n.kind}</span> ·{" "}
                  {n.name ?? n.id.slice(0, 8)}
                </Link>
                <FreshnessTag status={n.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Header({ lastSyncAt }: { lastSyncAt?: string | null }) {
  return (
    <div>
      <h1 className="text-xl font-semibold">Overview</h1>
      <p className="text-sm text-muted-foreground">
        Your infrastructure and code as one continuously-updated, cited knowledge graph.
        {lastSyncAt ? ` Last synced ${new Date(lastSyncAt).toLocaleString()}.` : ""}
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function ConfBar({
  label,
  n,
  total,
  shade,
}: {
  label: string;
  n: number;
  total: number;
  shade: string;
}) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${shade}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums">{n}</span>
    </div>
  );
}
