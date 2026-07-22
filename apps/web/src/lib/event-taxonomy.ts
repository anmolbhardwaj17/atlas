import { Activity, Bell, GitMerge, Rocket, SlidersHorizontal, type LucideIcon } from "lucide-react";

/**
 * Single source of truth for change-event (node_events) visual taxonomy — operational-intelligence
 * Phase C. Shared by the Explore `ChangeTimeline` and the War Room so a `deploy` reads the same
 * everywhere. Plain module (no "use client") so it's safe to import from both server and client
 * components. Kinds mirror the node_events CHECK constraint.
 */
export const EVENT_ICON: Record<string, LucideIcon> = {
  deploy: Rocket,
  config_change: SlidersHorizontal,
  pr_merged: GitMerge,
  health_transition: Activity,
  alarm_transition: Bell,
};

export const EVENT_COLOR: Record<string, string> = {
  deploy: "text-foreground",
  config_change: "text-warning",
  pr_merged: "text-muted-foreground",
  health_transition: "text-danger",
  alarm_transition: "text-danger",
};

export const EVENT_LABEL: Record<string, string> = {
  deploy: "Deploy",
  config_change: "Config change",
  pr_merged: "PR merged",
  health_transition: "Health",
  alarm_transition: "Alarm",
};

export function eventVerb(kind: string): string {
  return (
    { deploy: "Deployed", config_change: "Config changed", pr_merged: "PR merged" }[kind] ??
    "Changed"
  );
}
