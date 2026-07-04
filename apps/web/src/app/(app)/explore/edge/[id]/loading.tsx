/**
 * Route-specific loading fallback for the Explore edge-detail page. Mirrors that
 * page's layout (from-node → type → to-node header, plus the provenance and
 * evidence panels) so navigation shows a matching skeleton, not a blank wait.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardBody } from "@/components/ui/card";

export default function EdgeDetailLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Skeleton className="h-4 w-44" />
          <span className="text-muted-foreground">→</span>
          <Skeleton className="h-4 w-44" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardBody>
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-36" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardBody>
            <div className="space-y-2 rounded-md bg-background p-3">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
