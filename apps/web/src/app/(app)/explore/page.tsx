import { Suspense } from "react";
import Link from "next/link";
import { getPageAuth } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { ExploreControls } from "@/components/explore/explore-controls";
import { NodesList } from "@/components/explore/nodes-list";
import { ErrorState } from "@/components/patterns/empty-state";
import type { NodeDto } from "@/lib/graph-types";
import ExploreLoading from "./loading";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length > 0 ? s : undefined;
}
/** A comma-separated multi-value facet from the URL → array (e.g. "aws,github"). */
function list(v: string | string[] | undefined): string[] {
  return (
    first(v)
      ?.split(",")
      .map((x) => x.trim())
      .filter(Boolean) ?? []
  );
}

interface OverviewFacets {
  byProvider?: Array<{ provider: string; n: number }>;
  byCategory?: Array<{ category: string; n: number }>;
}

export default function ExplorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<ExploreLoading />}>
      <ExploreContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ExploreContent({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { token, orgId } = await getPageAuth();
  const sp = await searchParams;

  const q = first(sp.q);
  const category = list(sp.category);
  const source = list(sp.source);
  const health = list(sp.health);
  const status = list(sp.status);
  // `kind` stays a deep-link pass-through (e.g. dashboard "Contributors" → ?kind=…). It isn't a
  // UI facet, but when present it drives the list (and bypasses the estate default-hide).
  const kind = first(sp.kind);
  const cursor = first(sp.cursor);
  // The server counts the total only on page 1 (no cursor); keyset pages carry it forward in the URL
  // so we don't pay a full COUNT(*) on every scroll. See GraphService.listNodes.
  const urlTotal = first(sp.total);

  // 100 = the server max; the estate (repos + services + cloud resources) fits on one page, so
  // AWS/cloud resources aren't buried on page 2 behind freshly-synced code nodes. Facets forward
  // their raw CSV — the API parses comma-separated multi-values.
  const params = new URLSearchParams({ limit: "100" });
  if (q) params.set("q", q);
  if (category.length) params.set("category", category.join(","));
  if (source.length) params.set("source", source.join(","));
  if (health.length) params.set("health", health.join(","));
  if (status.length) params.set("status", status.join(","));
  if (kind) params.set("kind", kind);
  if (cursor) params.set("cursor", cursor);

  const auth = { token, orgId };
  const [res, overview] = await Promise.all([
    apiGet<ApiOk<NodeDto[]>>(`/nodes?${params.toString()}`, auth),
    apiGet<ApiOk<OverviewFacets>>("/overview", auth),
  ]);
  const nodes = res.body?.data ?? [];
  const page = res.body?.page as
    { nextCursor: string | null; hasMore: boolean; limit: number; total: number } | undefined;
  // Prefer the server total (page 1), else the value carried in the URL, else the row count.
  const total =
    page && page.total >= 0 ? page.total : urlTotal ? Number(urlTotal) : nodes.length;
  const isFiltered = Boolean(
    q || category.length || source.length || health.length || status.length || kind,
  );

  // Facet options come from the estate (the API already excludes activity/people/CI), so we only
  // ever offer sources/types that actually have browsable things behind them.
  const sources = (overview.body?.data?.byProvider ?? []).map((p) => p.provider);
  const categories = (overview.body?.data?.byCategory ?? []).map((c) => c.category);

  // Preserve filters (but not cursor) for the "next page" link.
  const nextParams = new URLSearchParams();
  if (q) nextParams.set("q", q);
  if (category.length) nextParams.set("category", category.join(","));
  if (source.length) nextParams.set("source", source.join(","));
  if (health.length) nextParams.set("health", health.join(","));
  if (status.length) nextParams.set("status", status.join(","));
  if (kind) nextParams.set("kind", kind);
  if (page?.nextCursor) nextParams.set("cursor", page.nextCursor);
  // Carry the total forward so keyset pages can show "N resources" without a re-count server-side.
  if (total >= 0) nextParams.set("total", String(total));

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
        <p className="text-sm text-muted-foreground">
          Your infrastructure and code - repositories, services, datastores, and cloud resources.
          Filter by type, source, health, or status; click through for provenance and connections.
        </p>
      </div>

      <ExploreControls
        values={{ q, category, source, health, status }}
        sources={sources}
        categories={categories}
      >
        {res.status !== 0 && res.body === null ? (
          <ErrorState
            title="Couldn’t load resources"
            description={`The graph read failed (status ${res.status}). Try again in a moment.`}
          />
        ) : (
          <div className="space-y-3">
            {nodes.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {total.toLocaleString()} {isFiltered ? "matching " : ""}
                {total === 1 ? "resource" : "resources"}
                {page?.hasMore ? ` · showing first ${nodes.length}` : ""}
              </p>
            ) : null}
            <NodesList nodes={nodes} filtered={isFiltered} />
            {page?.hasMore && page.nextCursor ? (
              <div className="flex justify-end">
                <Link
                  href={`/explore?${nextParams.toString()}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Next page -&gt;
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </ExploreControls>
    </div>
  );
}
