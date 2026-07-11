"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { apiUrl } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { AtlasLogo } from "@/components/brand";

type State = { k: "loading" } | { k: "done" } | { k: "error"; msg: string };

/**
 * Weekly-digest unsubscribe (#44). The signed token in the URL is the capability — there's no Atlas
 * session. We POST it to the API on mount rather than on GET, so email link-scanners (which fetch the
 * URL but don't run JS) can't unsubscribe someone by accident; a real click runs this and confirms.
 */
function UnsubscribeFlow() {
  const params = useSearchParams();
  const [state, setState] = React.useState<State>({ k: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    const u = params.get("u");
    const o = params.get("o");
    const t = params.get("t");
    if (!u || !o || !t) {
      setState({ k: "error", msg: "This unsubscribe link is incomplete." });
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`${apiUrl()}/email/unsubscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ u, o, t }),
        });
        const json: unknown = await res.json().catch(() => null);
        const ok =
          res.ok &&
          typeof json === "object" &&
          json !== null &&
          Boolean((json as { data?: { ok?: boolean } }).data?.ok);
        if (cancelled) return;
        setState(
          ok
            ? { k: "done" }
            : { k: "error", msg: "This unsubscribe link is invalid or has expired." },
        );
      } catch {
        if (!cancelled) setState({ k: "error", msg: "Something went wrong. Please try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-8 text-center shadow-sm">
        <AtlasLogo size={40} className="mx-auto size-10 dark:invert" />

        {state.k === "loading" && (
          <>
            <Loader2 className="mx-auto mt-6 size-6 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Updating your preferences…</p>
          </>
        )}

        {state.k === "done" && (
          <>
            <CheckCircle2 className="mx-auto mt-6 size-7 text-success" />
            <h1 className="mt-3 text-lg font-semibold tracking-tight">Unsubscribed</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You won&apos;t receive the weekly Atlas digest anymore. Your other Atlas notifications
              are unaffected.
            </p>
            <Button asChild variant="outline" className="mt-6 w-full">
              <Link href="/dashboard">Go to Atlas</Link>
            </Button>
          </>
        )}

        {state.k === "error" && (
          <>
            <XCircle className="mx-auto mt-6 size-7 text-danger" />
            <h1 className="mt-3 text-lg font-semibold tracking-tight">Couldn&apos;t unsubscribe</h1>
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

/** useSearchParams requires a Suspense boundary in the app router. */
export default function UnsubscribePage() {
  return (
    <React.Suspense fallback={null}>
      <UnsubscribeFlow />
    </React.Suspense>
  );
}
