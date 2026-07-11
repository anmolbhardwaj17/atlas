"use client";

import * as React from "react";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  CircleHelp,
  MinusCircle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type Framework = "pci" | "nist" | "iso" | "hipaa" | "cis" | "gdpr";
export type ControlStatus = "pass" | "fail" | "not-applicable" | "not-assessable";

export interface FrameworkMeta {
  key: Framework;
  label: string;
  full: string;
  scopeNote: string;
}
export interface Control {
  id: string;
  title: string;
  requirement: string;
  domain: string;
  mappings: Partial<Record<Framework, string[]>>;
  findingId?: string;
}
export interface ControlResult {
  control: Control;
  status: ControlStatus;
  detail: string;
  count: number;
  evidence: Array<{ id: string; label: string }>;
}
export interface FrameworkSummary {
  framework: FrameworkMeta;
  results: ControlResult[];
  passed: number;
  failed: number;
  notAssessable: number;
  notApplicable: number;
  assessed: number;
  passRate: number | null;
}
export interface ComplianceReport {
  frameworks: FrameworkSummary[];
  controls: ControlResult[];
  lastSyncAt: string | null;
}

const STATUS_META: Record<
  ControlStatus,
  { label: string; icon: typeof ShieldCheck; badge: string; dot: string; order: number }
> = {
  fail: {
    label: "Fail",
    icon: ShieldAlert,
    badge: "bg-danger/10 text-danger ring-danger/20",
    dot: "bg-danger",
    order: 0,
  },
  pass: {
    label: "Pass",
    icon: CheckCircle2,
    badge: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
    dot: "bg-emerald-500",
    order: 1,
  },
  "not-assessable": {
    label: "Not assessable",
    icon: CircleHelp,
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
    dot: "bg-amber-500",
    order: 2,
  },
  "not-applicable": {
    label: "N/A",
    icon: MinusCircle,
    badge: "bg-muted text-muted-foreground ring-border",
    dot: "bg-muted-foreground/40",
    order: 3,
  },
};

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

/**
 * Compliance controls — Atlas maps its technical evidence onto the infrastructure-observable subset
 * of each framework. Deliberately HONEST: pass/fail only where we have evidence, `not assessable`
 * where Atlas doesn't yet crawl the data (never a silent pass), and a scope caveat so we never imply
 * full certification. Pick a framework to see its controls + coverage.
 */
export function ComplianceView({ report }: { report: ComplianceReport | null }) {
  const frameworks = report?.frameworks ?? [];
  const [active, setActive] = React.useState<Framework>(frameworks[0]?.framework.key ?? "pci");
  const current = frameworks.find((f) => f.framework.key === active) ?? frameworks[0] ?? null;

  const rows = React.useMemo(() => {
    if (!current) return [];
    return [...current.results].sort(
      (a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order,
    );
  }, [current]);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Continuous checks against the <strong>infrastructure-observable</strong> controls of each
          framework, derived from the same cited evidence as your findings. One check often
          satisfies many frameworks at once.
        </p>
      </div>

      {/* Framework selector */}
      <div className="flex flex-wrap gap-1.5">
        {frameworks.map((f) => {
          const on = f.framework.key === active;
          return (
            <button
              key={f.framework.key}
              type="button"
              onClick={() => setActive(f.framework.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                on
                  ? "border-transparent bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              {f.framework.label}
              {f.failed > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1 text-[10px] tabular-nums",
                    on ? "bg-background/20" : "bg-danger/15 text-danger",
                  )}
                >
                  {f.failed}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {current ? (
        <>
          {/* Coverage band */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{current.framework.full}</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Atlas assesses <strong>{current.assessed}</strong> of {current.results.length}{" "}
                  mapped controls ·{" "}
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {current.passed} pass
                  </span>{" "}
                  ·{" "}
                  <span className={current.failed > 0 ? "text-danger" : "text-muted-foreground"}>
                    {current.failed} fail
                  </span>
                  {current.notAssessable > 0 ? ` · ${current.notAssessable} not assessable` : ""}
                  {current.notApplicable > 0 ? ` · ${current.notApplicable} N/A` : ""}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold tabular-nums">{pct(current.passRate)}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  assessed pass rate
                </div>
              </div>
            </div>
            {/* pass/fail/unknown bar */}
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted">
              <Bar n={current.passed} total={current.results.length} className="bg-emerald-500" />
              <Bar n={current.failed} total={current.results.length} className="bg-danger" />
              <Bar
                n={current.notAssessable}
                total={current.results.length}
                className="bg-amber-500/60"
              />
            </div>
            {/* the honest scope caveat */}
            <p className="mt-4 flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <CircleHelp className="mt-px size-3.5 shrink-0 text-amber-500" />
              <span>
                <strong className="text-foreground">Scope:</strong> {current.framework.scopeNote}{" "}
                Atlas is technical evidence, not a certification — pair it with your organizational
                controls.
              </span>
            </p>
          </div>

          {/* Controls */}
          <ul className="space-y-2">
            {rows.map((r) => (
              <ControlRow key={r.control.id} r={r} framework={active} />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No compliance data yet — connect a cloud source.
        </p>
      )}
    </div>
  );
}

function Bar({ n, total, className }: { n: number; total: number; className: string }) {
  if (n === 0 || total === 0) return null;
  return <div className={className} style={{ width: `${(n / total) * 100}%` }} />;
}

function ControlRow({ r, framework }: { r: ControlResult; framework: Framework }) {
  const meta = STATUS_META[r.status];
  const Icon = meta.icon;
  const ids = r.control.mappings[framework] ?? [];
  const fixable = r.status === "fail" && r.control.findingId;
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            r.status === "fail"
              ? "text-danger"
              : r.status === "pass"
                ? "text-emerald-500"
                : r.status === "not-assessable"
                  ? "text-amber-500"
                  : "text-muted-foreground/50",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{r.control.title}</span>
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset",
                meta.badge,
              )}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {r.control.requirement}
          </p>
          {/* detail line for fails / not-assessable */}
          {r.status === "fail" || r.status === "not-assessable" ? (
            <p
              className={cn(
                "mt-2 text-xs",
                r.status === "fail" ? "text-danger" : "text-muted-foreground",
              )}
            >
              {r.detail}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ids.length > 0 ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {framework.toUpperCase()} {ids.join(", ")}
              </span>
            ) : null}
            {fixable ? (
              <Link
                href={`/insights/${r.control.findingId}`}
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-foreground/80 hover:text-foreground"
              >
                View evidence <ArrowRight className="size-3" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
