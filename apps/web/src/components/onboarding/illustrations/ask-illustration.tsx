"use client";

import { AtlasAiMark } from "@/components/brand";
import { UserAvatar } from "@/components/user-avatar";

/**
 * "Ask Atlas" illustration — a realistic chat: a user's question, then Atlas's answer bubble with
 * citation chips and a confidence pill, so it reads as "cited, confidence-tiered answers over your
 * own graph — never a guess". Uses the Atlas AI mark + a generated person avatar.
 */
export function AskIllustration() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2 p-4">
      {/* User question. */}
      <div className="flex items-start justify-end gap-1.5">
        <div className="rounded-lg rounded-tr-sm bg-foreground px-2 py-1.5 text-[9px] leading-snug text-background">
          Why is checkout slow?
        </div>
        <UserAvatar email="jordan@acme.com" name="Jordan Lee" size={18} className="mt-0.5" />
      </div>

      {/* Atlas answer with citations + confidence. */}
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-background ring-1 ring-border">
          <AtlasAiMark size={12} className="size-3" />
        </span>
        <div className="min-w-0 flex-1 rounded-lg rounded-tl-sm border border-border bg-background px-2 py-1.5 shadow-sm">
          <span className="block h-1.5 w-full rounded bg-muted-foreground/20" />
          <span className="mt-1 block h-1.5 w-3/4 rounded bg-muted-foreground/20" />
          <div className="mt-1.5 flex items-center gap-1">
            <span className="rounded bg-violet-500/12 px-1 py-0.5 text-[7px] font-semibold text-violet-600 ring-1 ring-violet-500/25 dark:text-violet-400">
              N1
            </span>
            <span className="rounded bg-violet-500/12 px-1 py-0.5 text-[7px] font-semibold text-violet-600 ring-1 ring-violet-500/25 dark:text-violet-400">
              A2
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[7px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="illo-pulse size-1 rounded-full bg-emerald-500" /> High confidence
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
