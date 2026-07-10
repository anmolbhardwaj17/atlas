"use client";

import * as React from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Follow the app's theme: the header toggle flips the `dark` class on <html> (no next-themes), so
 *  we watch that class live and hand sonner the right theme — otherwise toasts render light in dark
 *  mode. Starts light and syncs on mount (avoids an SSR/hydration mismatch; toasts appear post-mount). */
function useHtmlTheme(): "light" | "dark" {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  React.useEffect(() => {
    const el = document.documentElement;
    const sync = () => setTheme(el.classList.contains("dark") ? "dark" : "light");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/**
 * App-wide toast surface (sonner — shadcn's recommended replacement for the deprecated `toast`).
 * Default sonner look on purpose (no close button, no custom border) — just theme-aware so it
 * follows the header dark-mode toggle. Add richColors/closeButton/custom styling later if wanted.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useHtmlTheme();
  return <Sonner theme={theme} position="top-right" {...props} />;
};

export { Toaster };
