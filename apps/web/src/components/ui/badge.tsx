import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Neutral badge primitive (certainty badges compose on this — docs/09 §3.3). */
export function Badge({
  className,
  children,
  title,
}: {
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-xs font-medium text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
