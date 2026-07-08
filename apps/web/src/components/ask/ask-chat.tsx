"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Send, Check, Square } from "lucide-react";
import dynamic from "next/dynamic";
import { AtlasAiMark } from "@/components/brand";

// LiquidMetal is a WebGL shader - client-only (no SSR), lazy-loaded so it never blocks paint.
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false },
);
import { createConversation, getConversation, streamAskWS, type AskEvent } from "@/lib/browser-api";

interface Citation {
  number: number;
  marker: string;
  kind: "node" | "edge" | "computed";
  id: string;
  confidence: string | null;
}
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  confidence: string | null;
  caveats: string[];
  streaming: boolean;
  /** Waiting phase before tokens arrive, for a smooth loading state. */
  phase: "searching" | "thinking" | "answering";
  /** Live "show your work" trace of the agentic retrieval loop's tool calls. */
  steps: string[];
  /** True for a live-streamed turn (→ typewriter); false for a reopened/persisted turn (instant). */
  live: boolean;
  error: string | null;
}

/** Deep-link a citation to its evidence, by kind. */
function citationHref(c: Citation): string {
  if (c.kind === "computed") return "/dashboard";
  if (c.kind === "edge") return `/explore/edge/${c.id}`;
  return `/explore/${c.id}`;
}

/** Friendly label for a retrieval tool (the agentic loop's "show your work" trace). */
function toolLabel(tool: string): string {
  switch (tool) {
    case "search":
      return "Searched the graph";
    case "get_node":
      return "Read a node";
    case "get_neighbors":
      return "Read relationships";
    case "traverse":
      return "Traced impact";
    case "timeline":
      return "Checked recent changes";
    case "estate_overview":
      return "Read estate overview";
    default:
      return `Ran ${tool}`;
  }
}

// Fallback when we can't derive data-aware suggestions (e.g. nothing connected yet).
const FALLBACK_EXAMPLES = [
  "What do I have connected?",
  "Who are the top contributors this month?",
  "What changed recently?",
];

/**
 * Ask AI (docs/09 §5.5, docs/10). Retrieval-first, streamed. Every answer is cited and
 * confidence-tiered; a zero-grounding answer renders as an explicit "I don't know"
 * (US-11) - one of the four designed states (empty · streaming · answered · honest-absence).
 */
