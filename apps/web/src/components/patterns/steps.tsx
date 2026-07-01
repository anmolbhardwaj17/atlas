import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Numbered steps (design-system pattern). Auto-numbers its `Step` children so callers
 * don't hand-maintain indices. Reused by onboarding provider instructions and any guided
 * flow. Renders as a semantic ordered list for a11y.
 */
export function Steps({ children, className }: { children: React.ReactNode; className?: string }) {
  const steps = React.Children.toArray(children);
  return (
    <ol className={cn("space-y-5", className)}>
      {steps.map((child, i) =>
        React.isValidElement<StepProps>(child) ? React.cloneElement(child, { _n: i + 1 }) : child,
      )}
    </ol>
  );
}

interface StepProps {
  title: string;
  children?: React.ReactNode;
  /** Injected by <Steps>; do not pass manually. */
  _n?: number;
}

export function Step({ title, children, _n }: StepProps) {
  return (
    <li className="flex gap-3">
      <div className="grid size-6 shrink-0 place-items-center rounded-full border border-foreground/25 text-xs font-semibold tabular-nums">
        {_n ?? "•"}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium leading-6">{title}</p>
        {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
      </div>
    </li>
  );
}
