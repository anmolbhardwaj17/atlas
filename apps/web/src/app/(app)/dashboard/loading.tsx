import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Route-specific loading fallback for the Dashboard. Next.js App Router renders this
 * instantly while `page.tsx` (which fetches `/summary` on the server) resolves, so
 * navigating to the dashboard shows a skeleton that mirrors the real layout - header +
 * trust pulse, Ask Atlas hero, stat groups, insights, needs-attention / recent-activity,
 * and the map preview - instead of a blank wait.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header: title + trust pulse line, with the refresh control on the right. */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Ask Atlas hero. */}
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-7">
        <Skeleton className="mb-2 h-5 w-28" />
        <Skeleton className="mb-4 h-4 w-full max-w-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-52 max-w-full rounded-full" />
          ))}
        </div>
      </div>

      {/* Stat groups (Infrastructure + Code), each a label over a 4-up grid of stat cards. */}
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g}>
          <Skeleton className="mb-2 h-3 w-24" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-4" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="mt-3 h-7 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

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

      {/* Needs attention (2/3) + Recent activity (1/3). */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-28" />
              </div>
              <ul className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-md border border-border p-3"
                  >
                    <Skeleton className="h-10 w-0.5 shrink-0 self-stretch rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-16 rounded-full" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-4 w-1/2" />
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
              {Array.from({ length: 5 }).map((_, i) => (
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
