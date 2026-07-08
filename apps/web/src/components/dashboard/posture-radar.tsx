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

// Square-ish viewBox with generous margin so the axis labels never clip.
const CX = 160;
const CY = 150;
const R = 76;
const N = AXES.length;

function angle(i: number): number {
  return ((-90 + (360 / N) * i) * Math.PI) / 180;
}
function coord(i: number, frac: number): { x: number; y: number } {
  const a = angle(i);
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
      viewBox="0 0 320 300"
      className="mx-auto block h-auto w-full max-w-[340px]"
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
      {/* Axis labels — name over score, stacked so long names never clip. */}
      {AXES.map((ax, i) => {
        const p = coord(i, 1.12);
        const cos = Math.cos(angle(i));
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        return (
          <text key={ax.key} textAnchor={anchor} className="text-[10px]">
            <tspan x={p.x} y={p.y} className="fill-muted-foreground">
              {ax.label}
            </tspan>
            <tspan x={p.x} y={p.y} dy="11" className="fill-foreground font-semibold">
              {Math.round(posture[ax.key])}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
