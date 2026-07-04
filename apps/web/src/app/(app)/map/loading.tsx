import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-specific loading fallback for the infrastructure map. Mirrors the page's layout -
 * header + group-by control, explainer bar, filter chips, and the dominant graph canvas -
 * so navigating here shows a matching skeleton instead of a blank wait.
 */
export default function MapLoading() {
  return (
    <div className="space-y-4">
      {/* Header: title + subtitle, with the group-by segmented control on the right. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-56 rounded-lg" />
      </div>

      {/* Contextual explainer bar. */}
      <Skeleton className="h-9 w-full rounded-md" />

      {/* Filter chips row, with the legend pushed to the right. */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="ml-auto h-4 w-64 max-w-full" />
      </div>

      {/* The graph canvas dominates the page. */}
      <Skeleton className="h-[calc(100dvh-14rem)] min-h-[480px] w-full rounded-xl" />
    </div>
  );
}
