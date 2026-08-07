/**
 * Route-specific loading fallback for the Sift setup screen — mirrors the two-column wizard: the
 * Sift × Atlas hero + guided steps on the left, and the "Configure Sift" review-settings form
 * (model / effort / test depth choice grids + continue) on the right, so navigating here shows a
 * matching skeleton instead of a blank wait.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function SiftLoading() {
  return (
    <div className="relative -m-4 min-h-[calc(100dvh-3.5rem)] overflow-hidden p-4 md:-m-6 md:p-6">
      {/* Coming-soon pill (top-right, absolute like the real page). */}
      <Skeleton className="absolute right-4 top-4 h-6 w-28 rounded-full md:right-6 md:top-6" />

      <div className="grid items-start gap-10 pt-9 lg:grid-cols-2">
        {/* LEFT - Sift × Atlas hero + title + subtext, then three guided steps. */}
        <div className="space-y-7">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-md" />
              <Skeleton className="size-4" />
              <Skeleton className="size-12 rounded-md" />
            </div>
            <Skeleton className="h-8 w-[26rem] max-w-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-4 w-11/12 max-w-md" />
              <Skeleton className="h-4 w-3/4 max-w-md" />
            </div>
          </div>
          <div className="space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-full max-w-sm" />
                  <Skeleton className="h-3 w-4/5 max-w-sm" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT - Configure Sift: header + step badge, then the choice grids and continue. */}
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>

          {/* Model + Review effort - two 3-up choice grids. */}
          {Array.from({ length: 2 }).map((_, g) => (
            <div key={g} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[4.5rem] rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-3 w-40" />
            </div>
          ))}

          {/* Test depth - a 2-up choice grid. */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <div className="grid grid-cols-2 gap-1.5">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-[4.5rem] rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-3 w-44" />
          </div>

          {/* Continue button - half width, right-aligned. */}
          <div className="flex justify-end">
            <Skeleton className="h-9 w-1/2 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
