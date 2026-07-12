"use client";

import { useState } from "react";
import {
  Check,
  CircleHelp,
  ExternalLink,
  FileDiff,
  HelpCircle,
  Layers,
  Loader2,
  Target,
} from "lucide-react";
import { AtlasAiMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  reviewIntentCoverage,
  reviewTicketCoverage,
  type CoverageAssessment,
  type CoverageCriterion,
} from "@/lib/browser-api";
import { cn } from "@/lib/cn";

/**
 * Intent coverage (IV-3, docs/plans/intent-verification.md) — on a pull-request node. Answers
 * "did this PR implement the intent of its linked Jira ticket?" as hedged, cited reviewer
 * QUESTIONS per acceptance criterion — never a code-quality verdict (SIFT owns code review). It's
 * model-backed + spends budget, so it's button-triggered, not run on load. Honest states
 * (no linked issue / no diff) are first-class, not errors.
 */

const STATUS: Record<
  CoverageCriterion["status"],
  { label: string; text: string; Icon: typeof Check }
> = {
  implemented: { label: "Addressed", text: "text-success", Icon: Check },
  "possibly-missing": { label: "Worth a look", text: "text-warning", Icon: HelpCircle },
  "cannot-tell": { label: "Can't tell", text: "text-muted-foreground", Icon: CircleHelp },
};

const SOURCE_LABEL: Record<CoverageCriterion["source"], string> = {
  description: "acceptance criterion",
  subtask: "subtask",
  comment: "comment",
};

