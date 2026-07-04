import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Brand marks. Two distinct assets, used deliberately (docs/09):
 * - `AtlasLogo`   — the geometric globe. The product/company mark: sidebar, login, favicon.
 * - `AtlasAiMark` — the green gradient sphere. The AI interface (P1): Ask AI everywhere.
 * Both are square PNGs in /public; pass a Tailwind size via `className` (e.g. `size-8`).
 */
export function AtlasLogo({
  className,
  size = 32,
  spin = false,
}: {
  className?: string;
  size?: number;
  /** Continuous 360° rotation (globe-like). Honors prefers-reduced-motion. */
  spin?: boolean;
}) {
  return (
    <Image
      src="/atlas-logo.png"
      alt="Atlas"
      width={size}
      height={size}
      priority
      className={cn(
        "object-contain",
        spin && "motion-safe:animate-[spin_5s_linear_infinite]",
        className,
      )}
    />
  );
}

export function AtlasAiMark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <Image
      src="/atlas-ai.png"
      alt="Atlas AI"
      width={size}
      height={size}
      className={cn("object-contain", className)}
    />
  );
}
