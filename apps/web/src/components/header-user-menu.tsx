"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings, Plug, LogOut, MoonStar } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** localStorage key the pre-hydration script in the root layout also reads (keep them in sync). */
const THEME_KEY = "atlas.theme";

/**
 * The account menu, moved from the sidebar footer to the top-right of the header: avatar trigger →
 * a dropdown with the user's identity, quick links, an inline Dark mode toggle, and sign out.
 * Pure shadcn DropdownMenu; the theme toggle flips the `dark` class on <html> (Tailwind class
 * strategy) and persists the choice.
 */
export function HeaderUserMenu({
  email,
  name,
  avatarUrl,
}: {
  email: string;
  name?: string | null | undefined;
  avatarUrl?: string | null | undefined;
}) {
  const router = useRouter();
  // Reflect the theme the pre-hydration script already applied (read after mount to stay SSR-safe).
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const displayName = name?.trim() || email || "Account";

  function toggleDark() {
    const el = document.documentElement;
    const next = !el.classList.contains("dark");
    el.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* storage disabled — still toggles for this session */
    }
    setDark(next);
  }

  async function signOut() {
    await createClient().auth.signOut();
    // Go to /login explicitly. A bare refresh used to work only because `/` bounced signed-out
    // users to the login screen; now `/` is a public landing page, so relying on a redirect would
    // leave the destination up to whichever route you happened to sign out from.
    // `replace` + `refresh`: replace keeps the signed-in page out of history (Back must not appear
    // to restore a session), and refresh clears the cached server render it left behind.
    router.replace("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-border"
        >
          <UserAvatar
            value={avatarUrl}
            name={name}
            email={email}
            size={32}
            className="border border-border"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2 font-normal">
          <UserAvatar value={avatarUrl} name={name} email={email} size={36} />
          <div className="grid min-w-0 leading-tight">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/integrations">
            <Plug />
            Integrations
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Dark mode — keep the menu open on click so the toggle feels live. */}
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={dark}
          onSelect={(e) => {
            e.preventDefault();
            toggleDark();
          }}
          className="justify-between"
        >
          <span className="flex items-center gap-2">
            <MoonStar className="size-4" />
            Dark mode
          </span>
          <span
            aria-hidden
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
              dark ? "bg-foreground" : "bg-input",
            )}
          >
            <span
              className={cn(
                "inline-block size-4 rounded-full bg-background shadow transition-transform",
                dark ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => void signOut()}
          className="text-danger focus:bg-danger/10 focus:text-danger"
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
