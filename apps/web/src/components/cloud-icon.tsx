import { CLOUD_ICONS } from "@/lib/cloud-icons-data";

/**
 * Renders a real provider service/brand logo (AWS, Azure, GCP, GitHub, …) from the bundled,
 * offline icon data. The SVG bodies carry their own brand colors, so `className` only sizes
 * them. Returns null for an unknown name (callers fall back to a generic icon).
 */
export function CloudIcon({ name, className }: { name: string; className?: string }) {
  const ic = CLOUD_ICONS[name];
  if (!ic) return null;
  return (
    <svg
      viewBox={`0 0 ${ic.width} ${ic.height}`}
      className={className}
      role="img"
      aria-hidden="true"
      // Trusted, build-time icon data (CC0 logos) — not user input.
      dangerouslySetInnerHTML={{ __html: ic.body }}
    />
  );
}

/** Whether a real logo exists for this name (so callers can decide on a fallback). */
export function hasCloudIcon(name: string): boolean {
  return name in CLOUD_ICONS;
}
