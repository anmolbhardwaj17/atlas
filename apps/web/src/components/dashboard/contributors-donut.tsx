"use client";

import * as React from "react";
import Link from "next/link";
import { Label, Pie, PieChart } from "recharts";
import { Card, CardContent } from "@/components/ui/card";

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
          <div className="flex items-center gap-4">
            <PieChart width={140} height={140} className="shrink-0">
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={42}
                outerRadius={64}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            className="fill-foreground text-2xl font-semibold"
                          >
                            {total.toLocaleString()}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 20}
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
            <ul className="min-w-0 flex-1 space-y-2">
              {items.map((it, i) => (
                <li key={it.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{it.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
