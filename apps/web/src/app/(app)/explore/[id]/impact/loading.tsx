import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-specific loading fallback for the Explore impact-analysis page. Mirrors
 * page.tsx (back link, header, and the two blast-radius/dependencies panels of
 * distance-grouped rows) so navigation shows a matching skeleton, not a blank wait.
 */
export default function ImpactLoading() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-4 w-28" />
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, panel) => (
            <Card key={panel}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-16" />
              </CardHeader>
              <CardBody className="space-y-4">
                <Skeleton className="h-4 w-full max-w-sm" />

                {Array.from({ length: 2 }).map((_, group) => (
                  <div key={group} className="space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <ul className="space-y-1.5">
                      {Array.from({ length: 3 }).map((_, row) => (
                        <li
                          key={row}
                          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                        >
                          <Skeleton className="h-4 flex-1" />
                          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
