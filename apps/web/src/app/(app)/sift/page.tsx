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
      {/* The data-viz backdrop settles in first (slow fade), then the message reveals on top. */}
      <div className="absolute inset-0 animate-in fade-in fill-mode-both duration-1000 ease-out">
        <SiftBackdrop />
      </div>

      <div className="relative z-10 flex max-w-2xl flex-col items-center px-6 text-center">
        <SetBreadcrumbs items={[{ label: "Sift" }]} />

        {/* Staggered entrance: the pairing mark scales in, then each line rises in turn. */}
        <div className="flex animate-in items-center gap-3 fade-in zoom-in-95 fill-mode-both [animation-delay:120ms] duration-700 ease-out">
          <SiftMark className="size-10" />
          <span className="text-xl text-muted-foreground pl-2">×</span>
          <AtlasLogo size={44} spin className="size-14 dark:invert" />
        </div>

        <h1 className="mt-8 animate-in text-2xl font-semibold tracking-tight text-balance fade-in slide-in-from-bottom-2 fill-mode-both [animation-delay:260ms] duration-700 ease-out">
          Reviewed by Sift, mapped by Atlas.
        </h1>

        <p className="mt-4 animate-in text-[15px] leading-relaxed text-muted-foreground text-pretty fade-in slide-in-from-bottom-2 fill-mode-both [animation-delay:420ms] duration-700 ease-out">
          So when production breaks, Atlas traces the incident back through the deploy to the pull
          request — and the exact issues Sift flagged before it ever merged.
        </p>

        <span className="mt-8 animate-in text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground fade-in fill-mode-both [animation-delay:600ms] duration-700 ease-out">
          Coming soon
        </span>
      </div>
    </div>
  );
}
