import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The muted "track" for a segmented control — a single-select filter (insights severity, compliance
 * framework, integrations category…) or a small toggle group (the map lens toggles). Purely visual;
 * callers add the role/aria that matches their semantics (tablist+tab for single-select, or
 * aria-pressed for independent toggles). Replaces six hand-rolled copies of the same track markup.
 */
export function SegmentedControl({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted p-1",
        className,
      )}
      {...props}
    />
  );
}

/** One segment. `active` raises it (the selected filter / pressed toggle). Spreads onClick/aria/etc. */
export function Segment({
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
