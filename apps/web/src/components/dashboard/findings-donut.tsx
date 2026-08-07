"use client";

import { CheckCircle2 } from "lucide-react";
import { Label, Pie, PieChart, Tooltip } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { SEVERITY_COLOR } from "@/lib/severity";

// Severity fills from the shared vivid ramp (red → amber → sky), so this donut matches the severity
// colour used everywhere else (dashboard bars, trend, badges, finding-row dots).
const SEVERITIES = [
  { key: "high", label: "High", color: SEVERITY_COLOR.high },
  { key: "medium", label: "Medium", color: SEVERITY_COLOR.medium },
  { key: "low", label: "Low", color: SEVERITY_COLOR.low },
] as const;

/** Open findings as a donut by severity (High/Medium/Low), total in the centre; hover a wedge to
 *  see the severity and its count. Same look as the Top-contributors donut. */
export function FindingsDonut({ findings }: { findings: Array<{ severity: string }> }) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.severity === "high" || f.severity === "medium" || f.severity === "low") {
      counts[f.severity] += 1;
    }
  }
  const total = findings.length;
  const data = SEVERITIES.map((s) => ({
    name: s.label,
    value: counts[s.key],
    fill: s.color,
  })).filter((d) => d.value > 0);

  return (
    <Card className="shadow-sm">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-muted-foreground">Open findings</p>
        </div>
        {total === 0 ? (
          <p className="mt-3 flex flex-1 items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" /> Nothing needs attention.
          </p>
        ) : (
          <div className="mt-1 flex justify-center">
            <PieChart width={168} height={150}>
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0] as { name?: string; value?: number };
                  return (
                    <div className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-md">
                      <span className="font-medium">{p.name}</span>{" "}
                      <span className="tabular-nums text-muted-foreground">· {p.value}</span>
                    </div>
                  );
                }}
              />
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={2}
                stroke="none"
                animationDuration={700}
              >
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                          {/* dy=0.35em centers on the baseline - cross-browser reliable, unlike
                              dominantBaseline="middle" which Safari renders too high. */}
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            dy="0.35em"
                            className="fill-foreground text-3xl font-semibold"
                          >
                            {total}
                          </tspan>
                        </text>
                      );
                    }
                    return null;
                  }}
                />
              </Pie>
            </PieChart>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
