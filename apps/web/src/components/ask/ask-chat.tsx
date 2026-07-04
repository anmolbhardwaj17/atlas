"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Send, Check, Square } from "lucide-react";
import { ConfidenceBadge } from "@/components/certainty";
import { AtlasAiMark } from "@/components/brand";
import { createConversation, getConversation, streamAskWS, type AskEvent } from "@/lib/browser-api";

interface Citation {
  number: number;
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
  error: string | null;
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
  const convoRef = useRef<string | null>(conversationId ?? null);
  const autoAsked = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => abortRef.current?.abort();

  // Reopen a past conversation: load its persisted turns.
  useEffect(() => {
    if (!conversationId) return;
    let live = true;
    void getConversation(orgId, conversationId).then((c) => {
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
          error: null,
        })),
      );
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
      {title ? (
        <div className="mb-3 shrink-0 border-b border-border pb-2.5">
          <h2 className="truncate text-sm font-semibold text-foreground" title={title}>
            {title}
          </h2>
        </div>
      ) : null}
      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {messages.length === 0 ? (
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
        className="mt-4 flex shrink-0 items-center gap-2 border-t border-border bg-background pt-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your infrastructure…"
          aria-label="Ask a question"
          disabled={busy}
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
      <div className="max-w-[80%] rounded-lg bg-foreground px-3.5 py-2 text-sm text-background">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ message }: { message: ChatMessage }) {
  const honest = message.confidence === "insufficient";
  const thinking = message.streaming && message.text.length === 0;
  return (
    <div className="flex gap-3">
      <AtlasAiMark
        size={24}
        className={`mt-0.5 size-6 shrink-0 ${thinking ? "animate-pulse" : ""}`}
      />
      <div className="min-w-0 flex-1 space-y-2">
        {message.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {message.error}
          </p>
        ) : message.text.length === 0 && message.streaming ? (
          <div className="space-y-1.5">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
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
            The model returned no answer — it may be rate-limited or unavailable. Try a different
            model in Settings.
          </p>
        ) : (
          <p
            className={`whitespace-pre-wrap text-sm ${honest ? "text-muted-foreground" : "text-foreground"}`}
          >
            <TypewriterText text={cleanMarkers(message.text)} streaming={message.streaming} />
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

        {(message.citations.length > 0 || (message.confidence && !message.streaming)) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {message.confidence && <ConfidenceBadge tier={message.confidence} />}
            {message.citations.map((c) => (
              <Link
                key={`${c.kind}-${c.number}`}
                href={
                  c.kind === "computed"
                    ? "/dashboard"
                    : c.kind === "edge"
                      ? `/explore/edge/${c.id}`
                      : `/explore/${c.id}`
                }
                className="inline-flex items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/25"
                title={`Source ${c.number}${c.confidence ? ` · ${c.confidence}` : ""}`}
              >
                [{c.number}]
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Strip raw citation markers ([A1]/[N2]/[E3]) from displayed text — they're binding metadata,
 *  rendered as numbered chips below, not meant to be read inline. */
function cleanMarkers(text: string): string {
  return text.replace(/\s?\[[NEA]\d+\]/g, "");
}

/** Smooth typewriter reveal that keeps pace with the stream (catch-up per tick), for a natural
 *  "AI typing" feel even when tokens arrive in bursts (e.g. over the WebSocket). */
function TypewriterText({ text, streaming }: { text: string; streaming: boolean }) {
  const [shown, setShown] = useState(() => (streaming ? 0 : text.length));
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
      {text.slice(0, shown)}
      {caret && <span className="ml-0.5 animate-pulse">▌</span>}
    </>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Thinking">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
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
    <div className="py-8">
      <div className="mb-3 flex items-center gap-1.5 text-foreground">
        <AtlasAiMark size={24} className="-ml-1 size-6 shrink-0" />
        <h2 className="text-lg font-semibold">Ask Atlas</h2>
      </div>
      <p className="max-w-lg text-sm text-muted-foreground">
        Ask about your infrastructure, code, and deploys. Every answer is grounded in your graph -
        cited, confidence-tiered, and honest when it doesn’t know.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {questions.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-md border border-border px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
