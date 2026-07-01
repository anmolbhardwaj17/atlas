/**
 * Webhook ingress security + event mapping (docs/07 §5, docs/13 §5, GHR-8). The ingress
 * handler MUST verify the HMAC signature (timing-safe) BEFORE trusting or enqueueing
 * anything, then map the event to a minimal descriptor the worker uses to scope an
 * incremental re-crawl. Webhooks are never the only source — a periodic reconcile heals
 * missed deliveries (DD-2), so a dropped/forged event only delays, never corrupts.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a GitHub webhook `X-Hub-Signature-256` header (`sha256=<hex>`) against the
 * body using the connection's webhook secret. Timing-safe; returns false on any
 * malformed/mismatched input (never throws).
 */
export function verifyWebhookSignature(
  secret: string,
  body: string | Buffer,
  signatureHeader: string | undefined | null,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WebhookEventKind =
  "push" | "pull_request" | "workflow_run" | "repository" | "membership" | "ping" | "other";

export interface WebhookDescriptor {
  kind: WebhookEventKind;
  action?: string;
  /** The affected repo, when the event carries one. */
  repo?: { owner: string; repo: string };
}

/**
 * Map a verified webhook (`X-GitHub-Event` name + parsed JSON body) to a descriptor.
 * Pure; the worker decides the re-crawl scope from this (docs/07 §5 table).
 */
export function parseWebhookEvent(eventName: string, payload: unknown): WebhookDescriptor {
  const body = (payload ?? {}) as {
    action?: string;
    repository?: { name?: string; owner?: { login?: string } };
  };
  const repo =
    body.repository?.name && body.repository.owner?.login
      ? { owner: body.repository.owner.login, repo: body.repository.name }
      : undefined;

  const known: Record<string, WebhookEventKind> = {
    push: "push",
    pull_request: "pull_request",
    workflow_run: "workflow_run",
    repository: "repository",
    membership: "membership",
    team: "membership",
    member: "membership",
    ping: "ping",
  };
  const kind = known[eventName] ?? "other";
  return {
    kind,
    ...(body.action ? { action: body.action } : {}),
    ...(repo ? { repo } : {}),
  };
}
