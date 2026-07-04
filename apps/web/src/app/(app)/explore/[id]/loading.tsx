/**
 * Route-specific loading fallback that mirrors the node-detail page layout, so
 * navigating to a resource shows a matching skeleton instead of a blank wait.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

export default function NodeDetailLoading() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-4 w-20" />
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="ml-auto h-7 w-32 rounded-md" />
          </div>
          <Skeleton className="mt-2 h-3 w-80" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <Skeleton className="h-4 w-24" />
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-between gap-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Skeleton className="h-4 w-24" />
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex justify-between gap-4">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-36" />
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>
              <Skeleton className="h-4 w-28" />
            </CardTitle>
            <Skeleton className="h-3 w-12" />
          </CardHeader>
          <CardBody className="space-y-4">
            {Array.from({ length: 2 }).map((_, group) => (
              <div key={group}>
                <Skeleton className="mb-2 h-3 w-48" />
                <ul className="divide-y divide-border">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Skeleton className="h-5 w-16 rounded-sm" />
                        <Skeleton className="h-4 w-40" />
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Skeleton className="h-5 w-16 rounded-full" />
                        <Skeleton className="h-4 w-8" />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
