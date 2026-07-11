"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Info, ChevronRight, Check, CircleHelp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
export type ControlSeverity = "high" | "medium" | "low";
export interface ControlResult {
  control: Control;
  status: ControlStatus;
  severity: ControlSeverity;
  detail: string;
  count: number;
  evidence: Array<{ id: string; label: string }>;
}
export interface FrameworkSummary {
  framework: FrameworkMeta;
  results: ControlResult[];
  passed: number;
  failed: number;
  highFails: number;
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

/** Status → semantic token + label + sort order. Uses the app's design tokens (success/danger/
 *  warning/muted), never raw palette colors, so it reads as one system with Insights. */
const STATUS: Record<
  ControlStatus,
  { label: string; dot: string; text: string; bar: string; order: number }
> = {
  fail: { label: "Fail", dot: "bg-danger", text: "text-danger", bar: "bg-danger", order: 0 },
  pass: { label: "Pass", dot: "bg-success", text: "text-success", bar: "bg-success", order: 1 },
  "not-assessable": {
    label: "Not assessable",
    dot: "bg-warning",
    text: "text-warning",
    bar: "bg-warning/70",
    order: 2,
  },
  "not-applicable": {
    label: "N/A",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    bar: "bg-muted",
    order: 3,
  },
};

const SEV_ORDER: Record<ControlSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Severity chip styling — the dashboard donut's warm heat-ramp (red → orange → yellow), via explicit
 *  palette colours so the ring resolves (a semantic `ring-danger/x` silently falls back to blue). */
const SEV_STYLE: Record<ControlSeverity, string> = {
  high: "bg-red-500/10 text-red-600 ring-red-500/25 dark:text-red-400",
  medium: "bg-orange-500/10 text-orange-600 ring-orange-500/25 dark:text-orange-400",
  low: "bg-yellow-500/10 text-yellow-700 ring-yellow-500/25 dark:text-yellow-400",
};

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Compliance controls — Atlas maps its technical evidence onto the infrastructure-observable subset
 * of each framework. Deliberately HONEST: pass/fail only where we have evidence, `not assessable`
 * where Atlas doesn't yet crawl the data (never a silent pass), and a scope caveat so we never imply
 * certification. Mirrors the Insights layout (segmented filter + Card-wrapped table).
 */
export function ComplianceView({ report }: { report: ComplianceReport | null }) {
  const router = useRouter();
  const frameworks = report?.frameworks ?? [];
  const [active, setActive] = React.useState<Framework>(frameworks[0]?.framework.key ?? "pci");
  const current = frameworks.find((f) => f.framework.key === active) ?? frameworks[0] ?? null;

  // Split the actionable/graded controls (fail → pass → N/A, fails ranked by severity) from the
  // not-assessable ones. The not-assessable set isn't the user's action list (it's Atlas's crawl
  // gaps), so it renders quietly below instead of diluting what actually needs fixing.
  const { graded, notAssessable } = React.useMemo(() => {
    if (!current) return { graded: [] as ControlResult[], notAssessable: [] as ControlResult[] };
    const sorted = [...current.results].sort(
      (a, b) =>
        STATUS[a.status].order - STATUS[b.status].order ||
        SEV_ORDER[a.severity] - SEV_ORDER[b.severity],
    );
    return {
      graded: sorted.filter((r) => r.status !== "not-assessable"),
      notAssessable: sorted.filter((r) => r.status === "not-assessable"),
    };
  }, [current]);

  return (
    <div className="w-full space-y-6">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
          {report?.lastSyncAt ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Reflects your sync from {timeAgo(report.lastSyncAt)}
            </span>
          ) : null}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Continuous checks against the{" "}
          <strong className="font-medium text-foreground">infrastructure-observable</strong>{" "}
          controls of each framework, from the same cited evidence as your findings. One check often
          satisfies many frameworks at once.
        </p>
      </header>

      {/* Framework selector — the app's segmented control (matches the Insights pillar filter). */}
      <div className="inline-flex max-w-full flex-wrap gap-1 overflow-x-auto rounded-lg border border-border bg-muted p-1">
        {frameworks.map((f) => {
          const on = f.framework.key === active;
          return (
            <button
              key={f.framework.key}
              type="button"
              onClick={() => setActive(f.framework.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                on
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.framework.label}
              {f.failed > 0 ? (
                <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-danger/10 px-1 text-[10px] font-semibold tabular-nums text-danger">
                  {f.failed}
                </span>
              ) : f.assessed > 0 ? (
                <Check className="size-3 text-success" />
              ) : null}
            </button>
          );
        })}
      </div>

      {current ? (
        <>
          {/* Coverage band */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold">{current.framework.full}</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Atlas assesses{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {current.assessed}
                    </span>{" "}
                    of <span className="tabular-nums">{current.results.length}</span> mapped
                    controls
                  </p>
                </div>
                {/* Lead with what needs attention, not a raw pass-rate (which reads alarming when
                    it's dominated by low-severity + not-assessable). */}
                <div className="text-right">
                  {current.failed > 0 ? (
                    <>
                      <div className="text-3xl font-semibold tabular-nums text-danger">
                        {current.failed}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {current.highFails > 0
                          ? `need attention · ${current.highFails} high`
                          : "need attention"}
                      </div>
                    </>
                  ) : current.assessed > 0 ? (
                    <>
                      <div className="text-3xl font-semibold tabular-nums text-success">
                        All&nbsp;clear
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {current.assessed} assessed · {pct(current.passRate)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-3xl font-semibold tabular-nums text-muted-foreground">
                        —
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        nothing assessable yet
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* coverage bar */}
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                <Seg n={current.passed} total={current.results.length} className="bg-success" />
                <Seg n={current.failed} total={current.results.length} className="bg-danger" />
                <Seg
                  n={current.notAssessable}
                  total={current.results.length}
                  className="bg-warning/60"
                />
              </div>

              {/* legend */}
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                <Legend dot="bg-success" label="Pass" n={current.passed} />
                <Legend dot="bg-danger" label="Fail" n={current.failed} />
                <Legend dot="bg-warning" label="Not assessable" n={current.notAssessable} />
                <Legend dot="bg-muted-foreground/40" label="N/A" n={current.notApplicable} />
              </div>

              {/* the honest scope caveat */}
              <p className="flex gap-2 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0 text-muted-foreground/70" />
                <span>
                  <strong className="font-medium text-foreground">Scope:</strong>{" "}
                  {current.framework.scopeNote} Atlas is technical evidence, not a certification —
                  pair it with your organizational controls.
                </span>
              </p>
            </CardContent>
          </Card>

          {/* Controls table — dense + columnar, matching Insights. */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="w-28 px-4 py-2.5 font-medium">Status</th>
                    <th className="w-24 px-4 py-2.5 font-medium">Severity</th>
                    <th className="px-4 py-2.5 font-medium">Control</th>
                    <th className="hidden px-4 py-2.5 font-medium lg:table-cell">
                      {current.framework.label} controls
                    </th>
                    <th className="w-10 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {graded.map((r) => (
                    <ControlRow
                      key={r.control.id}
                      r={r}
                      framework={active}
                      onOpen={
                        r.status === "fail" && r.control.findingId
                          ? () => router.push(`/insights/${r.control.findingId}`)
                          : undefined
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Not assessable — Atlas's crawl gaps, not the user's action items. Kept quiet + separate
              (a collapsible) so it never dilutes the controls that actually need fixing. */}
          {notAssessable.length > 0 ? (
            <NotAssessable rows={notAssessable} framework={active} />
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="py-14 text-center">
            <ShieldCheck className="mx-auto mb-3 size-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No compliance data yet — connect a cloud source to start assessing controls.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Not-assessable controls — Atlas's crawl gaps, shown quietly in a collapsible so they never
 *  compete with the actionable controls. Doubles as an honest "here's what we can't see yet" list. */
function NotAssessable({ rows, framework }: { rows: ControlResult[]; framework: Framework }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <CircleHelp className="size-4 shrink-0 text-warning" />
        <span className="text-sm font-medium">Not assessable by Atlas</span>
        <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {rows.length}
        </span>
        <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
          controls that need data Atlas doesn&apos;t crawl yet — not a pass or a fail
        </span>
        <ChevronRight
          className={cn(
            "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => {
            const ids = r.control.mappings[framework] ?? [];
            return (
              <li key={r.control.id} className="px-4 py-3">
                <div className="text-sm font-medium text-foreground">{r.control.title}</div>
                <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                  {r.detail}
                </p>
                {ids.length > 0 ? (
                  <span className="mt-2 inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {framework.toUpperCase()} {ids.join(", ")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

function Seg({ n, total, className }: { n: number; total: number; className: string }) {
  if (n <= 0 || total <= 0) return null;
  return <div className={className} style={{ width: `${(n / total) * 100}%` }} />;
}

function Legend({ dot, label, n }: { dot: string; label: string; n: number }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", n === 0 && "opacity-45")}
      title={`${n} ${label}`}
    >
      <span className={cn("size-2 rounded-full", dot)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{n}</span>
    </span>
  );
}

function ControlRow({
  r,
  framework,
  onOpen,
}: {
  r: ControlResult;
  framework: Framework;
  onOpen?: (() => void) | undefined;
}) {
  const s = STATUS[r.status];
  const ids = r.control.mappings[framework] ?? [];
  return (
    <tr
      onClick={onOpen}
      className={cn("align-top transition-colors", onOpen && "cursor-pointer hover:bg-muted/40")}
    >
      <td className="px-4 py-3.5">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 shrink-0 rounded-full", s.dot)} />
          <span className={cn("text-xs font-medium", s.text)}>{s.label}</span>
        </span>
      </td>
      <td className="px-4 py-3.5">
        {/* Severity is the control's inherent weight (donut heat-ramp), shown regardless of status —
            a green Pass next to a red HIGH reads as "we check this important thing and you're fine". */}
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset",
            SEV_STYLE[r.severity],
          )}
        >
          {r.severity}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <div className="font-medium text-foreground">{r.control.title}</div>
        <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
          {r.control.requirement}
        </p>
        {/* Affected resources as chips (not a red run-on sentence). Falls back to the detail line
            for findings that don't name specific resources. */}
        {r.status === "fail" ? (
          r.evidence.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {r.evidence.slice(0, 8).map((e) => (
                <span
                  key={e.id}
                  className="inline-flex items-center rounded-md border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400"
                >
                  {e.label}
                </span>
              ))}
              {r.evidence.length > 8 ? (
                <span className="text-[11px] text-muted-foreground">
                  +{r.evidence.length - 8} more
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-danger">{r.detail}</p>
          )
        ) : null}
        {/* framework refs inline on small screens (the dedicated column is lg+) */}
        {ids.length > 0 ? (
          <span className="mt-2 inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:hidden">
            {framework.toUpperCase()} {ids.join(", ")}
          </span>
        ) : null}
      </td>
      <td className="hidden px-4 py-3.5 align-top lg:table-cell">
        {ids.length > 0 ? (
          <span className="inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {ids.join(", ")}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="px-2 py-3.5">
        {onOpen ? (
          <span className="flex items-center justify-end">
            <Link
              href={`/insights/${r.control.findingId}`}
              onClick={(e) => e.stopPropagation()}
              title="View the finding's evidence"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </Link>
          </span>
        ) : null}
      </td>
    </tr>
  );
}
