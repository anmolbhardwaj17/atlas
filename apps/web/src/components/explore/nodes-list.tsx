import Link from "next/link";
import { SearchX } from "lucide-react";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { kindIcon, kindStyle, KIND_LOGO } from "@/lib/kind-visual";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { PROVIDER_META } from "@/lib/taxonomy";
import { cn } from "@/lib/cn";
import type { NodeDto } from "@/lib/graph-types";

/** The real logo for a row: a specific service logo (aws-ec2…) if we have one, else the
 *  provider's brand logo (bitbucket / github / azure / gcp / aws) — the Kind column already
 *  names the exact type, so the brand mark reads cleanly here. */
function rowLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

/** The nodes table (docs/09 §5.3) — kind · name · region, with certainty + freshness legible per row. */
export function NodesList({ nodes }: { nodes: NodeDto[] }) {
  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No resources match these filters"
        description="Try clearing filters, or connect a source and let it sync."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Resource</th>
            <th className="px-4 py-2.5 font-medium">Kind</th>
            <th className="px-4 py-2.5 font-medium">Region</th>
            <th className="px-4 py-2.5 font-medium">Confidence</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {nodes.map((n) => {
            const Icon = kindIcon(n.kind);
            const logo = rowLogo(n.kind);
            return (
              <tr key={n.id} className="hover:bg-card/60">
                <td className="px-4 py-2.5">
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
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant="secondary" className="font-mono text-[11px] font-normal">
                    {n.kind}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{n.region ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <ConfidenceBadge tier={n.confidence} />
                </td>
                <td className="px-4 py-2.5">
                  <FreshnessTag status={n.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
