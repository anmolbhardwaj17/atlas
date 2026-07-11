import { Inject, Injectable } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import {
  evaluateControls,
  summarizeByFramework,
  type ComplianceFacts,
  type ControlResult,
  type FrameworkSummary,
} from "@atlas/ai";
import { PG_POOL } from "../core/tokens";
import { GraphService } from "../graph/graph.service";

/**
 * A capability the compliance controls key off (via `Control.assessKey`) → what Atlas needs to assess
 * it (docs/plans/compliance.md). `supported` = the connector actually crawls the data yet; `actions`
 * = the read-only IAM action(s) the AWS role must be able to call. A capability is *assessable* for an
 * org only when it's supported AND none of its actions are in that org's denied set — otherwise the
 * control shows `not-assessable` with a precise reason: "not crawled yet" vs "grant IAM action X".
 * This is the single honest source of assessability (P4 — trust is visible); flip `supported` to true
 * as each Phase-2b crawl lands.
 */
interface Capability {
  supported: boolean;
  actions: string[];
}

const CAPABILITIES: Record<string, Capability> = {
  // Already crawled (Phase 1/2) — no extra permission beyond the core read role.
  network: { supported: true, actions: [] }, // aws.sg.rules ingress + ELB scheme
  iamPolicy: { supported: true, actions: [] }, // aws.iam.policy_statements (wildcard)
  vulns: { supported: true, actions: [] }, // OSV enrichment + dependency graph
  multiAz: { supported: true, actions: [] }, // RDS MultiAZ (rds:DescribeDBInstances)
  ciPipeline: { supported: true, actions: [] }, // repo/pipeline nodes
  // Phase 2b — flip `supported` to true as each crawl lands; the actions gate assessability.
  // Encryption-at-rest is assessed from RDS StorageEncrypted (rds:DescribeDBInstances, already
  // granted) + S3 default encryption (best-effort) → no extra permission required.
  encryptionAtRest: { supported: true, actions: [] },
  encryptionInTransit: { supported: false, actions: ["elasticloadbalancing:DescribeListeners"] },
  // Public-access is gated by the posture probe's action; the ACL/policy sub-reads ride along.
  publicStorage: { supported: true, actions: ["s3:GetBucketPublicAccessBlock"] },
  // Multi-region CloudTrail logging (aws.account.cloudTrailEnabled). Flow-logs are a later slice.
  auditLogging: {
    supported: true,
    actions: ["cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus"],
  },
  // Root MFA is crawled (aws.account via GetAccountSummary). Credential-report/per-user MFA is a
  // later slice; root MFA is the headline control and needs only GetAccountSummary.
  iamCredentials: {
    supported: true,
    actions: ["iam:GetAccountSummary"],
  },
};

export interface ComplianceReport {
  frameworks: FrameworkSummary[];
  controls: ControlResult[];
  lastSyncAt: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    private readonly graph: GraphService,
  ) {}

  /**
   * Assess the estate against the shared control catalog and roll it up per framework. Reuses the
   * dashboard `summary()` (a control fails when its backing finding is open) + a per-kind inventory
   * (applicability) + the AWS role's denied permissions (assessability). Read-only, org-scoped (RLS).
   */
  async assess(orgId: string): Promise<ComplianceReport> {
    const [summary, inventory, missingActions] = await Promise.all([
      this.graph.summary(orgId),
      withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<{ kind: string; n: number }>(
          `SELECT kind, count(*)::int AS n FROM nodes WHERE status <> 'deleted' GROUP BY kind`,
        );
        return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
      }),
      // IAM actions the org's AWS role was denied — the health poll keeps `missingPermissions` fresh.
      withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<{ action: string }>(
          `SELECT DISTINCT jsonb_array_elements_text(health->'missingPermissions') AS action
             FROM connections
            WHERE provider = 'aws' AND deleted_at IS NULL AND health ? 'missingPermissions'`,
        );
        return new Set(rows.map((r) => r.action));
      }),
    ]);

    // Per-capability assessability + gap reason (unsupported vs a specific permission to grant).
    const assessable: Record<string, boolean> = {};
    const capGap: Record<string, { reason: "unsupported" | "permission"; actions: string[] }> = {};
    for (const [key, cap] of Object.entries(CAPABILITIES)) {
      const denied = cap.actions.filter((a) => missingActions.has(a));
      const ok = cap.supported && denied.length === 0;
      assessable[key] = ok;
      if (!ok) {
        capGap[key] = cap.supported
          ? { reason: "permission", actions: denied }
          : { reason: "unsupported", actions: [] };
      }
    }

    // Enrich each evidence resource with its node kind (for the provider icon in the UI).
    const evidenceIds = [
      ...new Set(
        summary.findings
          .flatMap((f) => (f.evidence ?? []).map((e) => e.id))
          .filter((id) => UUID.test(id)),
      ),
    ];
    const kindById = new Map<string, string>();
    if (evidenceIds.length > 0) {
      await withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<{ id: string; kind: string }>(
          `SELECT id, kind FROM nodes WHERE id = ANY($1::uuid[])`,
          [evidenceIds],
        );
        for (const r of rows) kindById.set(r.id, r.kind);
      });
    }

    const openFindings: ComplianceFacts["openFindings"] = {};
    for (const f of summary.findings) {
      openFindings[f.id] = {
        count: f.count ?? f.evidence?.length ?? 1,
        detail: f.detail,
        evidence: (f.evidence ?? []).map((e) => {
          const kind = kindById.get(e.id);
          return kind ? { id: e.id, label: e.label, kind } : { id: e.id, label: e.label };
        }),
      };
    }

    const facts: ComplianceFacts = { openFindings, inventory, assessable };
    const controls = evaluateControls(facts).map((r) => this.explainGap(r, capGap));
    return {
      frameworks: summarizeByFramework(controls),
      controls,
      lastSyncAt: summary.trust.lastSyncAt,
    };
  }

  /** For a not-assessable control, replace the generic reason with a precise, actionable one:
   *  "grant these IAM actions" (permission gap) vs the catalog's "not crawled yet" (unsupported). */
  private explainGap(
    r: ControlResult,
    capGap: Record<string, { reason: "unsupported" | "permission"; actions: string[] }>,
  ): ControlResult {
    if (r.status !== "not-assessable") return r;
    const gap = capGap[r.control.assessKey];
    if (!gap || gap.reason !== "permission" || gap.actions.length === 0) return r;
    return {
      ...r,
      detail: `Atlas can assess this, but your AWS role can't call ${gap.actions.join(", ")}. Grant it (or attach the AWS-managed SecurityAudit policy) and it lights up on the next sync.`,
      missingActions: gap.actions,
    };
  }
}
