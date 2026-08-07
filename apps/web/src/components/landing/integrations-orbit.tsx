import { CloudIcon } from "@/components/cloud-icon";
import { AtlasLogo } from "@/components/brand";

/**
 * The integrations orbit: everything Atlas reads, circling the mark that reads it.
 *
 * Two counter-rotating rings around the Atlas globe. The ring's dashed border and the icons that
 * ride it are the SAME element, so an icon always sits exactly on its track — the first version
 * drew the tracks with percentage insets and placed the icons at fixed pixel radii, which meant the
 * two only lined up at one container width and drifted apart at every other.
 *
 * Each icon is positioned by rotating a full-size layer, pinning the icon to the top of it, and
 * counter-rotating the icon itself so it stays upright while its ring turns. Depth comes from the
 * inner ring being smaller, faster and lighter than the outer one.
 *
 * Pure CSS on a server component: no JS, no 3D library, no WebGL. A marketing flourish should not
 * be the heaviest thing on the page, and `rotate` on a composited layer costs nothing. All motion
 * is inside `motion-safe:`, so reduced-motion visitors get a still, legible arrangement.
 *
 * Light surface on purpose: brand logos are drawn for white. On a dark card they need a tint or an
 * invert to stay legible, which means showing every partner's mark in the wrong colour — the one
 * detail a visitor recognising their own stack notices first.
 *
 * Only real, bundled logos appear here — `CloudIcon` renders nothing for a name it doesn't have, so
 * an invented integration would silently become a hole in the ring. Everything shown is a provider
 * Atlas genuinely connects to; the ring is captioned "what you already use", so padding it with
 * logos we don't support would be the cheapest possible lie.
 *
 * The rings interleave by COLOUR (see below), which is the only ordering that makes a ring of
 * developer-tool logos legible — most of them are blue.
 */
/**
 * Ordered by HUE, not by vendor. Nearly every developer-tool logo is blue, so a list picked by
 * relevance alone produced a ring where seven of ten tiles were the same colour and nothing was
 * distinguishable at a glance. Neighbours now alternate colour families — black, orange, blue,
 * purple, multicolour, green, red — which is what lets the eye pick out individual tools while the
 * ring turns. Every entry is still a provider Atlas genuinely reads.
 */
const INNER = [
  "aws-lambda", // orange
  "google-cloud", // multicolour
  "terraform-icon", // purple
  "aws-iam", // red
  "jira", // blue
  "aws-route53", // violet
];
const OUTER = [
  "github-icon", // black
  "aws-ec2", // orange
  "microsoft-azure", // blue
  "discord-icon", // indigo
  "slack-icon", // multicolour
  "aws-ecs", // orange
  "bitbucket", // blue
  "microsoft-teams", // violet
  "aws-s3", // green
  "docker-icon", // cyan
];

function Ring({
  names,
  inset,
  duration,
  size,
  reverse,
}: {
  names: string[];
  /** Distance from the container edge — sets the orbit radius for the border AND its icons. */
  inset: string;
  duration: number;
  size: number;
  reverse?: boolean;
}) {
  const spin = reverse
    ? "motion-safe:animate-[spin_var(--dur)_linear_infinite_reverse]"
    : "motion-safe:animate-[spin_var(--dur)_linear_infinite]";
  const counter = reverse
    ? "motion-safe:animate-[spin_var(--dur)_linear_infinite]"
    : "motion-safe:animate-[spin_var(--dur)_linear_infinite_reverse]";

  return (
    <div
      className={`absolute rounded-full border border-dashed border-neutral-200 ${spin}`}
      style={{ inset, ["--dur" as string]: `${duration}s` }}
      aria-hidden="true"
    >
      {names.map((name, i) => {
        const angle = (360 / names.length) * i;
        return (
          // A full-size layer rotated to the icon's angle; the icon pins to the top of it, which is
          // exactly on the dashed border above.
          <div key={name} className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
            <div
              className="absolute left-1/2 top-0"
              style={{ transform: `translate(-50%, -50%) rotate(${-angle}deg)` }}
            >
              {/* Counter-rotation keeps the logo upright while the ring turns. */}
              <div className={counter} style={{ ["--dur" as string]: `${duration}s` }}>
                <div
                  className="grid place-items-center rounded-2xl border border-neutral-200 bg-white shadow-sm"
                  style={{ width: size, height: size }}
                >
                  <CloudIcon name={name} className="size-1/2" />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function IntegrationsOrbit() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]">
      {/* Insets leave room for the icons, which straddle their border by half their own size. */}
      <Ring names={OUTER} inset="6%" duration={62} size={50} reverse />
      <Ring names={INNER} inset="30%" duration={38} size={44} />

      {/* The centre: Atlas itself, spinning like the mark does everywhere else in the product. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="grid size-24 place-items-center rounded-full border border-neutral-200 bg-white shadow-lg">
          <AtlasLogo size={52} spin className="size-[52px]" />
        </div>
      </div>
    </div>
  );
}
