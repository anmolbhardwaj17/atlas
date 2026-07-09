export interface TrendPoint {
  t: number;
  high: number;
  medium: number;
  low: number;
}

// Severity hues, matching the shared severityMeta (red / amber / sky).
const SERIES: Array<{ key: "high" | "medium" | "low"; label: string; color: string }> = [
  { key: "high", label: "High", color: "#ef4444" },
  { key: "medium", label: "Medium", color: "#f59e0b" },
  { key: "low", label: "Low", color: "#0ea5e9" },
];

const W = 320;
const H = 150;
const PAD = { t: 10, r: 10, b: 20, l: 18 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Deterministic "Jul 5" (UTC, matching the day buckets) — no locale, so no SSR hydration drift. */
function fmtDay(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Severity trend — how the open High / Medium / Low counts have moved over the window, so you see
 * whether posture is improving or slipping (not just today's totals). Pure SVG (deterministic,
 * matches the dashboard's hand-rolled charts); lines only — the dotted paper backing is drawn by
 * the parent card, not here, so it fills the whole area.
 */
export function SeverityTrend({ data }: { data: TrendPoint[] }) {
  const n = data.length;
  const maxY = Math.max(1, ...data.flatMap((d) => [d.high, d.medium, d.low]));
  const last = data[n - 1];

  if (n < 2 || (last && last.high + last.medium + last.low === 0 && maxY === 1)) {
    return (
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1 text-center">
        <p className="text-xs text-muted-foreground/70">Not enough history to trend yet.</p>
        <p className="text-[11px] text-muted-foreground/50">
          As findings open and clear across syncs, the trend fills in.
        </p>
      </div>
    );
  }

  const x = (i: number) => PAD.l + (n <= 1 ? IW / 2 : (i / (n - 1)) * IW);
  const y = (v: number) => PAD.t + IH - (v / maxY) * IH;
  const line = (key: "high" | "medium" | "low") =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`)
      .join(" ");

  return (
    <div className="flex h-full flex-col justify-center">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Severity trend"
      >
        {SERIES.map((s) => {
          const lastPt = last ? { x: x(n - 1), y: y(last[s.key]) } : null;
          return (
            <g key={s.key} className="chart-fade">
              <path
                d={line(s.key)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {lastPt ? <circle cx={lastPt.x} cy={lastPt.y} r={2.5} fill={s.color} /> : null}
            </g>
          );
        })}
        {/* Date axis — first date … today (right end). */}
        {(n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1])
          .filter((i, idx, a) => a.indexOf(i) === idx)
          .map((i) => {
            const p = data[i];
            if (!p) return null;
            const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
            return (
              <text
                key={i}
                x={x(i)}
                y={H - 5}
                textAnchor={anchor}
                className="fill-muted-foreground text-[9px]"
              >
                {i === n - 1 ? "Today" : fmtDay(p.t)}
              </text>
            );
          })}
      </svg>
      <div className="mt-1 flex items-center justify-center gap-3">
        {SERIES.map((s) => (
          <span
            key={s.key}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
            <span className="font-medium tabular-nums text-foreground">{last?.[s.key] ?? 0}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
