import { Inject, Injectable, Logger } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import { verifyWebhookSignature, parseWebhookEvent } from "@atlas/connector-github";
import { enqueueSync, type JobQueue } from "@atlas/ingest";
import type { Env } from "@atlas/config";
import { ENV, PG_POOL } from "../core/tokens";
import { JOB_QUEUE } from "../connections/tokens";
import { ApiException } from "../common/errors";

/** Webhook events that warrant an incremental re-crawl of the affected source (docs/07 §5). */
const RECRAWL_EVENTS = new Set([
  "push",
  "pull_request",
  "workflow_run",
  "repository",
  "membership",
]);

export interface WebhookResult {
  action: "ping" | "ignored" | "unknown_connection" | "accepted";
  runId?: string;
}

/**
 * GitHub webhook ingress (docs/07 §5, docs/13 §5, GHR-8). Verifies the HMAC signature
 * BEFORE trusting anything, maps the event to a re-crawl decision, resolves the
 * connection's org (via the SECURITY DEFINER resolver — the request carries no session/GUC),
 * then enqueues an org-scoped incremental sync. Webhooks are never the only source — a
 * periodic reconcile heals missed/forged deliveries (DD-2), so this only ever *accelerates*
 * freshness; a dropped event never corrupts the graph.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async handleGithub(
    connectionId: string,
    eventName: string,
    signature: string | undefined,
    rawBody: Buffer,
  ): Promise<WebhookResult> {
    // Fail-closed: no secret configured → reject (don't trust unsigned/forgeable input).
    const secret = this.env.GITHUB_WEBHOOK_SECRET;
    if (!secret || !verifyWebhookSignature(secret, rawBody, signature)) {
      throw new ApiException(401, "unauthenticated", "Invalid webhook signature.");
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      payload = {};
    }
    const descriptor = parseWebhookEvent(eventName, payload);
    if (descriptor.kind === "ping") return { action: "ping" };
    if (!RECRAWL_EVENTS.has(descriptor.kind)) return { action: "ignored" };

    // Resolve the connection's org without a session (SECURITY DEFINER; bypasses RLS).
    const { rows } = await this.db.query<{ org: string | null }>(
      "SELECT app_connection_org($1) AS org",
      [connectionId],
    );
    const orgId = rows[0]?.org;
    if (!orgId) return { action: "unknown_connection" };

    const runId = await this.enqueueIncremental(orgId, connectionId);
    this.logger.log(
      `github webhook: ${eventName} → connection ${connectionId} (org ${orgId})` +
        (runId ? ` → sync ${runId}` : " (a sync is already in flight)"),
    );
    return runId ? { action: "accepted", runId } : { action: "accepted" };
  }

  /** Create a queued incremental sync_run (org-scoped) + enqueue it. BR-SYNC-1 (one in-flight
   *  run per connection) makes a conflicting insert a no-op — the existing run covers it. */
  private async enqueueIncremental(
    orgId: string,
    connectionId: string,
  ): Promise<string | undefined> {
    let runId: string | undefined;
    try {
      runId = await withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
           VALUES ($1, $2, 'incremental', 'webhook', 'queued') RETURNING id`,
          [orgId, connectionId],
        );
        return rows[0]?.id;
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") return undefined; // BR-SYNC-1
      this.logger.error(`failed to create webhook sync_run: ${(err as Error).message}`);
      return undefined;
    }
    if (!runId) return undefined;
    try {
      await enqueueSync(this.queue, { orgId, connectionId, runId, type: "incremental" });
    } catch (err) {
      this.logger.error(`failed to enqueue webhook sync: ${(err as Error).message}`);
    }
    return runId;
  }
}
