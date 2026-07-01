import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";

/**
 * Client-side Atlas API access for the interactive surfaces (Ask AI SSE stream, ⌘K search).
 * The Supabase access token is public-by-design (RLS + our GUC isolation enforce access);
 * these run in the browser because they need live streaming / keystroke latency.
 */
export async function getClientToken(): Promise<string | null> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  return session?.access_token ?? null;
}

export interface SearchHit {
  node: { id: string; kind: string; name: string | null };
  score: number;
  highlights: string[];
}

export async function searchNodes(
  orgId: string,
  q: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const token = await getClientToken();
  if (!token) return [];
  const res = await fetch(`${apiUrl()}/search?q=${encodeURIComponent(q)}&limit=8`, {
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data: SearchHit[] };
  return body.data ?? [];
}

export interface DemoSeedResult {
  status: string;
  nodeCount: number;
  observedEdges: number;
  inferredEdges: number;
  signals: number;
}

/**
 * Load the sample "Shopyard" estate into the current org (onboarding "Load sample data",
 * P1.2). Admin-only + empty-org-gated server-side. Throws with a human message on failure.
 */
export async function seedDemo(orgId: string): Promise<DemoSeedResult> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/demo/seed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: DemoSeedResult;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Couldn't load sample data (${res.status}).`);
  }
  return body.data;
}

/** The SSE event union the /ai messages endpoint streams (mirrors AnswerEvent). */
export type AskEvent =
  | { type: "retrieval"; nodesConsidered: number; intent: string }
  | { type: "token"; text: string }
  | {
      type: "citation";
      citation: {
        number: number;
        kind: "node" | "edge";
        id: string;
        confidence: string | null;
        provenanceUrl: string;
      };
    }
  | { type: "confidence"; overall: string; caveats: string[] }
  | { type: "done"; grounded: boolean; citations: number }
  | { type: "error"; message: string };

/** Create a conversation, returning its id (or null on failure). */
export async function createConversation(orgId: string): Promise<string | null> {
  const token = await getClientToken();
  if (!token) return null;
  const res = await fetch(`${apiUrl()}/ai/conversations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: { id: string } };
  return body.data?.id ?? null;
}

/**
 * POST a message and yield parsed SSE events as they stream (retrieval → token →
 * citation → confidence → done). EventSource is GET-only, so we parse the stream
 * off a fetch body reader ourselves.
 */
export async function* streamAsk(
  orgId: string,
  conversationId: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  const token = await getClientToken();
  if (!token) {
    yield { type: "error", message: "Not signed in." };
    return;
  }
  const res = await fetch(`${apiUrl()}/ai/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    yield { type: "error", message: `Request failed (${res.status}).` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(5).trim()) as AskEvent;
      } catch {
        // ignore malformed frame
      }
    }
  }
}
