import Link from "next/link";
import {
  Boxes,
  Database,
  Layers,
  Cloud,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  Plus,
  RefreshCw,
  Map as MapIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Onboarding } from "@/components/onboarding";
import { AskLauncher } from "@/components/dashboard/ask-launcher";
import { SeverityBadge } from "@/components/tags";
import { severityMeta } from "@/lib/taxonomy";
import { apiGet, type ApiOk } from "@/lib/api";

interface Finding {
  id: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  href: string | null;
  count?: number;
}
interface TimelineEntity {
  id?: string;
  urn?: string;
  kind?: string;
  name?: string | null;
  type?: string;
  from?: { urn: string; name: string | null };
  to?: { urn: string; name: string | null };
}
interface TimelineItem {
  changeKind: "node" | "edge";
  changeType: "created" | "updated";
  at: string;
  entity: TimelineEntity;
}
interface Summary {
  inventory: {
    resources: number;
    relationships: number;
    services: number;
    datastores: number;
    environments: number;
    clouds: number;
    accounts: number;
  };
  trust: { sources: number; healthySources: number; lastSyncAt: string | null };
  crossBoundary: { crossCloud: number; crossAccount: number };
  findings: Finding[];
  activity: TimelineItem[];
}

/** Consumer dashboard (docs/09 §5.2) — answers a user's real questions: what do I have, is it
 *  trustworthy, what needs attention, what changed. Graph-derived + cited, not graph internals. */
export async function Dashboard({
  orgId,
  token,
  role,
}: {
  orgId: string;
  token: string;
  role: string;
}) {
  const res = await apiGet<ApiOk<Summary>>("/summary", { token, orgId });
  const s = res.body?.data;

  // Empty graph → the onboarding first-run experience.
  if (!s || s.inventory.resources === 0) {
    return <Onboarding orgId={orgId} canSeed={role === "Owner" || role === "Admin"} />;
  }

  const { inventory: inv, trust } = s;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <TrustPulse trust={trust} inv={inv} />
      </div>

      <AskLauncher />

      {/* At a glance — human inventory. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Boxes className="size-4" />} label="Services" value={inv.services} />
        <Stat icon={<Database className="size-4" />} label="Datastores" value={inv.datastores} />
        <Stat icon={<Layers className="size-4" />} label="Environments" value={inv.environments} />
        <Stat
          icon={<Cloud className="size-4" />}
          label="Clouds"
          value={inv.clouds}
          sub={
            inv.accounts > 0 ? `${inv.accounts} account${inv.accounts > 1 ? "s" : ""}` : undefined
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NeedsAttention findings={s.findings} />
        </div>
        <RecentActivity activity={s.activity} />
      </div>

      <MapPreview inv={inv} cross={s.crossBoundary} />
    </div>
  );
}

function TrustPulse({ trust, inv }: { trust: Summary["trust"]; inv: Summary["inventory"] }) {
  const allHealthy = trust.sources > 0 && trust.healthySources === trust.sources;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
        {inv.resources} resources · {inv.relationships} relationships
      </span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`size-1.5 rounded-full ${allHealthy ? "bg-success" : "bg-warning"}`}
          aria-hidden
        />
        {trust.healthySources}/{trust.sources} sources healthy
      </span>
      {trust.lastSyncAt ? (
        <>
          <span aria-hidden>·</span>
          <span>synced {timeAgo(trust.lastSyncAt)}</span>
        </>
      ) : null}
    </p>
  );
}

function NeedsAttention({ findings }: { findings: Finding[] }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">Needs attention</h2>
      {findings.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-6 text-sm">
          <CheckCircle2 className="size-5 text-success" />
          <div>
            <div className="font-medium">Nothing needs attention</div>
            <div className="text-muted-foreground">
              Your graph looks healthy — no risks, drift, or unhealthy sources right now.
            </div>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {findings.map((f) => (
            <FindingRow key={f.id} f={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const accent = severityMeta(f.severity).accent;
  const body = (
    <div className="flex items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/40">
      <span
        className={`mt-0.5 h-full w-0.5 shrink-0 self-stretch rounded-full ${accent}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {f.category}
          </span>
        </div>
        <div className="mt-1.5 text-sm font-medium">{f.title}</div>
        <div className="text-sm text-muted-foreground">{f.detail}</div>
      </div>
      {f.href ? <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
    </div>
  );
  return <li>{f.href ? <Link href={f.href}>{body}</Link> : body}</li>;
}

function RecentActivity({ activity }: { activity: TimelineItem[] }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">Recent activity</h2>
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent changes.</p>
      ) : (
        <ul className="space-y-3">
          {activity.map((a, i) => (
            <ActivityRow key={i} a={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({ a }: { a: TimelineItem }) {
  const isEdge = a.changeKind === "edge";
  const Icon = isEdge ? GitBranch : a.changeType === "created" ? Plus : RefreshCw;
  const label = isEdge ? "New connection" : a.changeType === "created" ? "New resource" : "Updated";
  const name = isEdge
    ? `${short(a.entity.from?.name ?? a.entity.from?.urn)} → ${short(a.entity.to?.name ?? a.entity.to?.urn)}`
    : (a.entity.name ?? shortKind(a.entity.kind));
  const href = !isEdge && a.entity.id ? `/explore/${a.entity.id}` : null;

  const inner = (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="text-muted-foreground">{label}: </span>
        <span className="font-medium">{name}</span>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</span>
    </div>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block hover:opacity-80">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

function MapPreview({
  inv,
  cross,
}: {
  inv: Summary["inventory"];
  cross: Summary["crossBoundary"];
}) {
  const crossTotal = cross.crossCloud + cross.crossAccount;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/40">
            <MapIcon className="size-5" />
          </div>
          <div>
            <div className="text-sm font-medium">Your infrastructure map</div>
            <div className="text-sm text-muted-foreground">
              {inv.resources} resources across {inv.clouds} cloud{inv.clouds === 1 ? "" : "s"}
              {crossTotal > 0
                ? ` · ${crossTotal} cross-boundary connection${crossTotal > 1 ? "s" : ""}`
                : ""}
            </div>
          </div>
        </div>
        <Link
          href="/map"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:border-foreground/40"
        >
          Open map <ArrowRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
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
  sub?: string | undefined;
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

function short(s: string | null | undefined): string {
  if (!s) return "?";
  const tail = s.includes(":") ? (s.split(":").pop() ?? s) : s;
  return tail.length > 22 ? `${tail.slice(0, 21)}…` : tail;
}
function shortKind(kind: string | undefined): string {
  return kind
    ? kind.replace(/^aws\.|^github\.|^external\.|^atlas\.|^azure\.|^gcp\.|^bitbucket\./, "")
    : "resource";
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
