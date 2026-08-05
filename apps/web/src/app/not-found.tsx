import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * App-router 404 (docs/09 §7 - a designed state, never a raw error). Standalone (outside
 * the app shell), so a centered hero matching the login/landing aesthetic. Also makes
 * Next generate the 404 via the app router instead of the pages-router fallback.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mx-auto mt-2 text-sm text-muted-foreground">
          The page you&rsquo;re looking for doesn&rsquo;t exist or you don&rsquo;t have access to
          it.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
