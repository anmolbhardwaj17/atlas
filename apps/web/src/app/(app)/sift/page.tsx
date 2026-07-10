import { SiftMark } from "@/components/sift-mark";
import { AtlasLogo } from "@/components/brand";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";
import { Button } from "@/components/ui/button";

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

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
        Atlas maps your infrastructure, code, and deployments into one continuously-updated graph.
        Sift adds a review of every change flowing through it. Connected, they close the loop that
        matters most: when an alarm fires, Atlas can walk from the failing service → the deploy that
        shipped it → the pull request → and the exact issues Sift flagged on it — a cited path from
        symptom to cause, not a guess.
      </p>

      <Button disabled className="mt-8">
        Coming soon
      </Button>
    </div>
  );
}
