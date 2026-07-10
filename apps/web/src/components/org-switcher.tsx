"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { getMyOrgs, type MyOrg } from "@/lib/browser-api";
import { ACTIVE_ORG_COOKIE, ORG_UPDATED_EVENT } from "@/lib/active-org";
import { OrgLogo } from "@/components/org-logo";
import { cn } from "@/lib/cn";
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
 * Org switcher — a user can belong to multiple orgs; this picks the active one. Lives in the top
 * bar (top-left, next to the sidebar toggle). Selection is stored in the `atlas_active_org` cookie
 * that `requireShell` reads server-side, so the whole app re-renders scoped to the chosen org.
 */
export function OrgSwitcher({
  initialOrgs,
  initialCurrentId,
}: {
  /** Memberships from the server render (requireShell) — seed state so we skip the mount /me fetch.
   *  initialCurrentId is the already-resolved active org (cookie → default → first, server-side). */
  initialOrgs?: MyOrg[] | undefined;
  initialCurrentId?: string | null | undefined;
} = {}) {
  const router = useRouter();
  const [orgs, setOrgs] = React.useState<MyOrg[]>(initialOrgs ?? []);
  const [currentId, setCurrentId] = React.useState<string | null>(initialCurrentId ?? null);
  // The whole app re-renders server-side on an org switch (force-dynamic + router.refresh), which
  // takes a beat. Without feedback the OLD org's page lingers and reads as broken. useTransition
  // keeps isPending true until that re-render lands, so we can show a "Switching workspace…" overlay.
  const [isSwitching, startSwitch] = React.useTransition();

  const load = React.useCallback(async () => {
    const { memberships, defaultOrgId } = await getMyOrgs();
    setOrgs(memberships);
    const cookie = readCookie(ACTIVE_ORG_COOKIE);
    const current =
      memberships.find((m) => m.orgId === cookie) ??
      memberships.find((m) => m.orgId === defaultOrgId) ??
      memberships[0];
    setCurrentId(current?.orgId ?? null);
  }, []);

  React.useEffect(() => {
    // The server already handed us the memberships (initialOrgs), so we DON'T fetch /me on mount —
    // that duplicate round-trip was the P2a target. Only re-pull when an org's name/logo actually
    // changes (settings), where staleness would otherwise show a wrong mark. If we somehow mounted
    // without server data (defensive), fall back to a one-time load.
    if (!initialOrgs || initialOrgs.length === 0) void load();
    const onUpdate = () => void load();
    window.addEventListener(ORG_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(ORG_UPDATED_EVENT, onUpdate);
  }, [load, initialOrgs]);

  const current = orgs.find((o) => o.orgId === currentId);
  if (!current) return null;

  function switchTo(orgId: string) {
    if (orgId === currentId) return;
    document.cookie = `${ACTIVE_ORG_COOKIE}=${orgId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setCurrentId(orgId);
    // Inside the transition so isSwitching stays true until the new org's server render commits.
    startSwitch(() => {
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <>
      {isSwitching ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-background/80 backdrop-blur-sm duration-200 animate-in fade-in">
          <div className="flex flex-col items-center gap-5">
            {/* The destination org's logo, centered and large, with a spinning accent ring around it
                so the switch reads as "loading <this workspace>", not a generic spinner. */}
            <div className="relative grid size-20 place-items-center">
              <div className="absolute inset-0 animate-spin rounded-full border-2 border-border border-t-foreground [animation-duration:0.9s]" />
              <OrgLogo
                name={current.orgName}
                logoUrl={current.orgLogoUrl}
                size={52}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium">Switching workspace</p>
              <p className="text-sm text-muted-foreground">
                Loading <span className="text-foreground">{current.orgName}</span>…
              </p>
            </div>
          </div>
        </div>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-1.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <OrgLogo
              name={current.orgName}
              logoUrl={current.orgLogoUrl}
              size={20}
              bordered={false}
            />
            <span className="max-w-[160px] truncate">{current.orgName}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56"
          // Don't return focus to the trigger on close — otherwise closing by clicking outside
          // restores focus programmatically, which the browser treats as :focus-visible and leaves
          // a focus ring stuck on the button. Keyboard Tab-focus still shows the ring normally.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Organizations
          </DropdownMenuLabel>
          {orgs.map((o) => (
            <DropdownMenuItem key={o.orgId} onClick={() => switchTo(o.orgId)} className="gap-2">
              <OrgLogo name={o.orgName} logoUrl={o.orgLogoUrl} size={24} />
              <span className="min-w-0 flex-1 truncate">{o.orgName}</span>
              <Check
                className={cn(
                  "size-4 shrink-0",
                  o.orgId === currentId ? "opacity-100" : "opacity-0",
                )}
              />
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
    </>
  );
}
