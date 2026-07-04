/**
 * Route-specific loading fallback that mirrors the Settings page layout, so navigating
 * to Settings shows a matching skeleton (header + Organization / Connected sources /
 * Ask AI model / Members & access / Activity log cards) instead of a blank wait.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      {/* Organization card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <dl className="space-y-2.5 text-sm">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Connected sources card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border rounded-md border">
            {Array.from({ length: 2 }).map((_, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-2.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Ask AI model card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-8 w-64 rounded-lg" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </CardContent>
      </Card>

      {/* Members & access card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <ul className="divide-y divide-border rounded-md border">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2.5">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-9 min-w-56 flex-1 rounded-md" />
              <Skeleton className="h-9 w-28 rounded-md" />
              <Skeleton className="h-9 w-20 rounded-md" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity log card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-2.5">
                <div className="min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-52" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-3 w-16 shrink-0" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
