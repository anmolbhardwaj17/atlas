import { SiftMark } from "@/components/sift-mark";
import { AtlasLogo } from "@/components/brand";
import { SiftBackdrop } from "@/components/sift-backdrop";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";

/**
 * Sift — AI code review under the Atlas umbrella. Onboarding isn't wired yet, so the page is a
 * single focused statement of the pairing (Sift × Atlas) over a split decorative backdrop — a
 * contribution grid on the left, a node network on the right — with a "Coming soon" label. Once an
 * org enables Sift, this route becomes its Sift dashboard.
 */
export default function SiftPage() {
  return (
    <div className="relative -mx-4 flex min-h-[calc(100dvh-7rem)] items-center justify-center overflow-hidden md:-mx-6">
      <SiftBackdrop />

      <div className="relative z-10 flex max-w-2xl flex-col items-center px-6 text-center">
        <SetBreadcrumbs items={[{ label: "Sift" }]} />

        {/* The pairing mark — Sift × Atlas (the Atlas globe rotates). */}
        <div className="flex items-center gap-3">
          <SiftMark className="size-10" />
          <span className="text-xl text-muted-foreground">×</span>
          <AtlasLogo size={44} spin className="size-14 dark:invert" />
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-balance">
          Reviewed by Sift, mapped by Atlas.
        </h1>

        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground text-pretty">
          So when production breaks, Atlas traces the incident back through the deploy to the pull
          request — and the exact issues Sift flagged before it ever merged.
        </p>

        <span className="mt-8 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Coming soon
        </span>
      </div>
    </div>
  );
}
