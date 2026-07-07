import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AtlasLogo } from "@/components/brand";
import { cn } from "@/lib/cn";

/**
 * Empty / error / honest-absence state (design-system pattern, docs/09 §7). One consistent
 * shape for every "no data" or "couldn't load" surface - icon, title, one-line description,
 * optional action row - so these are always designed, actionable states, never a blank
 * screen (US/EC-2). `tone="danger"` is the failure variant. Reused by the dashboard,
 * Explore, impact panels, settings, and honest-absence surfaces (P1.3 consistency).
 */
export function EmptyState({
  icon: Icon,
  iconSlot,
  title,
  description,
  actions,
  className,
  tone = "default",
  bare = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  /** A custom visual in place of the tinted icon box (e.g. the spinning Atlas logo). */
  iconSlot?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  tone?: "default" | "danger";
  /** Render without the surrounding Card (when already inside one). */
  bare?: boolean;
}) {
  const danger = tone === "danger";
  const body = (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {iconSlot ? (
        <div className="mb-3">{iconSlot}</div>
      ) : Icon ? (
        <div
          className={cn(
            "mb-3 grid size-10 place-items-center rounded-lg",
            danger ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" />
        </div>
      ) : null}
      <p className={cn("text-sm font-medium", danger && "text-danger")}>{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );

  if (bare) return body;
  return (
    <Card className={cn(danger && "border-danger/30")}>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  );
}

/**
 * Error state - `EmptyState` in the danger tone with a default alert icon. The one way to
 * render "couldn't load / compute this" across the app.
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  actions,
  bare = false,
}: {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  bare?: boolean;
}) {
  return (
    <EmptyState
      tone="danger"
      // The Atlas mark, gently spinning - our own "something went wrong" signature.
      iconSlot={<AtlasLogo size={44} spin className="size-11" />}
      title={title}
      description={description}
      actions={actions}
      bare={bare}
    />
  );
}
