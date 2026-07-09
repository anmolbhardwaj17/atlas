import { cn } from "@/lib/cn";

/**
 * An org's visual identity: its uploaded logo, or a generated monogram (first letter of the name)
 * when there's none. Square, rounded, used in the org switcher and settings. `size` is the box in px.
 */
export function OrgLogo({
  name,
  logoUrl,
  size = 24,
  className,
  bordered = true,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
  bordered?: boolean;
}) {
  const box = cn(
    "shrink-0 overflow-hidden rounded bg-background",
    bordered && "border border-border",
    className,
  );
  if (logoUrl) {
    return (
      // A plain <img>: the logo is a user-supplied URL on a public bucket, and next/image would
      // need each Supabase host allow-listed while adding nothing for a tiny fixed-size mark.
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className={cn(box, "object-cover")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn(box, "grid place-items-center font-semibold text-muted-foreground")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden
    >
      {monogram(name)}
    </span>
  );
}

function monogram(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}
