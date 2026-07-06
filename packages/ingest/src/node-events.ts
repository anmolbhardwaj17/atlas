/**
 * Change-timeline persistence (operational-intelligence Phase C). Events resolve their
 * node by URN inside the org scope and land idempotently (uq_node_event_dedupe) - a
 * CloudTrail re-lookup or poller restart never duplicates history. Events whose URN has
 * no live node are counted, not guessed onto something else (P3).
 */
import { withOrgScope, type Db, type NodeEventKind } from "@atlas/db";

export interface NodeEventInput {
  /** URN of the node the event belongs to. */
  urn: string;
  kind: NodeEventKind;
  occurredAt: string;
  actor: string | null;
  /** Human one-liner for timelines ("Security group rule added"). */
  title: string;
  evidence: Record<string, unknown>;
  /** System of record ("cloudtrail" | "health-poll" | "bitbucket"). */
  source: string;
  /** Idempotency key (e.g. the CloudTrail event id). */
  dedupeKey: string;
}

export interface NodeEventsApplyResult {
  inserted: number;
  duplicate: number;
  unmatched: number;
}

export async function applyNodeEvents(
  db: Db,
  orgId: string,
  events: NodeEventInput[],
): Promise<NodeEventsApplyResult> {
  if (events.length === 0) return { inserted: 0, duplicate: 0, unmatched: 0 };
  return withOrgScope(db, orgId, async (c) => {
    let inserted = 0;
    let duplicate = 0;
    let unmatched = 0;
    for (const e of events) {
      const res = await c.query<{ inserted: boolean }>(
        `WITH target AS (
           SELECT id, org_id FROM nodes WHERE urn = $1 AND deleted_at IS NULL LIMIT 1
         ), ins AS (
           INSERT INTO node_events (org_id, node_id, kind, occurred_at, actor, title, evidence, source, dedupe_key)
           SELECT org_id, id, $2, $3, $4, $5, $6::jsonb, $7, $8 FROM target
           ON CONFLICT (org_id, dedupe_key) DO NOTHING
           RETURNING 1
         )
         SELECT EXISTS(SELECT 1 FROM ins) AS inserted, EXISTS(SELECT 1 FROM target) AS matched`,
        [
          e.urn,
          e.kind,
          e.occurredAt,
          e.actor,
          e.title,
          JSON.stringify(e.evidence),
          e.source,
          e.dedupeKey,
        ],
      );
      const row = res.rows[0] as unknown as { inserted: boolean; matched: boolean } | undefined;
      if (!row?.matched) unmatched += 1;
      else if (row.inserted) inserted += 1;
      else duplicate += 1;
    }
    return { inserted, duplicate, unmatched };
  });
}
