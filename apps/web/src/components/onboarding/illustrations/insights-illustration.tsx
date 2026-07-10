"use client";

/**
 * "Insights & posture" illustration — a Well-Architected posture radar (6 pillars) with a gently
 * breathing amber polygon over faint grid rings, echoing the dashboard's posture radar. The breathing
 * reads as "live, continuously re-scored", the shape as "where you're strong vs weak".
 */

const CX = 150;
const CY = 75;
const R = 52;
const PILLARS = 6;
// Per-pillar posture (0–1) — an illustrative, uneven shape so it reads as a real assessment.
const VALUES = [0.92, 0.6, 0.85, 0.68, 0.8, 0.55];

function pt(i: number, r: number): [number, number] {
  const a = ((-90 + i * (360 / PILLARS)) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
const ring = (r: number): string =>
  Array.from({ length: PILLARS }, (_, i) => pt(i, r).join(",")).join(" ");
const posture = VALUES.map((v, i) => pt(i, R * v).join(",")).join(" ");

export function InsightsIllustration() {
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgb(245 158 11 / 0.10), transparent 60%)",
        }}
      />
      <svg
        viewBox="0 0 300 150"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full"
      >
        {/* Faint concentric grid rings. */}
        {[0.4, 0.7, 1].map((f, i) => (
          <polygon
            key={i}
            points={ring(R * f)}
            fill="none"
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.18}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Axes out to each pillar. */}
        {Array.from({ length: PILLARS }, (_, i) => {
          const [x, y] = pt(i, R);
          return (
            <line
              key={i}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity={0.14}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {/* The posture shape — breathes gently. */}
        <g className="illo-breathe">
          <polygon
            points={posture}
            fill="rgb(245 158 11 / 0.18)"
            stroke="rgb(245 158 11)"
            strokeOpacity={0.9}
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {VALUES.map((v, i) => {
            const [x, y] = pt(i, R * v);
            return <circle key={i} cx={x} cy={y} r={2.4} className="fill-amber-500" />;
          })}
        </g>
      </svg>
    </div>
  );
}
