import type { Config } from "tailwindcss";

/**
 * Atlas design tokens (docs/09 §3.1) — a dense, technical dark aesthetic (Linear/Datadog).
 * Colors are CSS variables (globals.css) so the certainty visual language (observed /
 * inferred-high / inferred-low / stale) is themable and consistent across components.
 */
export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg))",
        surface: "hsl(var(--surface))",
        border: "hsl(var(--border))",
        fg: "hsl(var(--fg))",
        muted: "hsl(var(--muted))",
        primary: "hsl(var(--primary))",
        // Certainty palette (docs/09 §3.2)
        observed: "hsl(var(--observed))",
        "inferred-high": "hsl(var(--inferred-high))",
        "inferred-low": "hsl(var(--inferred-low))",
        stale: "hsl(var(--stale))",
        danger: "hsl(var(--danger))",
      },
      borderRadius: { lg: "0.6rem", md: "0.4rem", sm: "0.25rem" },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
