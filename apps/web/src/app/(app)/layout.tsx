import type { ReactNode } from "react";
import { requireShell } from "@/lib/shell";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

/**
 * Authenticated layout - renders the persistent sidebar shell once. Because it's a
 * layout, it survives client navigations between the routes below, so the sidebar
 * doesn't re-render and each page's own loading.tsx skeleton shows in the content
 * area (instant URL change, then loading - docs/09 §7).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const shell = await requireShell();
  return (
    <AppShell orgName={shell.orgName} email={shell.email} orgId={shell.orgId}>
      {children}
    </AppShell>
  );
}