export function AskChat({
  orgId,
  initialQuestion,
  suggestions = [],
  conversationId,
  onCreated,
}: {
  orgId: string;
  initialQuestion?: string | undefined;
  suggestions?: string[];
  /** When set, reopen this past conversation (load its messages). */
  conversationId?: string | undefined;
  /** Fired when a NEW conversation is created (so the sidebar can add + select it). */
  onCreated?: ((id: string, title: string) => void) | undefined;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // True while a reopened conversation's turns are being fetched (show a skeleton, not the
  // empty state) - fixes the "click a chat → blank flash → answer pops in" jank.
  const [loadingConversation, setLoadingConversation] = useState<boolean>(!!conversationId);
  const convoRef = useRef<string | null>(conversationId ?? null);
  const autoAsked = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => abortRef.current?.abort();

  // Reopen a past conversation: load its persisted turns.
  useEffect(() => {
    if (!conversationId) {
      setLoadingConversation(false);
      return;
    }
    let live = true;
    setLoadingConversation(true);
    void getConversation(orgId, conversationId)
      .then((c) => {
        if (!live || !c) return;
        setMessages(
          c.messages.map((m): ChatMessage => ({
            role: m.role === "assistant" ? "assistant" : "user",
            text: m.content,
            citations: m.citations ?? [],
            confidence: m.confidence,
            caveats: [],
            streaming: false,
            phase: "answering",
            steps: [],
            live: false,
            error: null,
          })),
        );
      })
      .finally(() => {
        if (live) setLoadingConversation(false);
      });
    return () => {
      live = false;
    };
  }, [orgId, conversationId]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput("");
    setMessages((m) => [
      ...m,
      {
        role: "user",
        text: q,
        citations: [],
        confidence: null,
        caveats: [],
        streaming: false,
        phase: "answering",
        steps: [],
        live: false,
        error: null,
      },
      {
        role: "assistant",
        text: "",
        citations: [],
        confidence: null,
        caveats: [],
        streaming: true,
        phase: "searching",
        steps: [],
        live: true,
        error: null,
      },
    ]);

    const patchLast = (fn: (msg: ChatMessage) => ChatMessage) =>
      setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? fn(msg) : msg)));

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const isNew = !convoRef.current;
      if (isNew) {
        convoRef.current = await createConversation(orgId, q);
        if (convoRef.current) onCreated?.(convoRef.current, q);
      }
      if (!convoRef.current) {
        patchLast((msg) => ({ ...msg, streaming: false, error: "Couldn’t start a conversation." }));
        return;
      }
      for await (const ev of streamAskWS(orgId, convoRef.current, q, ac.signal)) {
        applyEvent(ev, patchLast);
      }
      patchLast((msg) => ({ ...msg, streaming: false }));
    } catch {
      // A user-initiated stop ends the stream cleanly; only a real failure is an error.
      patchLast((msg) => ({
        ...msg,
        streaming: false,
        error: ac.signal.aborted ? null : "The stream was interrupted.",
      }));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  // Prefilled question (e.g. arriving from the dashboard "Ask Atlas" hero) - ask once.
  useEffect(() => {
    if (!autoAsked.current && initialQuestion && initialQuestion.trim()) {
      autoAsked.current = true;
      void ask(initialQuestion);
    }
  }, [initialQuestion, ask]);

  // The current conversation's title = its first question (how createConversation titles it).
  const title = messages.find((m) => m.role === "user")?.text;

  return (
    // Fill the workspace column so the input pins to the bottom.
    <div className="flex h-full min-h-[420px] flex-col">
      {loadingConversation ? (
        <div className="mb-3 flex h-11 shrink-0 items-center border-b border-border">
          <div className="h-4 w-56 max-w-[60%] animate-pulse rounded bg-muted" />
        </div>
      ) : title ? (
        // Fixed h-11 + border-b so the title's separator lines up with the sidebar header's.
        <div className="mb-3 flex h-11 shrink-0 items-center border-b border-border">
          <h2 className="truncate text-sm font-semibold text-foreground" title={title}>
            {title}
          </h2>
        </div>
      ) : null}
      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {loadingConversation ? (
          <ConversationSkeleton />
        ) : messages.length === 0 ? (
          <EmptyState onPick={(q) => void ask(q)} suggestions={suggestions} />
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <UserBubble key={i} text={m.text} />
            ) : (
              <AssistantBubble key={i} message={m} />
            ),
          )
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="mt-4 flex shrink-0 items-center gap-2 bg-background pt-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your infrastructure…"
          aria-label="Ask a question"
          disabled={busy || loadingConversation}
          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop generating"
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/60"
          >
            <Square size={13} className="fill-current" /> Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={input.trim().length === 0}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Send size={15} /> Ask
          </button>
        )}
      </form>
    </div>
  );
}

