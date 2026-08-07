import { Check, X } from "lucide-react";
import { CloudIcon } from "@/components/cloud-icon";
import { KIND_LOGO } from "@/lib/kind-visual";

/**
 * The certainty language, in one card.
 *
 * Two earlier passes were wrong in opposite directions: three badge-and-sentence cards (a legend
 * that could have belonged to any product), then three full rows that each redrew the same pair of
 * nodes — which showed the right thing but spent a whole screen repeating its own setup.
 *
 * This states the pair ONCE and varies only what matters: the line between them. Solid, dashed,
 * dotted — the same notation the map draws, so the section teaches the graph's vocabulary rather
 * than describing it. The confirm/reject pair is kept because it's the actual differentiator:
 * plenty of tools have a model guessing at links; the question is whether the guess is presented
 * as a fact.
 */
interface Tier {
  label: string;
  labelClass: string;
  meaning: string;
  dash?: string;
  strokeClass: string;
  pending?: boolean;
}

const TIERS: Tier[] = [
  {
    label: "Observed",
    labelClass: "bg-success/15 text-success",
    meaning: "Read straight from your cloud.",
    strokeClass: "text-neutral-800",
  },
  {
    label: "Inferred",
    labelClass: "bg-neutral-900 text-white",
    meaning: "A matching commit SHA in the deployed image.",
    dash: "5 4",
    strokeClass: "text-neutral-400",
  },
  {
    label: "AI-suggested",
    labelClass: "bg-ai-suggested/15 text-ai-suggested",
    meaning: "A proposal. Not in your graph until you confirm it.",
    dash: "2 4",
    strokeClass: "text-ai-suggested",
    pending: true,
  },
];

function Chip({ name, kind }: { name: string; kind: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 shadow-sm">
      <span className="grid size-5 shrink-0 place-items-center rounded bg-neutral-100">
        <CloudIcon name={KIND_LOGO[kind] as string} className="size-3.5" />
      </span>
      <span className="text-xs font-medium">{name}</span>
    </span>
  );
}

export function CertaintyScale() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      {/* The pair, stated once. Everything below varies only the line between them. */}
      <div className="flex items-center justify-between gap-3">
        <Chip name="checkout-api" kind="bitbucket.repository" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-300">
          deploys to
        </span>
        <Chip name="checkout" kind="aws.ecs.service" />
      </div>

      <div className="mt-6 space-y-4 border-t border-neutral-100 pt-5">
        {TIERS.map((t) => (
          <div key={t.label} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <svg
              viewBox="0 0 60 8"
              className={`h-2 w-14 shrink-0 ${t.strokeClass}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                x1="0"
                y1="4"
                x2="54"
                y2="4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray={t.dash}
                vectorEffect="non-scaling-stroke"
              />
              <path d="M54 1 L60 4 L54 7 z" fill="currentColor" />
            </svg>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${t.labelClass}`}
            >
              {t.label}
            </span>
            <p className="min-w-0 flex-1 text-sm text-neutral-500">{t.meaning}</p>
            {t.pending ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700">
                  <Check className="size-3" /> Confirm
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-400">
                  <X className="size-3" /> Reject
                </span>
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
