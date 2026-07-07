"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AtlasLogo, AtlasAiMark } from "@/components/brand";
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

  async function signOut() {
    await createClient().auth.signOut();
    router.refresh();
  }

  const displayName = name?.trim() || email || "Account";
  // Photo if we have one, otherwise a deterministic DiceBear "Dylan" avatar seeded by email.
  const avatar =
    avatarUrl || `https://api.dicebear.com/10.x/dylan/svg?seed=${encodeURIComponent(email)}`;

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
                    <Link href={item.href}>
                      {item.icon ? (
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
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Image
                    src={avatar}
                    alt={displayName}
                    width={32}
                    height={32}
                    unoptimized
                    className="aspect-square size-8 rounded-lg border border-border bg-muted object-cover"
                  />
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
