import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";

/**
 * Client-side Atlas API access for the interactive surfaces (Ask AI SSE stream, ⌘K search).
 * The Supabase access token is public-by-design (RLS + our GUC isolation enforce access);
 * these run in the browser because they need live streaming / keystroke latency.
 */
export async function getClientToken(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  // `getSession()` returns whatever is in storage - which can be an already-expired access token
  // (Supabase tokens live ~1h; a tab left open past that, or a backgrounded tab whose auto-refresh
  // timer didn't fire, holds a stale one). Sending an expired Bearer makes the API 401, which the
  // client surfaces as "Couldn't start a conversation." / empty search. Refresh proactively when
  // the token is expired or within 60s of it.
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - now < 60) {
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token ?? session.access_token;
  }
  return session.access_token;
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

/** Outcome of the most recent finished sync run (`partial` = some scopes skipped). */
export interface LastSyncSummary {
  status: "succeeded" | "partial" | "failed" | "cancelled";
  finishedAt: string;
  resources: number;
  edges: number;
  scopesFailed: number;
}

export interface ConnectionSummary {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  /** Sample/demo connection - not a real syncable source (skip in Fetch latest). */
  demo?: boolean;
  /** Connector health from verify/sync probes - `missingPermissions` drives the degraded hint. */
  health?: { missingPermissions?: string[] };
  /** A sync run is queued/running right now. */
  syncing?: boolean;
  /** Most recent finished run, or null if none has completed yet. */
  lastSync?: LastSyncSummary | null;
}

/** Create a connection for a provider (Integrations hub). Admin-only server-side. */
export async function createConnection(
  orgId: string,
  provider: string,
  displayName: string,
  config?: Record<string, unknown>,
): Promise<ConnectionSummary> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/connections`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider, displayName, ...(config ? { config } : {}) }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: ConnectionSummary;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Couldn't add the connection (${res.status}).`);
  }
  return body.data;
}

/** Attach credentials + run the connector's live verification probe (FR-1.3). The raw
 *  credentials go to the Secrets Broker (never persisted on the row); only the resulting
 *  status/health returns. */
export async function verifyConnection(
  orgId: string,
  id: string,
  credentials: Record<string, string>,
): Promise<ConnectionSummary> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/connections/${id}/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ credentials }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: ConnectionSummary;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Verification failed (${res.status}).`);
  }
  return body.data;
}

/** List the org's connections (browser). Returns [] when signed out or on error. */
export async function listConnections(orgId: string): Promise<ConnectionSummary[]> {
  const token = await getClientToken();
  if (!token) return [];
  const res = await fetch(`${apiUrl()}/connections`, {
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { data?: ConnectionSummary[] } | null;
  return body?.data ?? [];
}

export interface SyncTriggerResult {
  status: "queued" | "already_running";
  runId: string | null;
}

/** Trigger a full re-sync of a connection ("fetch latest info"). Throws with a human message
 *  (e.g. credentials-unavailable → reconnect) on failure so the caller can surface it. Admin-only. */
export async function triggerSync(orgId: string, id: string): Promise<SyncTriggerResult> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/connections/${id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: SyncTriggerResult;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Couldn't start a sync (${res.status}).`);
  }
  return body.data;
}

/** Disconnect a source (purges its graph data server-side). Admin-only. */
export async function deleteConnection(orgId: string, id: string): Promise<void> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/connections/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Couldn't disconnect (${res.status}).`);
  }
}

export interface LlmSettings {
  provider: string;
  model: string;
}

/** The org's BYO-LLM config (never the key). Null when using the platform default. */
export async function getLlmSettings(orgId: string): Promise<LlmSettings | null> {
  const token = await getClientToken();
  if (!token) return null;
  const res = await fetch(`${apiUrl()}/ai/settings`, {
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { data?: LlmSettings | null } | null;
  return body?.data ?? null;
}

/** Save the org's model + key (key → encrypted store; tested server-side first). Admin-only. */
export async function setLlmSettings(
  orgId: string,
  provider: string,
  model: string,
  apiKey: string,
): Promise<LlmSettings> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/ai/settings`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider, model, apiKey }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: LlmSettings;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Couldn't save the model (${res.status}).`);
  }
  return body.data;
}

