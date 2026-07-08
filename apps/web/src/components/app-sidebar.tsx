"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  Waypoints,
  Lightbulb,
  Plug,
  Settings,
  ChevronsUpDown,
  LogOut,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AtlasLogo, AtlasAiMark } from "@/components/brand";
import { UserAvatar } from "@/components/user-avatar";
import { CloudIcon } from "@/components/cloud-icon";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    match: (p: string) => p === "/dashboard",
  },
  {
    href: "/map",
    label: "Map",
    icon: Waypoints,
    match: (p: string) => p.startsWith("/map"),
  },
  {
    href: "/explore",
    label: "Explore",
    icon: Boxes,
    match: (p: string) => p.startsWith("/explore"),
  },
  // Ask Atlas carries its own brand mark (the green sphere), not a lucide glyph.
  { href: "/ask", label: "Ask Atlas", icon: null, match: (p: string) => p.startsWith("/ask") },
  {
    href: "/insights",
    label: "Insights",
    icon: Lightbulb,
    match: (p: string) => p.startsWith("/insights"),
  },
  {
    href: "/integrations",
    label: "Integrations",
    icon: Plug,
    match: (p: string) => p.startsWith("/integrations"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    match: (p: string) => p.startsWith("/settings"),
  },
];

/** A dismissible "Connect your apps" promo at the bottom of the sidebar — an aurora tile of app
 *  logos over a Connect (→ Integrations) / Close pair. Hidden when the sidebar collapses to icons,
 *  and stays dismissed (localStorage) once closed. */
const CONNECT_CARD_KEY = "atlas.connectAppsDismissed";
const PROMO_LOGOS = ["github-icon", "slack-icon", "discord-icon", "notion", "figma"];

function ConnectAppsCard() {
  // Start hidden to avoid a flash before we can read the dismissed flag on the client.
  const [dismissed, setDismissed] = React.useState(true);
  React.useEffect(() => {
    setDismissed(localStorage.getItem(CONNECT_CARD_KEY) === "1");
  }, []);
  if (dismissed) return null;

  const close = () => {
    localStorage.setItem(CONNECT_CARD_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mb-1 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar-accent/40 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-center gap-1.5 bg-gradient-to-br from-violet-300 via-sky-200 to-emerald-200 px-3 py-4 dark:from-violet-500/50 dark:via-sky-500/40 dark:to-emerald-500/40">
        {PROMO_LOGOS.map((l) => (
          <div key={l} className="grid size-8 place-items-center rounded-lg bg-white shadow-sm">
            <CloudIcon name={l} className="size-5" />
          </div>
        ))}
      </div>
      <div className="space-y-2.5 p-3">
        <div>
          <p className="text-sm font-semibold">Connect your apps</p>
          <p className="text-xs text-muted-foreground">For more powerful functionality</p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" className="h-8 flex-1">
            <Link href="/integrations">Connect</Link>
          </Button>
          <Button size="sm" variant="outline" className="h-8 flex-1" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AppSidebar({
  orgName,
  email,
  name,
  avatarUrl,
}: {
  orgName: string;
  email: string;
  name?: string | null | undefined;
  avatarUrl?: string | null | undefined;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Dynamic routes wait for a server round-trip before the URL/loading boundary changes, so a
  // click can feel frozen. Show an instant spinner on the clicked item until the route commits.
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  React.useEffect(() => setPendingHref(null), [pathname]);

  async function signOut() {
    await createClient().auth.signOut();
    router.refresh();
  }

  const displayName = name?.trim() || email || "Account";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <AtlasLogo size={32} spin className="size-8 shrink-0" />
                {/* Just the product name here - the org is shown by the account menu at the
                    bottom, so we don't repeat it. */}
                <span className="flex flex-1 items-center truncate text-lg font-semibold">
                  Atlas
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={item.match(pathname)} tooltip={item.label}>
                    <Link
                      href={item.href}
                      onClick={() => {
                        if (!item.match(pathname)) setPendingHref(item.href);
                      }}
                    >
                      {pendingHref === item.href ? (
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                      ) : item.icon ? (
                        <item.icon />
                      ) : (
                        // The Ask Atlas mark reads a touch bigger than the lucide glyphs (it's a
                        // filled sphere, not a line icon); the row height is fixed so this adds no
                        // spacing between items.
                        <AtlasAiMark size={20} className="size-5 shrink-0" />
                      )}
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <ConnectAppsCard />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <UserAvatar value={avatarUrl} name={name} email={email} size={32} />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">{orgName}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
                side="top"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="grid text-sm leading-tight">
                    <span className="truncate font-medium">{displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">{email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
