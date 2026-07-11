"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { getClientToken, acceptInvitation } from "@/lib/browser-api";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { Button } from "@/components/ui/button";
import { AtlasLogo } from "@/components/brand";

type State =
  | { k: "loading" }
  | { k: "signin" }
  | { k: "accepting" }
  | { k: "done"; org: string }
  | { k: "error"; msg: string };

/**
 * Invitation accept (docs/12 §6.2). The token in the URL is the capability. If not signed in, we
 * bounce through /login (carrying `next` so they return here); once signed in, we accept the invite
 * and land them in the org. The API enforces the email match + expiry.
 */
export default function InviteAcceptPage() {
  const token = useParams<{ token: string }>().token;
  const router = useRouter();
  const [state, setState] = React.useState<State>({ k: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t = await getClientToken();
      if (cancelled) return;
      if (!t) return setState({ k: "signin" });
      setState({ k: "accepting" });
      try {
        const res = await acceptInvitation(token);
        if (cancelled) return;
        // Land in the workspace they just joined, not whatever org was active before. Set the
        // switcher cookie so the server render picks the invited org.
        if (res?.orgId) {
          document.cookie = `${ACTIVE_ORG_COOKIE}=${res.orgId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
        }
        setState({ k: "done", org: res?.orgName ?? "your team" });
        setTimeout(() => {
          router.push("/dashboard");
          router.refresh();
        }, 1400);
      } catch (e) {
        if (!cancelled) {
          setState({ k: "error", msg: e instanceof Error ? e.message : "Couldn't accept." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-8 text-center shadow-sm">
        <AtlasLogo size={40} className="mx-auto size-10 dark:invert" />

        {(state.k === "loading" || state.k === "accepting") && (
          <>
            <Loader2 className="mx-auto mt-6 size-6 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {state.k === "accepting" ? "Accepting your invitation…" : "Loading…"}
            </p>
          </>
        )}

        {state.k === "signin" && (
          <>
            <h1 className="mt-5 text-lg font-semibold tracking-tight">You&apos;ve been invited</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Sign in to accept — use the email the invitation was sent to.
            </p>
            <Button asChild className="mt-6 w-full">
              <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
                Continue with Google
              </Link>
            </Button>
          </>
        )}

        {state.k === "done" && (
          <>
            <CheckCircle2 className="mx-auto mt-6 size-7 text-success" />
            <h1 className="mt-3 text-lg font-semibold tracking-tight">You&apos;re in</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Joined <span className="font-medium text-foreground">{state.org}</span>. Taking you to
              your dashboard…
            </p>
          </>
        )}

        {state.k === "error" && (
          <>
            <XCircle className="mx-auto mt-6 size-7 text-danger" />
            <h1 className="mt-3 text-lg font-semibold tracking-tight">Couldn&apos;t accept</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{state.msg}</p>
            <Button asChild variant="outline" className="mt-6 w-full">
              <Link href="/dashboard">Go to Atlas</Link>
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
