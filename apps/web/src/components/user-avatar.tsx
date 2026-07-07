"use client";

import Image from "next/image";
import Avvvatars from "avvvatars-react";
import { cn } from "@/lib/cn";

/**
 * One avatar renderer for the whole app. The stored `value` decides what shows:
 *   - an http(s) URL      → a real photo (e.g. the Google profile picture)
 *   - "avv:shape:<seed>"  → a generated geometric shape (avvvatars)
 *   - "avv:character" / "" → the user's initials on a generated color (avvvatars, the default)
 * avvvatars renders locally (no network), so initials/shapes work offline and under any CSP.
 */
export function UserAvatar({
  value,
  name,
  email,
  size = 40,
  className,
}: {
  value?: string | null | undefined;
  name?: string | null | undefined;
  email: string;
  size?: number;
  className?: string | undefined;
}) {
  const round = cn("shrink-0 overflow-hidden rounded-full", className);

  if (value && /^https?:\/\//.test(value)) {
    return (
      <Image
        src={value}
        alt={name ?? email}
        width={size}
        height={size}
        unoptimized
        className={cn(round, "border border-border bg-muted object-cover")}
        style={{ width: size, height: size }}
      />
    );
  }

  if (value?.startsWith("avv:shape:")) {
    const seed = value.slice("avv:shape:".length) || email;
    return (
      <span className={round} style={{ width: size, height: size }}>
        <Avvvatars value={seed} style="shape" size={size} radius={size} />
      </span>
    );
  }

  // Default: initials (first + last) on a deterministic color.
  return (
    <span className={round} style={{ width: size, height: size }}>
      <Avvvatars
        value={email || name || "?"}
        displayValue={initials(name, email)}
        size={size}
        radius={size}
      />
    </span>
  );
}

/** First + last initial (falls back to the email's first letters). */
export function initials(name: string | null | undefined, email: string): string {
  const src = name?.trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || "?";
}
