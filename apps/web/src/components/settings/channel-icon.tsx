import type { ChannelKind } from "@/lib/browser-api";
import { cn } from "@/lib/cn";

/**
 * Brand marks for the outbound alert channels, in their real colors. Slack is its 4-color
 * hash; Discord its blurple mascot; Teams its purple mark. Inline SVGs (no network) so they
 * work under the strict CSP and match the app's crisp-icon look.
 */
export function ChannelIcon({ kind, className }: { kind: ChannelKind; className?: string }) {
  const cls = cn("shrink-0", className);
  switch (kind) {
    case "slack":
      return (
        <svg viewBox="0 0 122.8 122.8" className={cls} aria-hidden="true">
          <path
            d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9z"
            fill="#E01E5A"
          />
          <path
            d="M32.3 77.6c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
            fill="#E01E5A"
          />
          <path
            d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2z"
            fill="#36C5F0"
          />
          <path
            d="M45.2 32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
            fill="#36C5F0"
          />
          <path
            d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2z"
            fill="#2EB67D"
          />
          <path
            d="M90.5 45.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
            fill="#2EB67D"
          />
          <path
            d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9z"
            fill="#ECB22E"
          />
          <path
            d="M77.6 90.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
            fill="#ECB22E"
          />
        </svg>
      );
    case "discord":
      return (
        <svg viewBox="0 0 127.14 96.36" className={cls} aria-hidden="true">
          <path
            fill="#5865F2"
            d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"
          />
        </svg>
      );
    case "msteams":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path
            fill="#5059C9"
            d="M19.19 8.77h-4.4a1.29 1.29 0 0 0-1.29 1.29v4.66a3.86 3.86 0 0 0 3.5 3.94 3.75 3.75 0 0 0 4-3.74v-4.86a1.29 1.29 0 0 0-1.81-1.29zM22.5 10.9a1.65 1.65 0 1 0-1.94-1.62v1.62z"
          />
          <circle cx="18.5" cy="4.65" r="2.35" fill="#5059C9" />
          <path
            fill="#7B83EB"
            d="M12.99 4.65a3.56 3.56 0 1 0-6.15 2.45h5.72a1.5 1.5 0 0 0 .43-1.05z"
          />
          <path
            fill="#7B83EB"
            d="M11.42 8.77H2.08A1.08 1.08 0 0 0 1 9.85v9.34a1.08 1.08 0 0 0 1.08 1.08h9.34a1.08 1.08 0 0 0 1.08-1.08V9.85a1.08 1.08 0 0 0-1.08-1.08z"
          />
          <path fill="#fff" d="M9.2 12.28H7.06v5.83H5.7v-5.83H3.57V11.1H9.2z" />
        </svg>
      );
  }
}
