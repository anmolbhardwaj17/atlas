"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Send, Sparkles } from "lucide-react";
import { ConfidenceBadge } from "@/components/certainty";
import { createConversation, streamAsk, type AskEvent } from "@/lib/browser-api";

interface Citation {
  number: number;
  kind: "node" | "edge";
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
  error: string | null;
}

const EXAMPLES = [
  "What is the blast radius of the prod-orders service?",
  "What does the checkout service depend on?",
  "What changed in the last week?",
];

/**
 * Ask AI (docs/09 §5.5, docs/10). Retrieval-first, streamed. Every answer is cited and
 * confidence-tiered; a zero-grounding answer renders as an explicit "I don't know"
 * (US-11) — one of the four designed states (empty · streaming · answered · honest-absence).
 */
export function AskChat({ orgId }: { orgId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const convoRef = useRef<string | null>(null);

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
        error: null,
      },
      {
        role: "assistant",
        text: "",
        citations: [],
        confidence: null,
        caveats: [],
        streaming: true,
        error: null,
      },
    ]);

    const patchLast = (fn: (msg: ChatMessage) => ChatMessage) =>
      setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? fn(msg) : msg)));

    try {
      if (!convoRef.current) convoRef.current = await createConversation(orgId);
      if (!convoRef.current) {
        patchLast((msg) => ({ ...msg, streaming: false, error: "Couldn’t start a conversation." }));
        return;
      }
      for await (const ev of streamAsk(orgId, convoRef.current, q)) {
        applyEvent(ev, patchLast);
      }
      patchLast((msg) => ({ ...msg, streaming: false }));
    } catch {
      patchLast((msg) => ({ ...msg, streaming: false, error: "The stream was interrupted." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Fill the content area (viewport − header − page padding) so the input pins to the bottom.
    <div className="flex h-[calc(100dvh-7rem)] min-h-[420px] flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <EmptyState onPick={(q) => void ask(q)} />
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
        <button
          type="submit"
          disabled={busy || input.trim().length === 0}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Send size={15} /> Ask
        </button>
      </form>
    </div>
  );
}

function applyEvent(ev: AskEvent, patch: (fn: (m: ChatMessage) => ChatMessage) => void) {
  switch (ev.type) {
    case "token":
      patch((m) => ({ ...m, text: m.text + ev.text }));
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
      <div className="max-w-[80%] rounded-lg bg-primary/15 px-3.5 py-2 text-sm text-foreground">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ message }: { message: ChatMessage }) {
  const honest = message.confidence === "insufficient";
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-card text-primary">
        <Sparkles size={14} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {message.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {message.error}
          </p>
        ) : message.text.length === 0 && message.streaming ? (
          <TypingDots />
        ) : (
          <p
            className={`whitespace-pre-wrap text-sm ${honest ? "text-muted-foreground" : "text-foreground"}`}
          >
            {message.text}
            {message.streaming && <span className="ml-0.5 animate-pulse">▌</span>}
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
                href={c.kind === "edge" ? `/explore/edge/${c.id}` : `/explore/${c.id}`}
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

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Thinking">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
    </span>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="py-8">
      <div className="mb-3 flex items-center gap-2 text-foreground">
        <Sparkles size={18} className="text-primary" />
        <h2 className="text-lg font-semibold">Ask Atlas</h2>
      </div>
      <p className="max-w-lg text-sm text-muted-foreground">
        Ask about your infrastructure, dependencies, and deploys. Every answer is grounded in your
        graph — cited, confidence-tiered, and honest when it doesn’t know.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {EXAMPLES.map((q) => (
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
