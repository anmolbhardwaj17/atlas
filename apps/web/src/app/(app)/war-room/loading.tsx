import { Skeleton } from "@/components/ui/skeleton";

/** War Room skeleton — mirrors the page: title + description, then rows of incidents. Shown the
 *  instant you navigate here so the click never feels like a blank wait. */
export default function WarRoomLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
