import Link from "next/link";
import { getSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AtlasLogo } from "@/components/brand";

export const dynamic = "force-dynamic";

/**
 * Public landing page.
 *
 * `/` used to be a pure router (logged out → /login, org → /dashboard, else → /create-org), which
 * meant Atlas had no front door: every visitor was bounced to a sign-in screen before being told
 * what the product is. This is the placeholder for the real marketing page — deliberately bare for
 * now, built from the same design system as the app so replacing it is a content change, not a
 * rewrite.
 *
 * The routing it used to do now lives where it belongs: the OAuth callback lands signed-in users on
 * /dashboard, and `requireShell` sends an org-less member to /create-org. This page stays reachable
 * whether or not you're signed in — a landing page that redirects logged-in users away can't be
 * linked to, which is the one thing a landing page is for. The only thing the session changes is
 * which call-to-action makes sense.
 */
export default async function LandingPage() {
  const session = await getSession();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <AtlasLogo size={64} spin className="size-16 dark:invert" />

      <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">Atlas</h1>

      <p className="mt-4 max-w-md text-balance text-muted-foreground">
        The engineering intelligence platform. Atlas maps your infrastructure, code and deployments
        into one live, cited graph — then lets you ask it anything.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {session ? (
          <Button asChild size="lg">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link href="/login">Log in</Link>
          </Button>
        )}
      </div>

      <footer className="mt-16 flex items-center gap-4 text-xs text-muted-foreground">
        <Link href="/legal/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <span aria-hidden>·</span>
        <Link href="/legal/terms" className="hover:text-foreground">
          Terms
        </Link>
      </footer>
    </main>
  );
}
