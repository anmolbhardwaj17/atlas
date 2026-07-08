import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { CommandTrigger } from "@/components/command-trigger";
import { NotificationBell } from "@/components/notification-bell";
import { HeaderUserMenu } from "@/components/header-user-menu";
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
  children,
}: {
  email: string;
  orgId?: string;
  title?: string;
  name?: string | null;
  avatarUrl?: string | null;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <BreadcrumbProvider>
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            {/* Page breadcrumb (published per-page); falls back to an optional title. The app name
                already lives in the sidebar brand, so we don't repeat "Atlas" here. */}
            <HeaderBreadcrumbs />
            {title ? (
              <>
                <Separator orientation="vertical" className="mr-1 h-4" />
                <span className="text-sm font-medium">{title}</span>
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-2.5">
              {orgId && <CommandTrigger />}
              {orgId && <NotificationBell orgId={orgId} />}
              <HeaderUserMenu email={email} name={name} avatarUrl={avatarUrl} />
            </div>
          </header>
          <div className="flex-1 p-4 md:p-6">
            <div className="w-full">{children}</div>
          </div>
        </BreadcrumbProvider>
      </SidebarInset>
      {orgId && <CommandPalette orgId={orgId} />}
    </SidebarProvider>
  );
}
