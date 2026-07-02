import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { CommandTrigger } from "@/components/command-trigger";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

/**
 * AppShell (docs/09 §5.1) - the authenticated wrapper: a collapsible shadcn sidebar
 * (nav + org + user) beside a bounded content area with a sticky header (sidebar toggle
 * + ⌘K search). Server component; the interactive pieces are client islands.
 */
export function AppShell({
  orgName,
  email,
  orgId,
  title,
  children,
}: {
  orgName: string;
  email: string;
  orgId?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar orgName={orgName} email={email} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-sm font-medium">{title ?? "Atlas"}</span>
          <div className="ml-auto">{orgId && <CommandTrigger />}</div>
        </header>
        <div className="flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </div>
      </SidebarInset>
      {orgId && <CommandPalette orgId={orgId} />}
    </SidebarProvider>
  );
}
