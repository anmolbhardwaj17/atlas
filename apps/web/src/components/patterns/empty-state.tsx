import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * Empty state (design-system pattern, docs/09 §7). One consistent shape for every "no data
 * yet" surface — icon, title, one-line description, and an optional action row — so empty is
 * always a designed, actionable state, never a blank screen (US/EC-2). Reused by the
 * dashboard, Explore, Ask, and honest-absence surfaces (P1.3 keeps these consistent).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
  bare = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** Render without the surrounding Card (when already inside one). */
  bare?: boolean;
}) {
  const body = (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon ? (
        <div className="mb-3 grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );

  if (bare) return body;
  return (
    <Card>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  );
}
