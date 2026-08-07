import { CloudIcon } from "@/components/cloud-icon";
import { AtlasLogo } from "@/components/brand";

/**
 * The integrations orbit: everything Atlas reads, circling the mark that reads it.
 *
 * Two counter-rotating rings around the Atlas globe. Each icon sits on a ring via a rotate →
 * translate → counter-rotate transform chain, so it rides the orbit while staying upright — the
 * detail that separates this from a spinning sticker sheet. Depth comes from the inner ring being
 * smaller, brighter and faster than the outer one, which is how parallax reads to the eye.
 *
 * Pure CSS on a server component: no JS, no 3D library, no WebGL. A marketing flourish should not
 * be the heaviest thing on the page, and `rotate` on a composited layer costs nothing. The whole
 * animation is inside `motion-safe:`, so reduced-motion visitors get a still, legible arrangement
 * rather than a stopped-mid-frame mess.
 *
 * Light surface: brand logos are drawn for white. On the dark card they needed a tint or an invert
 * to stay legible, which meant showing every partner's mark in the wrong colour — the one detail a
 * visitor recognising their own stack would notice first.
 *
 * Only real, bundled logos appear here — `CloudIcon` renders nothing for a name it doesn't have, so
 * an invented integration would silently become a hole. That constraint is doing useful work: the
 * ring can only ever show things that actually exist.
 */
const INNER = ["aws-ec2", "aws-lambda", "aws-rds", "aws-s3", "aws-ecs"];
const OUTER = [
  "bitbucket",
  "github-icon",
  "jira",
  "google-cloud",
  "microsoft-azure",
  "slack-icon",
  "discord-icon",
  "microsoft-teams",
  "docker-icon",
  "terraform-icon",
];

function Ring({
  names,
  radius,
  duration,
  size,
  reverse,
}: {
  names: string[];
  radius: number;
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
      className={`absolute inset-0 ${spin}`}
      style={{ ["--dur" as string]: `${duration}s` }}
      aria-hidden="true"
    >
      {names.map((name, i) => {
        const angle = (360 / names.length) * i;
        return (
          <div
            key={name}
            className="absolute left-1/2 top-1/2 size-0"
            style={{ transform: `rotate(${angle}deg) translateY(-${radius}px)` }}
          >
            {/* Counter-rotation keeps each logo upright while its parent ring turns. */}
            <div
              className={counter}
              style={{
                ["--dur" as string]: `${duration}s`,
                transform: `rotate(-${angle}deg)`,
                marginLeft: -size / 2,
                marginTop: -size / 2,
              }}
            >
              <div
                className="grid place-items-center rounded-2xl border border-neutral-200 bg-white shadow-sm"
                style={{ width: size, height: size }}
              >
                <CloudIcon name={name} className="size-1/2" />
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
      {/* Orbit paths — faint, so the rings read as paths the icons travel rather than as rings drawn
          for their own sake. Dashed: a solid circle reads as a container, a dashed one as a track. */}
      <div className="absolute inset-[22%] rounded-full border border-dashed border-neutral-200" />
      <div className="absolute inset-[2%] rounded-full border border-dashed border-neutral-200/80" />

      <Ring names={INNER} radius={112} duration={38} size={46} />
      <Ring names={OUTER} radius={224} duration={62} size={52} reverse />

      {/* The centre: Atlas itself, spinning like the mark does everywhere else in the product. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="grid size-24 place-items-center rounded-full border border-neutral-200 bg-white shadow-lg">
          <AtlasLogo size={52} spin className="size-[52px]" />
        </div>
      </div>
    </div>
  );
}
