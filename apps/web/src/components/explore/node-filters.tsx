import Link from "next/link";

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

const field =
  "rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted";

export function NodeFilters({ values }: { values: NodeFilterValues }) {
  const hasFilters = Boolean(values.q || values.kind || values.status || values.confidence);
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        name="q"
        defaultValue={values.q ?? ""}
        placeholder="Search by name…"
        aria-label="Search nodes by name"
        className={`${field} min-w-48 flex-1`}
      />
      <input
        type="text"
        name="kind"
        defaultValue={values.kind ?? ""}
        placeholder="kind (e.g. ecs.service)"
        aria-label="Filter by kind"
        className={`${field} w-44`}
      />
      <select
        name="status"
        defaultValue={values.status ?? ""}
        aria-label="Filter by status"
        className={field}
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
        className={field}
      >
        <option value="">any confidence</option>
        {CONFIDENCE.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
      >
        Apply
      </button>
      {hasFilters && (
        <Link href="/explore" className="px-2 text-sm text-muted hover:text-fg">
          Clear
        </Link>
      )}
    </form>
  );
}
