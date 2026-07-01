import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/certainty";
import { ErrorState } from "@/components/patterns/empty-state";
import type { TraversalResult } from "@/lib/graph-types";

/**
 * Blast-radius / dependencies panel (docs/09 §5.4). List-first (a11y — the graph canvas
 * is an optional enhancement, not the source of truth): nodes grouped by hop distance,
 * each with its **pathConfidence** (weakest edge on the path, P3) and an expandable
 * why-chain (the edges that connect it back to the root, P4).
 */
export function ImpactPanel({
  title,
  subtitle,
  result,
}: {
  title: string;
  subtitle: string;
  result: TraversalResult | null;
}) {
  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <ErrorState
            bare
            title="Couldn’t compute this traversal"
            description="The graph query failed or timed out. Try again in a moment."
          />
        </CardBody>
      </Card>
    );
  }

  const byDistance = new Map<number, TraversalResult["impacted"]>();
  for (const item of result.impacted) {
    const bucket = byDistance.get(item.distance) ?? [];
    bucket.push(item);
    byDistance.set(item.distance, bucket);
  }
  const distances = [...byDistance.keys()].sort((a, b) => a - b);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-muted-foreground">{result.impacted.length} nodes</span>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-muted-foreground">{subtitle}</p>

        {(result.truncated || result.warnings.length > 0) && (
          <div className="flex items-start gap-2 rounded-md border border-inferred-low/40 bg-inferred-low/5 px-3 py-2 text-xs text-inferred-low">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              {result.truncated && (
                <p>
                  Truncated at the node budget ({result.nodeBudget}) — some paths are not shown.
                </p>
              )}
              {result.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          </div>
        )}

        {result.impacted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing found within depth {result.depthUsed} — this is a truthful empty result, not a
            failure.
          </p>
        ) : (
          <div className="space-y-4">
            {distances.map((d) => (
              <div key={d}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {d} hop{d === 1 ? "" : "s"} away
                </p>
                <ul className="space-y-1.5">
                  {(byDistance.get(d) ?? []).map((item) => (
                    <li key={item.node.id} className="rounded-md border border-border">
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm">
                          <Link
                            href={`/explore/${item.node.id}`}
                            className="min-w-0 truncate hover:text-primary"
                          >
                            <span className="text-muted-foreground">{item.node.kind}</span> ·{" "}
                            {item.node.name ?? item.node.urn}
                          </Link>
                          <span className="flex shrink-0 items-center gap-2">
                            <ConfidenceBadge tier={item.pathConfidence} />
                            <span className="text-xs text-muted-foreground group-open:hidden">
                              why?
                            </span>
                          </span>
                        </summary>
                        <div className="border-t border-border px-3 py-2">
                          <p className="mb-1 text-xs text-muted-foreground">Path back to root:</p>
                          <ol className="space-y-1">
                            {item.via.map((v) => (
                              <li key={v.edgeId} className="flex items-center gap-2 text-xs">
                                <span className="rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground">
                                  {v.type}
                                </span>
                                <ConfidenceBadge tier={v.confidence} />
                                <Link
                                  href={`/explore/edge/${v.edgeId}`}
                                  className="text-primary hover:underline"
                                >
                                  evidence
                                </Link>
                              </li>
                            ))}
                          </ol>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
