"use client";

import {
  Waypoints,
  Lightbulb,
  ShieldCheck,
  Activity,
  MessagesSquare,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { MapIllustration } from "@/components/onboarding/illustrations/map-illustration";
import { InsightsIllustration } from "@/components/onboarding/illustrations/insights-illustration";
import { SecurityIllustration } from "@/components/onboarding/illustrations/security-illustration";
import { OperationalIllustration } from "@/components/onboarding/illustrations/operational-illustration";
import { AskIllustration } from "@/components/onboarding/illustrations/ask-illustration";
import { AlertsIllustration } from "@/components/onboarding/illustrations/alerts-illustration";

/**
 * The "What you’ll get" capability carousel — a full-bleed, infinitely-scrolling row of richly
 * illustrated capability cards. Built for the onboarding but pulled out of it: onboarding is now
 * lean and action-first, so this doesn't render there anymore. It's kept intact and exported for
 * reuse (e.g. a marketing / landing page, where selling a product people haven't chosen yet belongs).
 */

export interface Capability {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Static (purge-safe) tint classes for the icon tile — one hue per capability. */
  tint: string;
  /** Bespoke animated illustration for this capability. */
  Illustration?: React.ComponentType;
}

export const CAPABILITIES: Capability[] = [
  {
    icon: Waypoints,
    title: "Live infrastructure map",
    body: "Your cloud and code, wired together in one canvas you can trace end to end.",
    tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    Illustration: MapIllustration,
  },
  {
    icon: Lightbulb,
    title: "Insights & posture",
    body: "Prioritized findings across the Well-Architected pillars - not a wall of alerts.",
    tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    Illustration: InsightsIllustration,
  },
  {
    icon: ShieldCheck,
    title: "Security & vulnerabilities",
    body: "Known CVEs in your dependencies, ranked by real blast radius across repos.",
    tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    Illustration: SecurityIllustration,
  },
  {
    icon: Activity,
    title: "Operational intelligence",
    body: "See what’s broken right now - with an AI root-cause, down to the PR.",
    tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    Illustration: OperationalIllustration,
  },
  {
    icon: MessagesSquare,
    title: "Ask Atlas",
    body: "Cited, confidence-tiered answers over your own graph - never a guess.",
    tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    Illustration: AskIllustration,
  },
  {
    icon: Bell,
    title: "Proactive alerts",
    body: "A heads-up in Slack, Discord, or Teams the moment something changes.",
    tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    Illustration: AlertsIllustration,
  },
];

/** Fallback illustration for a capability with no bespoke scene — its icon on a soft tinted wash. */
function FallbackIllustration({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className={cn("illo-float grid size-14 place-items-center rounded-2xl", tint)}>
        <Icon className="size-7" />
      </div>
    </div>
  );
}

/** One capability card: the illustration in a padded, rounded panel plus the title + blurb. Fixed
 *  width so it tiles cleanly in the carousel. */
function CapabilityCard({ c }: { c: Capability }) {
  return (
    <div className="mr-4 w-[300px] shrink-0 overflow-hidden rounded-2xl border border-border bg-card/40">
      <div className="p-2.5">
        <div className="relative aspect-[2/1] overflow-hidden rounded-xl bg-muted/20">
          {c.Illustration ? (
            <c.Illustration />
          ) : (
            <FallbackIllustration icon={c.icon} tint={c.tint} />
          )}
        </div>
      </div>
      <div className="px-4 pb-4 pt-1">
        <p className="text-sm font-medium">{c.title}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
      </div>
    </div>
  );
}

/** The capability cards as a full-bleed, infinitely-scrolling carousel. Two copies of the list are
 *  laid end to end and the row translates by -50% for a seamless loop; pauses on hover; holds still
 *  under reduced motion; edges fade via a horizontal mask. */
export function CapabilityMarquee() {
  const items = [...CAPABILITIES, ...CAPABILITIES];
  return (
    <div
      className="group relative w-full overflow-hidden"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 2%, #000 98%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 2%, #000 98%, transparent)",
      }}
    >
      <div className="flex w-max animate-[marquee_50s_linear_infinite] group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {items.map((c, i) => (
          <CapabilityCard key={`${c.title}-${i}`} c={c} />
        ))}
      </div>
    </div>
  );
}
