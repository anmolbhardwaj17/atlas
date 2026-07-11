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
 * What Atlas actually crawls today, per control-capability key (docs/plans/compliance.md). This is
 * the single honest source of "assessability": a `false` here makes every control that needs that
 * capability render as `not-assessable` rather than a silent pass (P4 — trust is visible). Flip a
 * flag to `true` only when the connector genuinely captures the data (and add the check). The `false`
 * rows double as the connector roadmap (Security Phase 2b: encryption, public-S3, audit-log, IAM
 * credential report).
 */
const ATLAS_ASSESSABLE: Record<string, boolean> = {
  network: true, // aws.sg.rules ingress + ELB scheme are crawled
  iamPolicy: true, // aws.iam.policy_statements are crawled (wildcard detection)
  vulns: true, // OSV enrichment + dependency graph
  multiAz: true, // RDS MultiAZ attribute
  ciPipeline: true, // repo/pipeline nodes
  encryptionAtRest: false, // RDS StorageEncrypted / S3 default encryption not crawled
  encryptionInTransit: false, // ELB listener protocols / TLS policy not crawled
  publicStorage: false, // S3 public-access-block / ACL / policy not crawled
  auditLogging: false, // CloudTrail / flow-log enablement + retention not crawled
  iamCredentials: false, // IAM credential report / MFA / root usage not crawled
};

export interface ComplianceReport {
  frameworks: FrameworkSummary[];
  controls: ControlResult[];
  assessable: Record<string, boolean>;
  lastSyncAt: string | null;
}

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    private readonly graph: GraphService,
  ) {}

  /**
   * Assess the estate against the shared control catalog and roll it up per framework. Reuses the
   * dashboard `summary()` (a control fails when its backing finding is open) plus a per-kind
   * inventory for applicability. Read-only, org-scoped (RLS).
   */
  async assess(orgId: string): Promise<ComplianceReport> {
    const [summary, inventory] = await Promise.all([
      this.graph.summary(orgId),
      withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<{ kind: string; n: number }>(
          `SELECT kind, count(*)::int AS n FROM nodes WHERE status <> 'deleted' GROUP BY kind`,
        );
        return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
      }),
    ]);

    const openFindings: ComplianceFacts["openFindings"] = {};
    for (const f of summary.findings) {
      openFindings[f.id] = {
        count: f.count ?? f.evidence?.length ?? 1,
        detail: f.detail,
        evidence: (f.evidence ?? []).map((e) => ({ id: e.id, label: e.label })),
      };
    }

    const facts: ComplianceFacts = { openFindings, inventory, assessable: ATLAS_ASSESSABLE };
    const controls = evaluateControls(facts);
    return {
      frameworks: summarizeByFramework(controls),
      controls,
      assessable: ATLAS_ASSESSABLE,
      lastSyncAt: summary.trust.lastSyncAt,
    };
  }
}
