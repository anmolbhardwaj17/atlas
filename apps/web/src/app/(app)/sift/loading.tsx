/**
 * Route-specific loading fallback for the Sift page — mirrors its hero + value-prop grid so
 * navigation shows a matching skeleton instead of a blank wait.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function SiftLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="flex gap-5">
        <Skeleton className="size-16 shrink-0 rounded-2xl" />
        <div className="space-y-3 pt-1">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-4 w-[36rem] max-w-full" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2.5 p-5">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
