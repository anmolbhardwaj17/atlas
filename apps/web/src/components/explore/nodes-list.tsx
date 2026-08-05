import Link from "next/link";
import { SearchX, Waypoints } from "lucide-react";
import { FreshnessTag } from "@/components/certainty";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/empty-state";
import { kindIcon, kindStyle, KIND_LOGO } from "@/lib/kind-visual";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { PROVIDER_META } from "@/lib/taxonomy";
import { cn } from "@/lib/cn";
import { nodeHealthState, type NodeDto } from "@/lib/graph-types";

/** The real logo for a row: a specific service logo (aws-ec2…) if we have one, else the
 *  provider's brand logo (bitbucket / github / azure / gcp / aws) - the Kind column already
 *  names the exact type, so the brand mark reads cleanly here. */
function rowLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

/** Runtime-health cell: a coloured dot + label. "Not checked" (unknown) is a designed state, shown
 *  quietly — we never fake green (docs/09 §7). Health is the signal the flat inventory was missing. */
const HEALTH_META: Record<string, { label: string; dot: string; text: string }> = {
  healthy: { label: "Healthy", dot: "bg-success", text: "text-success" },
  degraded: { label: "Degraded", dot: "bg-warning", text: "text-warning" },
  unhealthy: { label: "Unhealthy", dot: "bg-danger", text: "text-danger" },
};
function HealthCell({ node }: { node: NodeDto }) {
  const state = nodeHealthState(node);
  const meta = state ? HEALTH_META[state] : undefined;
  if (!meta) {
    return <span className="text-xs text-muted-foreground/60">Not checked</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", meta.text)}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

/** The nodes table (docs/09 §5.3) — resource · kind · health · region · freshness. Health is
 *  surfaced per row so "what’s broken" reads at a glance, matching the map + dashboard. */
export function NodesList({ nodes, filtered = false }: { nodes: NodeDto[]; filtered?: boolean }) {
  if (nodes.length === 0) {
    return filtered ? (
      <EmptyState
        icon={SearchX}
        title="No resources match these filters"
        description="Try widening or clearing the filters above."
      />
    ) : (
      <EmptyState
        icon={Waypoints}
        title="Nothing to explore yet"
        description="Connect a source (or load sample data from the dashboard) and your estate will appear here."
      />
    );
  }
  return (
    <Table wrapperClassName="rounded-lg border border-border">
      <TableHeader>
        <TableRow>
          <TableHead>Resource</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Health</TableHead>
          <TableHead className="hidden sm:table-cell">Region</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((n, i) => {
          const Icon = kindIcon(n.kind);
          const logo = rowLogo(n.kind);
          return (
            <TableRow
              key={n.id}
              className="motion-rise transition-colors hover:bg-card/60"
              style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }}
            >
              <TableCell className="py-2.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-md",
                      logo ? "bg-muted/60" : kindStyle(n.kind),
                    )}
                  >
                    {logo ? (
                      <CloudIcon name={logo} className="size-[18px]" />
                    ) : (
                      <Icon className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <Link href={`/explore/${n.id}`} className="font-medium hover:text-primary">
                      {n.name ?? <span className="text-muted-foreground">unnamed</span>}
                    </Link>
                    <div className="max-w-md truncate text-xs text-muted-foreground">{n.urn}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-2.5">
                <Badge variant="secondary" className="font-mono text-[11px] font-normal">
                  {n.kind}
                </Badge>
              </TableCell>
              <TableCell className="py-2.5">
                <HealthCell node={n} />
              </TableCell>
              <TableCell className="hidden py-2.5 text-muted-foreground sm:table-cell">
                {n.region ?? "-"}
              </TableCell>
              <TableCell className="py-2.5">
                <FreshnessTag status={n.status} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
