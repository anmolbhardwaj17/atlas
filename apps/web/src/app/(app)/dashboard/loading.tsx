import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Route-specific loading fallback for the Dashboard. Rendered instantly while `page.tsx` (which
 * fetches `/summary` on the server) resolves, so it mirrors the real layout in the SAME order:
 * hero band, the health/findings/sources hero grid, needs-attention / recent-activity, the Ask
 * Atlas card, the infrastructure/code/posture row, insights, and the map preview.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Hero band: greeting + estate pulse + refresh. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Hero grid: health / findings / sources. */}
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="shadow-sm">
            <CardContent className="p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-8 w-20" />
              <Skeleton className="mt-3 h-2 w-full rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Needs attention (2/3) + Recent activity (1/3) — gap-4 to line up with the KPI row. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-28" />
              </div>
              <ul className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="flex items-start gap-3 px-2 py-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Skeleton className="h-5 w-20 rounded-md" />
                      <Skeleton className="h-4 w-12 rounded-full" />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent className="p-5">
            <Skeleton className="mb-3 h-5 w-32" />
            <ul className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <Skeleton className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-3 w-10 shrink-0" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Ask Atlas (light hero card). */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-7">
        <Skeleton className="mb-2 h-5 w-28" />
        <Skeleton className="mb-4 h-4 w-full max-w-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-52 max-w-full rounded-full" />
          ))}
        </div>
      </div>

      {/* Infrastructure / Code / Posture — three equal cards. */}
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="shadow-sm">
            <CardContent className="p-5">
              <Skeleton className="mb-4 h-3 w-28" />
              {i === 2 ? (
                <div className="flex justify-center">
                  <Skeleton className="size-52 rounded-full" />
                </div>
              ) : (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, r) => (
                    <div key={r} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Skeleton className="size-4" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                      <Skeleton className="h-6 w-8" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Insights: heading + subtitle over a 3-up grid of cards. */}
      <div>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mb-3 mt-2 h-3 w-72 max-w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="mb-3 flex items-baseline justify-between">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-14" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, r) => (
                    <div key={r} className="flex items-center gap-3">
                      <Skeleton className="h-4 w-24 shrink-0" />
                      <Skeleton className="h-2 flex-1 rounded-full" />
                      <Skeleton className="h-4 w-6 shrink-0" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Map preview banner. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </CardContent>
      </Card>
    </div>
  );
}
