import type { ReactNode } from "react";
import Link from "next/link";
import { Boxes, Search, MessageSquare, Settings } from "lucide-react";
import { SignOutButton } from "@/app/sign-out-button";
import { CommandPalette } from "@/components/command-palette";
import { CommandTrigger } from "@/components/command-trigger";

/**
 * AppShell (docs/09 §5.1) — the authenticated wrapper: TopBar (brand + org + nav + user)
 * over a bounded content area. Server component; the sign-out control is the one island.
 */
const NAV = [
  { href: "/", label: "Dashboard", icon: Boxes },
  { href: "/explore", label: "Explore", icon: Search },
  { href: "/ask", label: "Ask AI", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  orgName,
  email,
  orgId,
  children,
}: {
  orgName: string;
  email: string;
  orgId?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/20 text-primary">
              A
            </span>
            Atlas
            <span className="ml-1 rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted">
              {orgName}
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted hover:bg-border/40 hover:text-fg"
              >
                <Icon size={15} /> {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted">
            {orgId && <CommandTrigger />}
            <span className="hidden sm:inline">{email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      {orgId && <CommandPalette orgId={orgId} />}
    </div>
  );
}
