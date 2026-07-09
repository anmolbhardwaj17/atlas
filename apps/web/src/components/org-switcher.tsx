"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { getMyOrgs, type MyOrg } from "@/lib/browser-api";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/**
 * Org switcher (shadcn team-switcher pattern) — a user can belong to multiple orgs; this picks the
 * active one. Selection is stored in the `atlas_active_org` cookie that `requireShell` reads
 * server-side, so the whole app (server + client) re-renders scoped to the chosen org on refresh.
 */
export function OrgSwitcher() {
  const router = useRouter();
  const [orgs, setOrgs] = React.useState<MyOrg[]>([]);
  const [currentId, setCurrentId] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      const { memberships, defaultOrgId } = await getMyOrgs();
      setOrgs(memberships);
      const cookie = readCookie(ACTIVE_ORG_COOKIE);
      const current =
        memberships.find((m) => m.orgId === cookie) ??
        memberships.find((m) => m.orgId === defaultOrgId) ??
        memberships[0];
      setCurrentId(current?.orgId ?? null);
    })();
  }, []);

  const current = orgs.find((o) => o.orgId === currentId);
  if (!current) return null;

  function switchTo(orgId: string) {
    if (orgId === currentId) return;
    document.cookie = `${ACTIVE_ORG_COOKIE}=${orgId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setCurrentId(orgId);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
              tooltip={current.orgName}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background">
                <Building2 className="size-4" />
              </span>
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  Organization
                </span>
                <span className="truncate text-sm font-semibold">{current.orgName}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organizations
            </DropdownMenuLabel>
            {orgs.map((o) => (
              <DropdownMenuItem key={o.orgId} onClick={() => switchTo(o.orgId)} className="gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded border border-border bg-background">
                  <Building2 className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">{o.orgName}</span>
                {o.orgId === currentId ? (
                  <Check className="size-4 shrink-0 text-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push("/")}
              className="gap-2 text-muted-foreground"
            >
              <span className="grid size-6 shrink-0 place-items-center">
                <Plus className="size-4" />
              </span>
              Create organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
