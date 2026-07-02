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

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const shell = await requireShell();
  const sp = await searchParams;

  const q = first(sp.q);
  const kind = first(sp.kind);
  const status = first(sp.status);
  const confidence = first(sp.confidence);
  const cursor = first(sp.cursor);

  const params = new URLSearchParams({ limit: "50" });
  if (q) params.set("q", q);
  if (kind) params.set("kind", kind);
  if (status) params.set("status", status);
  if (confidence) params.set("confidence", confidence);
  if (cursor) params.set("cursor", cursor);

  const auth = { token: shell.token, orgId: shell.orgId };
  const [res, overview] = await Promise.all([
    apiGet<ApiOk<NodeDto[]>>(`/nodes?${params.toString()}`, auth),
    apiGet<ApiOk<{ byKind: Array<{ kind: string; n: number }> }>>("/overview", auth),
  ]);
  const nodes = res.body?.data ?? [];
  const page = res.body?.page;
  const kinds = (overview.body?.data?.byKind ?? []).map((k) => k.kind);

  // Preserve filters (but not cursor) for the "next page" link.
  const nextParams = new URLSearchParams();
  if (q) nextParams.set("q", q);
  if (kind) nextParams.set("kind", kind);
  if (status) nextParams.set("status", status);
  if (confidence) nextParams.set("confidence", confidence);
  if (page?.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Explore</h1>
        <p className="text-sm text-muted-foreground">
          Every node in your graph — filter by kind, status, or confidence. Click through for
          provenance and connections.
        </p>
      </div>

      <NodeFilters values={{ q, kind, status, confidence }} kinds={kinds} />

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
            Next page →
          </Link>
        </div>
      )}
    </div>
  );
}
