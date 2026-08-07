"use client";

import * as React from "react";
import Link from "next/link";
import { Label, Pie, PieChart, Tooltip } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { plural } from "@/lib/format";

/** Blue palette (a la shadcn's pie demo) for the contributor segments. */
const PALETTE = ["#2684ff", "#4c9aff", "#0052cc", "#79b8ff", "#1d4ed8", "#93c5fd"];

/**
 * Top contributors as a recharts donut ("donut with text"): a wedge per person sized by PR count,
 * total PRs in the centre, and a compact legend beside it. Fixed-size (no ResponsiveContainer,
 * which under-measures inside flex on recharts v3).
 */
export function ContributorsDonut({
  items,
  subtitle,
  href,
}: {
  items: Array<{ name: string; count: number }>;
  subtitle: string;
  href: string;
}) {
  const total = React.useMemo(() => items.reduce((a, it) => a + it.count, 0), [items]);
  const color = (i: number) => PALETTE[i % PALETTE.length] ?? "#2684ff";
  const data = items.map((it, i) => ({ name: it.name, value: it.count, fill: color(i) }));

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-sm font-medium">Top contributors</div>
          <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">
            {subtitle}
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PRs in the last 30 days yet.</p>
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
                      <span className="tabular-nums text-muted-foreground">
                        · {p.value ?? 0} {plural(p.value ?? 0, "PR")}
                      </span>
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
                            className="fill-foreground text-2xl font-semibold"
                          >
                            {total.toLocaleString()}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 20}
                            dy="0.35em"
                            className="fill-muted-foreground text-xs"
                          >
                            PRs
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
