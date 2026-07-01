"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Reusable copy-able code block (design-system primitive). Used by onboarding setup
 * instructions and anywhere we surface copy-ready config/policy. Mono theme; the label
 * bar + copy affordance are consistent everywhere so it reads as one system.
 */
export function CodeBlock({
  label,
  code,
  className,
}: {
  label?: string;
  code: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op; the code stays selectable
    }
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-muted/40", className)}>
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        {label ? (
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          aria-label={label ? `Copy ${label}` : "Copy"}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
