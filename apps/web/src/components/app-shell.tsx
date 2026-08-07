import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { CommandTrigger } from "@/components/command-trigger";
import { NotificationBell } from "@/components/notification-bell";
import { HeaderUserMenu } from "@/components/header-user-menu";
import { OrgSwitcher } from "@/components/org-switcher";
import { PersistActiveOrg } from "@/components/persist-active-org";
import type { MyOrg } from "@/lib/browser-api";
import { BreadcrumbProvider } from "@/components/breadcrumb-context";
import { HeaderBreadcrumbs } from "@/components/header-breadcrumbs";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

/**
 * AppShell (docs/09 §5.1) - the authenticated wrapper: a collapsible shadcn sidebar
 * (nav + org + user) beside a bounded content area with a sticky header (sidebar toggle
 * + ⌘K search). Server component; the interactive pieces are client islands.
 */
export function AppShell({
  email,
  orgId,
  title,
  name,
  avatarUrl,
  orgs,
  children,
}: {
  email: string;
  orgId?: string;
  title?: string;
  name?: string | null;
  avatarUrl?: string | null;
  /** The user's memberships from the server render — seeds OrgSwitcher without a client /me fetch. */
  orgs?: MyOrg[];
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      {/* Skip link - first tab stop; lets keyboard users bypass the sidebar nav to the page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <AppSidebar {...(orgId ? { orgId } : {})} />
      {/* min-w-0: this is a flex item; without it, a page with intrinsically-wide content (e.g. the
          onboarding carousel's marquee row) forces <main> to grow to its content width and spills a
          page-wide horizontal scroll. min-w-0 lets it shrink so children's overflow-hidden clips. */}
      <SidebarInset className="min-w-0">
        <BreadcrumbProvider>
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            {/* Org switcher (multi-org) lives top-left, next to the toggle - the standard spot. */}
            {orgId && <OrgSwitcher initialOrgs={orgs} initialCurrentId={orgId} />}
            {/* Page breadcrumb (published per-page); falls back to an optional title. It renders its
                own leading divider when present, so we don't add one here (avoids a double rule).
                Hidden on phones - the sidebar + the page's own H1 give context, and it would crowd the
                header against the right-side controls. */}
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              <HeaderBreadcrumbs />
              {title ? (
                <>
                  <Separator orientation="vertical" className="mr-1 h-4" />
                  <span className="text-sm font-medium">{title}</span>
                </>
              ) : null}
            </div>
            <div className="ml-auto flex items-center gap-2.5">
              {orgId && <CommandTrigger />}
              {orgId && <NotificationBell orgId={orgId} />}
              <HeaderUserMenu email={email} name={name} avatarUrl={avatarUrl} />
            </div>
          </header>
          <div id="main-content" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
            <div className="w-full">{children}</div>
          </div>
        </BreadcrumbProvider>
      </SidebarInset>
      {orgId && <CommandPalette orgId={orgId} />}
      {/* Primes the active-org cookie so page navigations resolve auth without a /me round-trip. */}
      {orgId && <PersistActiveOrg orgId={orgId} />}
    </SidebarProvider>
  );
}
