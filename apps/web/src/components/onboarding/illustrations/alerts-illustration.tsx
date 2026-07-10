"use client";

import { Check } from "lucide-react";
import { CloudIcon } from "@/components/cloud-icon";

/**
 * "Proactive alerts" illustration — a realistic Slack alert card (real Slack logo) the moment
 * something breaks, already carrying Atlas's quick diagnosis, then a "delivered to" row with the
 * real Slack / Discord / Teams logos so it reads as multi-channel, proactive push.
 */
export function AlertsIllustration() {
  return (
    <div className="absolute inset-0 p-4">
      <div className="flex size-full flex-col justify-center gap-2">
        {/* The alert as it lands in Slack. */}
        <div className="illo-float rounded-xl border border-border bg-background p-2.5 shadow-md">
          <div className="flex items-center gap-1.5">
            <CloudIcon name="slack-icon" className="size-4" />
            <span className="text-[9px] font-semibold">Atlas</span>
            <span className="rounded bg-muted px-1 py-0.5 text-[7px] font-medium text-muted-foreground">
              APP
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-[7px] text-muted-foreground">
              <span className="illo-pulse size-1.5 rounded-full bg-rose-500" /> now
            </span>
          </div>
          <p className="mt-1.5 text-[9px] leading-snug">
            <span className="font-semibold text-rose-600 dark:text-rose-400">checkout-api</span>{" "}
            went down — p95 latency 2.4s
          </p>
          <p className="mt-0.5 text-[8px] leading-snug text-muted-foreground">
            Atlas looked into it: likely PR #4127
          </p>
        </div>

        {/* Delivered across channels. */}
        <div className="flex items-center gap-2 pl-1">
          <span className="inline-flex items-center gap-1 text-[8px] text-muted-foreground">
            <Check className="size-2.5 text-emerald-500" /> Delivered to
          </span>
          <div className="flex items-center gap-1.5">
            <CloudIcon name="slack-icon" className="size-3.5" />
            <CloudIcon name="discord-icon" className="size-3.5" />
            <CloudIcon name="microsoft-teams" className="size-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
