"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  Waypoints,
  Lightbulb,
  ShieldCheck,
  Plug,
  Settings,
  Loader2,
} from "lucide-react";
import { AtlasLogo, AtlasAiMark } from "@/components/brand";
import { SiftMark } from "@/components/sift-mark";
// import { CloudIcon } from "@/components/cloud-icon"; // used by ConnectAppsCard (disabled for now)
// import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard | null;
  match: (p: string) => boolean;
}

// Two meaningful groups instead of one catch-all "Platform": what you USE to understand your
// estate, and what you MANAGE (connections + settings). Item labels mirror each page's H1.
const WORKSPACE_NAV: NavItem[] = [
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
    href: "/compliance",
    label: "Compliance",
    icon: ShieldCheck,
    match: (p: string) => p.startsWith("/compliance"),
  },
  // Sift carries its own brand glyph (the shield "S"), not a lucide icon.
  { href: "/sift", label: "Sift", icon: null, match: (p: string) => p.startsWith("/sift") },
];

const MANAGE_NAV: NavItem[] = [
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

/* A dismissible "Connect your apps" promo for the bottom of the sidebar — an aurora tile of app
 * logos over a Connect (→ Integrations) / Close pair. Disabled for now; re-enable by uncommenting
 * this block, its <ConnectAppsCard /> use in the footer, and the CloudIcon/Button imports above.
 *
const CONNECT_CARD_KEY = "atlas.connectAppsDismissed";
const PROMO_LOGOS = ["aws", "microsoft-azure", "github-icon", "bitbucket", "slack-icon"];

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
    <div className="mb-1 overflow-hidden rounded-xl border border-sidebar-border bg-background group-data-[collapsible=icon]:hidden">
      <div
        className="flex items-center justify-center gap-1.5 px-3 py-8"
        style={{
          backgroundImage: [
            "radial-gradient(120% 120% at 12% 12%, rgba(196,181,253,0.9), transparent 52%)",
            "radial-gradient(120% 120% at 88% 22%, rgba(253,186,208,0.85), transparent 55%)",
            "radial-gradient(120% 120% at 72% 92%, rgba(191,219,254,0.9), transparent 55%)",
            "radial-gradient(120% 120% at 96% 82%, rgba(254,205,170,0.75), transparent 55%)",
            "linear-gradient(135deg, #ede9fe, #e0f2fe)",
          ].join(", "),
        }}
      >
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
*/

export function AppSidebar() {
  const pathname = usePathname();
  // Dynamic routes wait for a server round-trip before the URL/loading boundary changes, so a
  // click can feel frozen. Show an instant spinner on the clicked item until the route commits.
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  React.useEffect(() => setPendingHref(null), [pathname]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <AtlasLogo size={32} spin className="size-8 shrink-0 dark:invert" />
                {/* Just the product name here - the account/org lives in the top-right header menu. */}
                <span className="flex flex-1 items-center truncate text-lg font-semibold">
                  Atlas
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {(
          [
            ["Workspace", WORKSPACE_NAV],
            ["Manage", MANAGE_NAV],
          ] as const
        ).map(([label, items]) => (
          <SidebarGroup key={label}>
            <SidebarGroupLabel>{label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => (
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
                        ) : item.href === "/sift" ? (
                          <SiftMark className="size-2.5 shrink-0" />
                        ) : (
                          // The Ask Atlas mark reads a touch bigger than the lucide glyphs (it's a
                          // filled sphere, not a line icon); the row height is fixed so this adds no
                          // spacing between items.
                          <AtlasAiMark size={20} className="size-5 shrink-0" />
                        )}
                        <span>{item.label}</span>
                        {item.href === "/sift" ? (
                          <span className="ml-auto shrink-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70 group-data-[collapsible=icon]:hidden">
                            Coming Soon
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
