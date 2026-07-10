/**
 * Route-specific loading fallback for the Sift page — mirrors its centered single-statement layout
 * so navigation shows a matching skeleton instead of a blank wait.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function SiftLoading() {
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-2xl flex-col items-center justify-center gap-4">
      <Skeleton className="size-11 rounded-lg" />
      <Skeleton className="mt-4 h-7 w-72" />
      <div className="w-full space-y-2">
        <Skeleton className="mx-auto h-4 w-full" />
        <Skeleton className="mx-auto h-4 w-11/12" />
        <Skeleton className="mx-auto h-4 w-4/5" />
      </div>
      <Skeleton className="mt-4 h-9 w-32" />
    </div>
  );
}