/** Remove the org's BYO-LLM (fall back to the platform default). Admin-only. */
export async function deleteLlmSettings(orgId: string): Promise<void> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/ai/settings`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Couldn't remove the model (${res.status}).`);
  }
}

/** The SSE event union the /ai messages endpoint streams (mirrors AnswerEvent). */
export type AskEvent =
  | { type: "retrieval_step"; hop: number; tool: string; summary: string }
  | { type: "retrieval"; nodesConsidered: number; intent: string }
  | { type: "token"; text: string }
  | {
      type: "citation";
      citation: {
        number: number;
        marker: string;
        kind: "node" | "edge" | "computed";
        id: string;
        confidence: string | null;
        provenanceUrl: string;
      };
    }
  | { type: "confidence"; overall: string; caveats: string[] }
  | { type: "done"; grounded: boolean; citations: number }
  | { type: "error"; message: string };

/** Create a conversation (optionally titled by the first question), returning its id or null. */
export async function createConversation(orgId: string, title?: string): Promise<string | null> {
  const token = await getClientToken();
  if (!token) return null;
  const res = await fetch(`${apiUrl()}/ai/conversations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(title ? { title: title.slice(0, 200) } : {}),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: { id: string } };
  return body.data?.id ?? null;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
}

/** Recent conversations for the history sidebar. */
export async function listConversations(orgId: string): Promise<ConversationSummary[]> {
  const token = await getClientToken();
  if (!token) return [];
  const res = await fetch(`${apiUrl()}/ai/conversations`, {
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { data?: ConversationSummary[] } | null;
  return body?.data ?? [];
}

/** Delete a conversation and its messages. Returns true on success (best-effort). */
export async function deleteConversation(orgId: string, id: string): Promise<boolean> {
  const token = await getClientToken();
  if (!token) return false;
  const res = await fetch(`${apiUrl()}/ai/conversations/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  return res.ok;
}

export interface ConversationMessage {
  role: string;
  content: string;
  citations: Array<{
    number: number;
    marker: string;
    kind: "node" | "edge" | "computed";
    id: string;
    confidence: string | null;
  }>;
  confidence: string | null;
}

/** Load a conversation's messages (for reopening from history). */
export async function getConversation(
  orgId: string,
  id: string,
): Promise<{ id: string; title: string | null; messages: ConversationMessage[] } | null> {
  const token = await getClientToken();
  if (!token) return null;
  const res = await fetch(`${apiUrl()}/ai/conversations/${id}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    data?: { id: string; title: string | null; messages: ConversationMessage[] };
  } | null;
  return body?.data ?? null;
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

/**
 * WebSocket answer stream (docs/plans/…p1-design §9.1). Auth is sent as the first frame (never in
 * the URL). Same `AskEvent` shape as SSE, so the caller's loop is identical. `signal` → a `cancel`
 * frame that stops the answer server-side (tool-loop + LLM cost), not just the client read.
 * Falls back to `streamAsk` (SSE) if the socket can't reach `ready` (proxies / WS-blocked networks).
 */
export async function* streamAskWS(
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
  if (typeof WebSocket === "undefined") {
    yield* streamAsk(orgId, conversationId, message, signal);
    return;
  }

  const url = `${apiUrl().replace(/^http/, "ws")}/ai/ws`;
  const ws = new WebSocket(url);
  const queue: AskEvent[] = [];
  let closed = false;
  let ready = false;
  let handshakeFailed = false;
  let wake: (() => void) | null = null;
  const bump = (): void => {
    wake?.();
    wake = null;
  };

  ws.onopen = () => ws.send(JSON.stringify({ t: "auth", token, orgId }));
  ws.onmessage = (e) => {
    let msg: AskEvent | { t?: string };
    try {
      msg = JSON.parse(String(e.data)) as AskEvent | { t?: string };
    } catch {
      return;
    }
    if ("t" in msg && msg.t === "ready") {
      ready = true;
      ws.send(JSON.stringify({ t: "ask", conversationId, message }));
      return;
    }
    queue.push(msg as AskEvent);
    bump();
  };
  ws.onerror = () => {
    if (!ready) handshakeFailed = true;
    closed = true;
    bump();
  };
  ws.onclose = () => {
    closed = true;
    bump();
  };
  const onAbort = (): void => {
    try {
      ws.send(JSON.stringify({ t: "cancel" }));
      ws.close();
    } catch {
      /* already gone */
    }
  };
  signal?.addEventListener("abort", onAbort);

  try {
    while (true) {
      while (queue.length) {
        const ev = queue.shift() as AskEvent;
        yield ev;
        if (ev.type === "done") return;
      }
      if (closed) break;
      await new Promise<void>((r) => {
        wake = r;
      });
    }
    // Never reached ready and no events → the socket failed the handshake; fall back to SSE.
    if (handshakeFailed && !ready) {
      yield* streamAsk(orgId, conversationId, message, signal);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      ws.close();
    } catch {
      /* noop */
    }
  }
}

/** One CloudWatch series for a node (on-demand; nothing stored server-side). */
export interface MetricSeries {
  metric: string;
  label: string;
  unit: string;
  points: Array<[string, number]>;
}

export async function getNodeMetrics(
  orgId: string,
  nodeId: string,
): Promise<{ supported: boolean; series: MetricSeries[] }> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/nodes/${nodeId}/metrics`, {
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { supported: boolean; series: MetricSeries[] };
  } | null;
  if (!res.ok || !body?.data) return { supported: false, series: [] };
  return body.data;
}

/** Proactive-notification channel status (webhook is write-only; only a masked hint returns). */
export interface NotificationStatus {
  configured: boolean;
  kind: "slack" | null;
  enabled: boolean;
  hint: string | null;
}

async function notifyReq<T>(orgId: string, path: string, method: string): Promise<T> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/notifications${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Atlas-Org": orgId },
  });
  const body = (await res.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!res.ok || body?.data === undefined) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status}).`);
  }
  return body.data;
}

export async function getNotificationStatus(orgId: string): Promise<NotificationStatus> {
  return notifyReq<NotificationStatus>(orgId, "", "GET");
}

/** One row in the in-app notification feed (the bell). */
export interface NotificationItem {
  id: string;
  kind: string;
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function getInbox(
  orgId: string,
): Promise<{ items: NotificationItem[]; unread: number }> {
  return notifyReq<{ items: NotificationItem[]; unread: number }>(orgId, "/inbox", "GET");
}

export async function markAllNotificationsRead(orgId: string): Promise<void> {
  await notifyReq<{ ok: true }>(orgId, "/inbox/read-all", "POST");
}

export async function markNotificationRead(orgId: string, id: string): Promise<void> {
  await notifyReq<{ ok: true }>(orgId, `/inbox/${id}/read`, "POST");
}

export async function setSlackWebhook(
  orgId: string,
  webhookUrl: string,
): Promise<NotificationStatus> {
  const token = await getClientToken();
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch(`${apiUrl()}/notifications/slack`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Atlas-Org": orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ webhookUrl }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: NotificationStatus;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.data)
    throw new Error(body?.error?.message ?? `Couldn't save (${res.status}).`);
  return body.data;
}

export async function testNotification(
  orgId: string,
): Promise<{ delivered: boolean; message: string }> {
  return notifyReq<{ delivered: boolean; message: string }>(orgId, "/test", "POST");
}

export async function disableNotifications(orgId: string): Promise<NotificationStatus> {
  return notifyReq<NotificationStatus>(orgId, "", "DELETE");
}
