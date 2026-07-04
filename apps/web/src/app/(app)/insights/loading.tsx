import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Insights loading fallback. Route-specific (mirrors the header + summary strip + finding cards)
 * so clicking "Insights" swaps to *this* screen instantly with a matching skeleton while the
 * server recomputes findings — never a blank wait that reads as a hang (docs/09 §7).
 */
export default function InsightsLoading() {
  return (
    <div className="w-full space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-[36rem] max-w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-8 w-56 rounded-md" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-4 w-2/3" />
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-4/5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