function applyEvent(ev: AskEvent, patch: (fn: (m: ChatMessage) => ChatMessage) => void) {
  switch (ev.type) {
    case "retrieval_step": {
      const label = toolLabel(ev.tool);
      patch((m) => ({
        ...m,
        phase: "searching",
        // de-dupe consecutive identical labels so the trace reads cleanly
        steps: m.steps[m.steps.length - 1] === label ? m.steps : [...m.steps, label],
      }));
      break;
    }
    case "retrieval":
      patch((m) => ({ ...m, phase: "thinking" }));
      break;
    case "token":
      patch((m) => ({ ...m, text: m.text + ev.text, phase: "answering" }));
      break;
    case "citation":
      patch((m) => ({
        ...m,
        citations: [
          ...m.citations,
          {
            number: ev.citation.number,
            marker: ev.citation.marker,
            kind: ev.citation.kind,
            id: ev.citation.id,
            confidence: ev.citation.confidence,
          },
        ],
      }));
      break;
    case "confidence":
      patch((m) => ({ ...m, confidence: ev.overall, caveats: ev.caveats }));
      break;
    case "error":
      patch((m) => ({ ...m, streaming: false, error: ev.message }));
      break;
    default:
      break;
  }
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-foreground px-3.5 py-2 text-sm text-background">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ message }: { message: ChatMessage }) {
  const honest = message.confidence === "insufficient";
  const thinking = message.streaming && message.text.length === 0;
  const citeByMarker = new Map(message.citations.map((c) => [c.marker, c]));
  return (
    <div className="flex gap-3">
      <AtlasAiMark
        size={24}
        className={`mt-0.5 size-6 shrink-0 ${thinking ? "animate-ai-pulse" : ""}`}
      />
      <div className="min-w-0 flex-1 space-y-2">
        {message.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {message.error}
          </p>
        ) : message.text.length === 0 && message.streaming ? (
          <div className="space-y-1.5">
            <span className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
              <TypingDots />
              {message.phase === "thinking" ? "Thinking…" : "Searching your graph…"}
            </span>
            {message.steps.length > 0 && (
              <ul className="space-y-0.5 pl-1">
                {message.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check size={11} className="shrink-0 text-success" />
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : message.text.length === 0 && !message.streaming ? (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            The model returned no answer - it may be rate-limited or unavailable. Try a different
            model in Settings.
          </p>
        ) : (
          <p
            className={`whitespace-pre-wrap text-sm leading-relaxed ${honest ? "text-muted-foreground" : "text-foreground"}`}
          >
            <TypewriterText
              text={message.text}
              live={message.live}
              streaming={message.streaming}
              cites={citeByMarker}
            />
          </p>
        )}

        {message.caveats.length > 0 && (
          <ul className="space-y-0.5">
            {message.caveats.map((c) => (
              <li key={c} className="text-xs text-inferred-low">
                ⚠ {c}
              </li>
            ))}
          </ul>
        )}

        {message.confidence && !message.streaming ? (
          <TrustHint tier={message.confidence} sources={message.citations.length} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Render the model's light markdown inline - **bold**, `code`, and citation markers ([A1]/[N2]/…)
 * as small clickable superscript numbers tied to the exact claim (the "proper" way to cite, à la
 * Perplexity). Incomplete markers mid-stream stay literal; a marker with no resolved citation yet
 * (citations arrive after the tokens) is hidden until it resolves.
 */
function renderRich(text: string, cites: Map<string, Citation>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([NEA]\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={key++}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      out.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {m[2]}
        </code>,
      );
    } else {
      const c = cites.get(m[3] as string);
      if (c) {
        out.push(
          <Link
            key={key++}
            href={citationHref(c)}
            title={`Source ${c.number}${c.confidence ? ` · ${c.confidence}` : ""}`}
            className="mx-px inline-flex h-3.5 min-w-3.5 items-center justify-center rounded bg-muted px-0.5 align-super text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            {c.number}
          </Link>,
        );
      }
      // unresolved marker → hidden (dropped) until its citation arrives
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Smooth typewriter reveal that keeps pace with the stream. Animates only for LIVE turns (`live`);
 * reopened/persisted turns render instantly. Renders through `renderRich` so bold + inline
 * citations appear as the text lands.
 */
function TypewriterText({
  text,
  live,
  streaming,
  cites,
}: {
  text: string;
  live: boolean;
  streaming: boolean;
  cites: Map<string, Citation>;
}) {
  const [shown, setShown] = useState(() => (live ? 0 : text.length));
  useEffect(() => {
    if (shown >= text.length) return;
    const id = window.setInterval(() => {
      setShown((s) => {
        const next = Math.min(text.length, s + Math.max(1, Math.ceil((text.length - s) / 10)));
        if (next >= text.length) window.clearInterval(id);
        return next;
      });
    }, 18);
    return () => window.clearInterval(id);
  }, [text]);
  const caret = streaming || shown < text.length;
  return (
    <>
      {renderRich(text.slice(0, shown), cites)}
      {caret && <span className="ml-0.5 animate-pulse">▌</span>}
    </>
  );
}

/**
 * Quiet trust line (replaces the loud badge + floating chip row): a small colored dot + label, and
 * a subtle source count. The brand green appears only as the tiny "observed" dot - not a full pill.
 */
const TRUST_FALLBACK = { dot: "bg-muted-foreground", label: "No grounded data" };
const TRUST: Record<string, { dot: string; label: string }> = {
  observed: { dot: "bg-success", label: "Observed" },
  "inferred-high": { dot: "bg-warning", label: "Inferred" },
  "inferred-low": { dot: "bg-warning", label: "Inferred · low confidence" },
  advisory: { dot: "bg-primary", label: "Recommendation" },
  insufficient: TRUST_FALLBACK,
};
function TrustHint({ tier, sources }: { tier: string; sources: number }) {
  const t = TRUST[tier] ?? TRUST_FALLBACK;
  return (
    <div className="flex items-center gap-2 pt-0.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className={`size-1.5 rounded-full ${t.dot}`} />
        {t.label}
      </span>
      {sources > 0 ? (
        <span className="text-muted-foreground/70">
          · {sources} source{sources > 1 ? "s" : ""}
        </span>
      ) : null}
    </div>
  );
}

/** Placeholder while a reopened conversation's turns are fetched - a question + answer shimmer. */
function ConversationSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading conversation" aria-busy="true">
      <div className="flex justify-end">
        <div className="h-9 w-2/5 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="flex gap-3">
        <div className="mt-0.5 size-6 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 leading-none" aria-label="Thinking">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
    </span>
  );
}

function EmptyState({
  onPick,
  suggestions,
}: {
  onPick: (q: string) => void;
  suggestions: string[];
}) {
  const questions = suggestions.length > 0 ? suggestions : FALLBACK_EXAMPLES;
  return (
    // Centered, vertically-middle welcome: the liquid-metal Atlas mark leads, then the
    // pitch, then the suggestion prompts.
    <div className="flex h-full flex-col items-center justify-center gap-6 pb-28 pt-8 text-center">
      <div className="flex flex-col items-center gap-1">
        <LiquidMark />
        <div>
          <h2 className="text-3xl font-semibold text-foreground">Ask Atlas</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Ask about your infrastructure, code, and deploys. Every answer is grounded in your graph
            - cited, confidence-tiered, and honest when it doesn’t know.
          </p>
        </div>
      </div>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2 px-6">
        {questions.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The animated liquid-metal Atlas mark (WebGL). Client-only, and it degrades to the static
 *  AI mark until the shader lib loads so the hero never flashes empty. */
function LiquidMark() {
  return (
    <div className="relative grid size-[280px] place-items-center">
      {/* Soft green glow behind the mark. */}
      <div
        aria-hidden
        className="pointer-events-none absolute size-44 rounded-full bg-[#70ff7a] opacity-40 blur-3xl"
      />
      <div className="[filter:drop-shadow(0_14px_30px_rgba(112,255,122,0.45))]">
        <LiquidMetal
          width={280}
          height={280}
          image="/atlas-ai.png"
          colorBack="#00000000"
          colorTint="#70ff7a"
          repetition={2}
          softness={0.1}
          shiftRed={0.3}
          shiftBlue={0.3}
          distortion={0.07}
          contour={0.4}
          angle={70}
          speed={1}
          scale={0.82}
          fit="contain"
        />
      </div>
    </div>
  );
}
