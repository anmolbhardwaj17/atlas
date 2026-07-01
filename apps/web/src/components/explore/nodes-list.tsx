import Link from "next/link";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { Badge } from "@/components/ui/badge";
import type { NodeDto } from "@/lib/graph-types";

/** The nodes table (docs/09 §5.3) — kind · name · region, with certainty + freshness legible per row. */
export function NodesList({ nodes }: { nodes: NodeDto[] }) {
  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-border py-12 text-center">
        <p className="text-sm text-foreground">No resources match these filters</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try clearing filters, or connect a source and let it sync.
        </p>
      </div>
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
          {nodes.map((n) => (
            <tr key={n.id} className="hover:bg-card/60">
              <td className="px-4 py-2.5">
                <Link href={`/explore/${n.id}`} className="font-medium hover:text-primary">
                  {n.name ?? <span className="text-muted-foreground">unnamed</span>}
                </Link>
                <div className="max-w-md truncate text-xs text-muted-foreground">{n.urn}</div>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
