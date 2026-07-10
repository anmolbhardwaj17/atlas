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
 * App-wide toast surface (sonner — shadcn's recommended replacement for the deprecated `toast`),
 * theme-aware. Needs to actually CATCH THE EYE in both themes: the elevated `popover` surface (not
 * flat `background`), a clear border, and a PRONOUNCED drop shadow so it lifts off the page in light
 * mode (where it was invisible) and reads as a floating card in dark mode. No close button.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useHtmlTheme();
  return (
    <Sonner
      theme={theme}
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:rounded-xl group-[.toaster]:shadow-[0_12px_44px_-10px_rgba(0,0,0,0.38)] dark:group-[.toaster]:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.70)]",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
