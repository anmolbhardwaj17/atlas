import { Skeleton } from "@/components/ui/skeleton";

/** Detail skeleton - matches the finding detail layout so the drill-in feels instant. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Skeleton className="h-5 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-7 w-3/4" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-10 w-64" />
    </div>
  );
}
