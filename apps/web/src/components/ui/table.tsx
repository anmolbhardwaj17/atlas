import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Dense data-table shell (findings, controls, nodes…). One horizontal-scroll wrapper + table with
 * the app's uppercase-muted header and hairline-divided rows — replaces the hand-rolled table shells
 * that had drifted (header text-xs vs text-[11px], wrapper `rounded-lg border` vs a Card). Cells
 * default to px-4 py-3; override per cell via className (cn uses twMerge, so overrides win).
 */
export function Table({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<"table"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", wrapperClassName)}>
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={className} {...props} />;
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-top", className)} {...props} />;
}
