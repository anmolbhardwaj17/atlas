import { Skeleton } from "@/components/ui/skeleton";

/**
 * Explore loading fallback (docs/09 §7). Route-specific so the skeleton matches the page
 * it precedes (header + filter bar + table rows), instead of the generic app skeleton —
 * navigation reads as "this page, loading" rather than a mismatched flash.
 */
export default function ExploreLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="overflow-hidden rounded-lg border border-border">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
