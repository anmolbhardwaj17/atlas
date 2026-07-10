import { SiftMark } from "@/components/sift-mark";
import { AtlasLogo } from "@/components/brand";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";

/**
 * Sift — AI code review under the Atlas umbrella. Onboarding isn't wired yet, so the page is a
 * single focused statement of the pairing (Sift × Atlas) with a "Coming soon" CTA. Once an org
 * enables Sift, this route becomes its Sift dashboard.
 */
export default function SiftPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-2xl flex-col items-center justify-center text-center">
      <SetBreadcrumbs items={[{ label: "Sift" }]} />

      {/* The pairing mark — Sift × Atlas (the Atlas globe rotates). */}
      <div className="flex items-center gap-3">
        <SiftMark className="size-10" />
        <span className="text-xl text-muted-foreground">×</span>
        <AtlasLogo size={44} spin className="size-14 dark:invert" />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-balance">
        Sift and Atlas — better together
      </h1>

      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground text-pretty">
        Sift reviews every pull request; Atlas maps where that code runs. Together, a production
        incident traces straight back to the change that caused it — and the exact issues Sift
        flagged on it.
      </p>

      <div className="mt-8 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60" />
        Coming soon
      </div>
    </div>
  );
}
