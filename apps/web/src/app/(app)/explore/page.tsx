import Link from "next/link";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { NodeFilters } from "@/components/explore/node-filters";
import { NodesList } from "@/components/explore/nodes-list";
import { ErrorState } from "@/components/patterns/empty-state";
import type { NodeDto } from "@/lib/graph-types";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length > 0 ? s : undefined;
}

interface OverviewFacets {
  byProvider?: Array<{ provider: string; n: number }>;
  byCategory?: Array<{ category: string; n: number }>;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const shell = await requireShell();
  const sp = await searchParams;

  const q = first(sp.q);
  const category = first(sp.category);
  const source = first(sp.source);
  const status = first(sp.status);
  // `kind` stays a deep-link pass-through (e.g. dashboard "Contributors" → ?kind=…). It isn't a
  // UI filter, but when present it drives the list (and bypasses the estate default-hide).
  const kind = first(sp.kind);
  const cursor = first(sp.cursor);

  // 100 = the server max; the estate (repos + services + cloud resources) fits on one page, so
  // AWS/cloud resources aren't buried on page 2 behind freshly-synced code nodes.
  const params = new URLSearchParams({ limit: "100" });
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (source) params.set("source", source);
  if (status) params.set("status", status);
  if (kind) params.set("kind", kind);
  if (cursor) params.set("cursor", cursor);

  const auth = { token: shell.token, orgId: shell.orgId };
  const [res, overview] = await Promise.all([
    apiGet<ApiOk<NodeDto[]>>(`/nodes?${params.toString()}`, auth),
    apiGet<ApiOk<OverviewFacets>>("/overview", auth),
  ]);
  const nodes = res.body?.data ?? [];
  const page = res.body?.page;

  // Facet options come from the estate (the API already excludes activity/people/CI), so we only
  // ever offer sources/types that actually have browsable things behind them.
  const sources = (overview.body?.data?.byProvider ?? []).map((p) => p.provider);
  const categories = (overview.body?.data?.byCategory ?? []).map((c) => c.category);

  // Preserve filters (but not cursor) for the "next page" link.
  const nextParams = new URLSearchParams();
  if (q) nextParams.set("q", q);
  if (category) nextParams.set("category", category);
  if (source) nextParams.set("source", source);
  if (status) nextParams.set("status", status);
  if (kind) nextParams.set("kind", kind);
  if (page?.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
        <p className="text-sm text-muted-foreground">
          Your infrastructure and code - repositories, services, datastores, and cloud resources.
          Filter by type, source, or status; click through for provenance and connections.
        </p>
      </div>

      <NodeFilters
        values={{ q, category, source, status }}
        sources={sources}
        categories={categories}
      />

      {res.status !== 0 && res.body === null ? (
        <ErrorState
          title="Couldn’t load resources"
          description={`The graph read failed (status ${res.status}). Try again in a moment.`}
        />
      ) : (
        <NodesList nodes={nodes} />
      )}

      {page?.hasMore && page.nextCursor && (
        <div className="flex justify-end">
          <Link
            href={`/explore?${nextParams.toString()}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Next page -&gt;
          </Link>
        </div>
      )}
    </div>
  );
}