function CriterionRow({ c }: { c: CoverageCriterion }) {
  const s = STATUS[c.status];
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={cn("mt-1 grid size-5 shrink-0 place-items-center rounded-full", `${s.text}`)}
      >
        <s.Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {c.id} · {SOURCE_LABEL[c.source]}
          </span>
          <span className={cn("text-[11px] font-medium", s.text)}>{s.label}</span>
        </div>
        <p className="mt-0.5 text-sm font-medium text-foreground">{c.text}</p>
        {c.note ? <p className="mt-0.5 text-sm text-muted-foreground">{c.note}</p> : null}
        {c.citations.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {c.citations.map((cite) => {
              const isDiff = cite.kind === "diff-hunk";
              const inner = (
                <>
                  {isDiff ? <FileDiff className="size-3" /> : <Target className="size-3" />}
                  <span className="truncate">{cite.ref}</span>
                </>
              );
              const className =
                "inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground";
              return cite.url ? (
                <a
                  key={cite.marker + cite.ref}
                  href={cite.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(className, "transition-colors hover:text-foreground")}
                  title={`${cite.marker} — open source`}
                >
                  {inner}
                </a>
              ) : (
                <span key={cite.marker + cite.ref} className={className} title={cite.marker}>
                  {inner}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Assessment({
  a,
  onReviewTicket,
}: {
  a: CoverageAssessment;
  onReviewTicket?: (issueId: string) => void;
}) {
  if (a.status === "no-intent") {
    return (
      <p className="px-4 py-4 text-sm text-muted-foreground">
        No linked Jira issue, so there's no stated intent to check this against. Reference a ticket
        key in the PR (or connect Jira) to enable a coverage review.
      </p>
    );
  }
  if (a.status === "no-diff") {
    return (
      <div className="px-4 py-4 text-sm text-muted-foreground">
        {a.issue ? <IssueChip issue={a.issue} /> : null}
        <p className="mt-2">
          The diff for this PR isn't available right now, so its coverage couldn't be checked.
        </p>
      </div>
    );
  }
  const counts = {
    implemented: a.criteria.filter((c) => c.status === "implemented").length,
    missing: a.criteria.filter((c) => c.status === "possibly-missing").length,
  };
  // A Story is delivered across many PRs — offer a ticket-level review when this PR isn't the whole
  // story. Bind `issue` to a const so its non-null narrowing survives into the click handler closure.
  const issue = a.issue;
  const offerTicket = a.mode === "pr" && (a.ticketPrCount ?? 0) > 1 && !!issue && !!onReviewTicket;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-3">
        {a.issue ? <IssueChip issue={a.issue} /> : null}
        {a.mode === "ticket" ? (
          <span className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <Layers className="size-3" />
            Ticket-level · {a.prs.length} PR{a.prs.length === 1 ? "" : "s"}
          </span>
        ) : null}
        <span className="text-xs tabular-nums text-muted-foreground">
          {counts.implemented}/{a.criteria.length} addressed
          {counts.missing > 0 ? ` · ${counts.missing} to check` : ""}
        </span>
      </div>
      {a.summary ? <p className="px-4 pb-3 text-sm text-muted-foreground">{a.summary}</p> : null}
      {offerTicket && issue ? (
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2">
          <Layers className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            This ticket is built across{" "}
            <strong className="text-foreground">{a.ticketPrCount} PRs</strong> — this review covers
            only this one, so gaps may be handled in a sibling PR.
          </span>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => onReviewTicket?.(issue.id)}
          >
            <Layers className="size-3.5" /> Review the whole ticket
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-border border-y border-border">
        {a.criteria.map((c) => (
          <CriterionRow key={c.id} c={c} />
        ))}
      </ul>
      {a.caveats.length > 0 ? (
        <ul className="space-y-1 px-4 pt-3">
          {a.caveats.map((cav) => (
            <li key={cav} className="text-xs text-muted-foreground">
              · {cav}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">{a.reviewNote}</p>
    </div>
  );
}

function IssueChip({ issue }: { issue: NonNullable<CoverageAssessment["issue"]> }) {
  const inner = (
    <>
      <span className="font-mono font-medium text-foreground">{issue.key}</span>
      <span className="truncate text-muted-foreground">{issue.summary}</span>
      {issue.url ? <ExternalLink className="size-3 shrink-0 text-muted-foreground" /> : null}
    </>
  );
  const className =
    "inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs";
  return issue.url ? (
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      className={cn(className, "transition-colors hover:border-foreground/40")}
    >
      {inner}
    </a>
  ) : (
    <span className={className}>{inner}</span>
  );
}

export function IntentCoverage({ orgId, prId }: { orgId: string; prId: string }) {
  const [state, setState] = useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "done"; a: CoverageAssessment }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  const review = (fn: () => Promise<CoverageAssessment>): void => {
    setState({ phase: "loading" });
    void fn()
      .then((a) => setState({ phase: "done", a }))
      .catch((e: unknown) =>
        setState({
          phase: "error",
          message: e instanceof Error ? e.message : "Something went wrong.",
        }),
      );
  };
  const run = (): void => review(() => reviewIntentCoverage(orgId, prId));
  const runTicket = (issueId: string): void => review(() => reviewTicketCoverage(orgId, issueId));

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <AtlasAiMark size={16} className="size-4" />
        <span className="text-sm font-semibold">Intent coverage</span>
        <span className="text-xs text-muted-foreground">
          Did this PR build what its ticket asked?
        </span>
        {state.phase !== "idle" && state.phase !== "loading" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={run}
            className="ml-auto h-7 text-xs text-muted-foreground"
          >
            Re-review
          </Button>
        ) : null}
      </div>

      {state.phase === "idle" ? (
        <div className="px-4 py-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Atlas reads the linked Jira ticket (its acceptance criteria, subtasks, and comments) and
            checks the diff against each — as questions for you to confirm, not a code review.
          </p>
          <Button size="sm" onClick={run} className="gap-1.5">
            <AtlasAiMark size={14} className="size-3.5" />
            Review intent coverage
          </Button>
        </div>
      ) : null}

      {state.phase === "loading" ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Reading the ticket and reviewing the diff…
        </p>
      ) : null}

      {state.phase === "error" ? (
        <p className="px-4 py-4 text-sm text-danger">{state.message}</p>
      ) : null}

      {state.phase === "done" ? <Assessment a={state.a} onReviewTicket={runTicket} /> : null}
    </div>
  );
}
