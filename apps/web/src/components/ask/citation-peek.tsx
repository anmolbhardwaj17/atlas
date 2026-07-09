"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Map as MapIcon, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { kindIcon, kindStyle, KIND_LOGO } from "@/lib/kind-visual";
import { PROVIDER_META } from "@/lib/taxonomy";
import { keyFacts } from "@/lib/node-facts";
import { getNode } from "@/lib/browser-api";
import { cn } from "@/lib/cn";
import type { NodeDetail } from "@/lib/graph-types";

function nodeLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

/**
 * Peek a cited resource without leaving the conversation — a right-side drawer with the node's key
 * facts, health, and jumps to Explore / the map. Opening a citation shouldn't cost you your place
 * in the chat (P4 evidence, in-context).
 */
export function CitationPeek({
  orgId,
  nodeId,
  onClose,
}: {
  orgId: string;
  nodeId: string | null;
  onClose: () => void;
}) {
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!nodeId) return;
    let live = true;
    setNode(null);
    setLoading(true);
    void getNode(orgId, nodeId).then((n) => {
      if (live) {
        setNode(n);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [orgId, nodeId]);

  const health = node?.attributes?.health as { state?: string; reason?: string } | undefined;
  const unhealthy = !!health?.state && health.state !== "healthy";
  const facts = node ? keyFacts(node.kind, node.attributes) : [];
  const logo = node ? nodeLogo(node.kind) : null;
  const KindIcon = node ? kindIcon(node.kind) : null;

  return (
    <Sheet
      open={!!nodeId}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="right" className="w-[360px] overflow-y-auto sm:max-w-[380px]">
        {loading || !node ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : "Resource not found."}
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-1.5">
              <SheetTitle className="flex items-center gap-2 text-left">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-md",
                    logo ? "bg-muted/60" : kindStyle(node.kind),
                  )}
                >
                  {logo ? (
                    <CloudIcon name={logo} className="size-4" />
                  ) : KindIcon ? (
                    <KindIcon className="size-4" />
                  ) : null}
                </span>
                <span className="min-w-0 truncate">{node.name ?? node.kind}</span>
              </SheetTitle>
              <p className="text-xs text-muted-foreground">
                {node.kind}
                {node.region ? ` · ${node.region}` : ""}
              </p>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {unhealthy ? (
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-2.5 text-xs",
                    health?.state === "degraded"
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : "border-danger/30 bg-danger/10 text-danger",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      health?.state === "degraded" ? "bg-warning" : "bg-danger",
                    )}
                  />
                  <span className="font-medium capitalize">{health?.state}</span>
                  {health?.reason ? (
                    <span className="text-foreground">— {health.reason}</span>
                  ) : null}
                </div>
              ) : null}

              {facts.length > 0 ? (
                <dl className="divide-y divide-border text-sm">
                  {facts.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid grid-cols-[minmax(0,110px)_1fr] items-baseline gap-x-3 py-1.5 first:pt-0"
                    >
                      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 break-words text-right text-xs font-medium">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <div className="flex items-center gap-2">
                <ConfidenceBadge tier={node.confidence} />
                <FreshnessTag status={node.status} />
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <Link
                  href={`/explore/${node.id}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90"
                >
                  <ExternalLink className="size-3.5" /> Open in Explore
                </Link>
                <Link
                  href={`/map?node=${node.id}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <MapIcon className="size-3.5" /> View on map
                </Link>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
