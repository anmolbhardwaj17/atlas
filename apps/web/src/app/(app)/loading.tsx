import { Skeleton } from "@/components/ui/skeleton";

/**
 * Content-area fallback shown instantly on navigation within the app shell (the sidebar
 * + header persist because they live in the layout). Turns "click → wait → page" into
 * "click → URL changes → skeleton → page".
 */
export default function AppLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
