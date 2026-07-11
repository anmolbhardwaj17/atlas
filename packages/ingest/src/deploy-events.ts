/**
 * Deploy-event derivation (operational-intelligence Phase C/D). A `deploy` landing right before an
 * incident is the single strongest "what broke it" signal, and `diagnose` already ranks events by
 * time × graph-proximity — but nothing wrote `kind='deploy'` until now. This derives them from data we
 * already crawl, with NO extra AWS permission: a Lambda's `LastModified` IS the timestamp of its last
 * code/config deploy. Idempotent by `deploy:<urn>:<timestamp>` — a redeploy changes `LastModified` and
 * so produces exactly one new event; re-runs of an unchanged function are no-ops (P-honest history).
 *
 * ECS/other runtimes will slot in the same way once their deploy timestamp is captured (ECS service
 * `deployments[].createdAt`); this first slice covers Lambda, where the timestamp is already in hand.
 */
import { withOrgScope, type Db } from "@atlas/db";
import { applyNodeEvents, type NodeEventInput } from "./node-events";

export interface DeployEventsResult {
  inserted: number;
  duplicate: number;
  scanned: number;
}

/** Normalize an AWS timestamp (e.g. `2026-07-11T14:02:33.123+0000`) to ISO; null if unparseable. */
function toIso(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Pure mapping: a Lambda node's attributes → a `deploy` event, or null when there's no usable deploy
 * timestamp. Kept pure so it's testable without a DB. `codeSha256` is recorded as evidence but NOT put
 * in the dedupe key — the timestamp already identifies the deploy, and CodeSha256 is a zip hash.
 */
export function lambdaDeployEvent(
  urn: string,
  name: string | null,
  attributes: Record<string, unknown>,
): NodeEventInput | null {
  const iso = toIso(attributes.lastModified);
  if (!iso) return null;
  const label = name ?? urn.split(":").pop() ?? "function";
  const evidence: Record<string, unknown> = { via: "lambda-last-modified" };
  const version = str(attributes.version);
  const packageType = str(attributes.packageType);
  const codeSha256 = str(attributes.codeSha256);
  if (version) evidence.version = version;
  if (packageType) evidence.packageType = packageType;
  if (codeSha256) evidence.codeSha256 = codeSha256;
  return {
    urn,
    kind: "deploy",
    occurredAt: iso,
    actor: null,
    title: `${label} deployed`,
    evidence,
    source: "aws-lambda",
    dedupeKey: `deploy:${urn}:${iso}`,
  };
}

/** Read the org's Lambda nodes and persist a `deploy` event per function's last-modified time. */
export async function deriveDeployEvents(
  deps: { db: Db },
  orgId: string,
): Promise<DeployEventsResult> {
  const rows = await withOrgScope(deps.db, orgId, (c) =>
    c
      .query<{ urn: string; name: string | null; attributes: Record<string, unknown> }>(
        `SELECT urn, name, attributes FROM nodes
          WHERE kind = 'aws.lambda.function' AND deleted_at IS NULL
            AND attributes->>'lastModified' IS NOT NULL`,
      )
      .then((r) => r.rows),
  );

  const events: NodeEventInput[] = [];
  for (const n of rows) {
    const e = lambdaDeployEvent(n.urn, n.name, n.attributes ?? {});
    if (e) events.push(e);
  }
  const res = await applyNodeEvents(deps.db, orgId, events);
  return { inserted: res.inserted, duplicate: res.duplicate, scanned: rows.length };
}
