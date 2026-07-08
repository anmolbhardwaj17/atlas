export interface Posture {
  security: number;
  reliability: number;
  cost: number;
  performance: number;
  hygiene: number;
  operations: number;
}

const AXES: Array<{ key: keyof Posture; label: string }> = [
  { key: "security", label: "Security" },
  { key: "reliability", label: "Reliability" },
  { key: "cost", label: "Cost" },
  { key: "performance", label: "Performance" },
  { key: "hygiene", label: "Hygiene" },
  { key: "operations", label: "Operations" },
];

const CX = 130;
const CY = 118;
const R = 82;
const N = AXES.length;

function coord(i: number, frac: number): { x: number; y: number } {
  const a = ((-90 + (360 / N) * i) * Math.PI) / 180;
  return { x: CX + R * frac * Math.cos(a), y: CY + R * frac * Math.sin(a) };
}

function polygon(frac: number): string {
  return AXES.map((_, i) => {
    const p = coord(i, frac);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");
}

/**
 * Posture radar — the estate's health across the six Well-Architected pillars, each 0-100 from its
 * findings (weighted by severity). Shows *where* the estate is weak, not just the overall score.
 * Pure SVG (deterministic, server-rendered); brand-green fill for the one identity accent.
 */
export function PostureRadar({ posture }: { posture: Posture }) {
  const dataPoints = AXES.map((ax, i) =>
    coord(i, Math.max(0, Math.min(100, posture[ax.key])) / 100),
  );
  const dataPolygon = dataPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox="0 0 260 210"
      className="h-auto w-full max-w-[320px]"
      role="img"
      aria-label="Posture by pillar"
    >
      {/* Grid rings. */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={polygon(f)} className="fill-none stroke-border" strokeWidth={1} />
      ))}
      {/* Spokes. */}
      {AXES.map((_, i) => {
        const p = coord(i, 1);
        return (
          <line
            key={i}
            x1={CX}
            y1={CY}
            x2={p.x}
            y2={p.y}
            className="stroke-border"
            strokeWidth={1}
          />
        );
      })}
      {/* Data polygon (brand accent). */}
      <polygon
        points={dataPolygon}
        className="fill-brand/20 stroke-brand"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} className="fill-brand" />
      ))}
      {/* Axis labels + scores. */}
      {AXES.map((ax, i) => {
        const p = coord(i, 1.2);
        const a = ((-90 + (360 / N) * i) * Math.PI) / 180;
        const cos = Math.cos(a);
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        return (
          <text
            key={ax.key}
            x={p.x}
            y={p.y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px]"
          >
            <tspan className="font-medium">{ax.label}</tspan>
            <tspan className="fill-foreground font-semibold"> {Math.round(posture[ax.key])}</tspan>
          </text>
        );
      })}
    </svg>
  );
}
