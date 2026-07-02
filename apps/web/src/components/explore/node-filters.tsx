import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Explore filters (docs/09 §5.3). Product-facing facets: filter by what a thing IS (Type =
 * semantic category) and where it's FROM (Source = provider), plus freshness (Status) and a
 * name search. A plain GET form - server-rendered, works without JS, URL is the source of truth
 * (shareable + back-button friendly). Only facet values actually present are offered.
 */
export interface NodeFilterValues {
  q: string | undefined;
  category: string | undefined;
  source: string | undefined;
  status: string | undefined;
}

const STATUS = ["active", "stale"];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Friendly labels for the raw provider / node_kinds.category values.
const SOURCE_LABEL: Record<string, string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "Google Cloud",
  bitbucket: "Bitbucket",
  github: "GitHub",
  gitlab: "GitLab",
  datadog: "Datadog",
  atlas: "Inferred services",
  external: "External",
};
const CATEGORY_LABEL: Record<string, string> = {
  code: "Code",
  compute: "Compute",
  data: "Data stores",
  storage: "Storage",
  networking: "Networking",
  identity: "Identity",
  security: "Security",
  derived: "Services",
};
const labelOf = (map: Record<string, string>, v: string): string => map[v] ?? cap(v);

const select =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function NodeFilters({
  values,
  sources,
  categories,
}: {
  values: NodeFilterValues;
  sources: string[];
  categories: string[];
}) {
  const hasFilters = Boolean(values.q || values.category || values.source || values.status);
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        name="q"
        defaultValue={values.q ?? ""}
        placeholder="Search by name..."
        aria-label="Search by name"
        className="min-w-48 flex-1"
      />
      <select
        name="category"
        defaultValue={values.category ?? ""}
        aria-label="Filter by type"
        className={`${select} w-40`}
      >
        <option value="">Any type</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {labelOf(CATEGORY_LABEL, c)}
          </option>
        ))}
      </select>
      <select
        name="source"
        defaultValue={values.source ?? ""}
        aria-label="Filter by source"
        className={`${select} w-40`}
      >
        <option value="">Any source</option>
        {sources.map((s) => (
          <option key={s} value={s}>
            {labelOf(SOURCE_LABEL, s)}
          </option>
        ))}
      </select>
      <select
        name="status"
        defaultValue={values.status ?? ""}
        aria-label="Filter by status"
        className={select}
      >
        <option value="">Any status</option>
        {STATUS.map((s) => (
          <option key={s} value={s}>
            {cap(s)}
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
