import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Node-list filters (docs/09 §5.3). A plain GET form — fully server-rendered, works
 * without JS, and keeps the URL the source of truth (shareable, back-button friendly).
 */
export interface NodeFilterValues {
  q: string | undefined;
  kind: string | undefined;
  status: string | undefined;
  confidence: string | undefined;
}

const STATUS = ["active", "stale", "deleted"];
const CONFIDENCE = ["observed", "inferred-high", "inferred-low"];

const select =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function NodeFilters({ values }: { values: NodeFilterValues }) {
  const hasFilters = Boolean(values.q || values.kind || values.status || values.confidence);
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        name="q"
        defaultValue={values.q ?? ""}
        placeholder="Search by name…"
        aria-label="Search nodes by name"
        className="min-w-48 flex-1"
      />
      <Input
        type="text"
        name="kind"
        defaultValue={values.kind ?? ""}
        placeholder="kind (e.g. ecs.service)"
        aria-label="Filter by kind"
        className="w-44"
      />
      <select
        name="status"
        defaultValue={values.status ?? ""}
        aria-label="Filter by status"
        className={select}
      >
        <option value="">any status</option>
        {STATUS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        name="confidence"
        defaultValue={values.confidence ?? ""}
        aria-label="Filter by confidence"
        className={select}
      >
        <option value="">any confidence</option>
        {CONFIDENCE.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <Button type="submit">Apply</Button>
      {hasFilters && (
        <Button asChild variant="ghost">
          <Link href="/explore">Clear</Link>
        </Button>
      )}
    </form>
  );
}
