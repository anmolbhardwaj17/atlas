/**
 * Compliance controls catalog + evaluation (docs/plans/compliance.md).
 *
 * Atlas is a READ-ONLY technical evidence source (cloud + code + exposure + vulnerabilities). It is
 * NOT a compliance tool — most of any framework (ISO/HIPAA/PCI/NIST/SOC2/GDPR) is organizational
 * (policies, training, DPAs, physical security, IR *process*) and unobservable from infrastructure.
 * What Atlas CAN do honestly is continuously check the **infrastructure-observable subset** of the
 * technical controls, and map each check to the many framework control IDs it satisfies at once.
 *
 * Trust is the whole point (P4): a control is `not-assessable` when Atlas doesn't yet crawl the data
 * it would need (a designed state, like health's "unknown" — never a silent pass), `not-applicable`
 * when the estate has no such resource, and only `pass`/`fail` when we have real evidence. The
 * framework summary always states how much is out of Atlas's scope, so we never imply "you are HIPAA
 * compliant" — only "these N infrastructure controls, which several frameworks require, pass/fail".
 */

export type Framework = "pci" | "nist" | "iso" | "hipaa" | "cis" | "gdpr";
export type ControlStatus = "pass" | "fail" | "not-applicable" | "not-assessable";
export type ControlDomain =
  | "network"
  | "access"
  | "encryption"
  | "vulnerability"
  | "data-protection"
  | "logging"
  | "resilience"
  | "sdlc";

export interface FrameworkMeta {
  key: Framework;
  label: string;
  full: string;
  /** The honest scope caveat: what this framework needs beyond what any infra tool can see. */
  scopeNote: string;
}

export const FRAMEWORKS: FrameworkMeta[] = [
  {
    key: "pci",
    label: "PCI-DSS",
    full: "PCI-DSS v4.0",
    scopeNote:
      "Atlas covers technical requirements in Req 1-8 & 10-11 that are observable in cloud + code. Requirements needing policy, physical, cardholder-data-scoping, and process evidence are out of Atlas's scope.",
  },
  {
    key: "cis",
    label: "CIS / AWS FSBP",
    full: "CIS AWS Foundations Benchmark + AWS Foundational Security Best Practices",
    scopeNote:
      "The most directly infra-mappable baseline; Atlas checks the config controls it crawls. Account-level controls (root MFA, password policy, CloudTrail enablement) are not yet crawled.",
  },
  {
    key: "nist",
    label: "NIST 800-53",
    full: "NIST SP 800-53 Rev.5 / CSF",
    scopeNote:
      "Atlas maps to technical controls in the SC (system/comms), AC (access), SI (integrity), AU (audit), and CP (contingency) families. The bulk of 800-53 (program, personnel, physical) is out of scope.",
  },
  {
    key: "iso",
    label: "ISO 27001",
    full: "ISO/IEC 27001:2022 Annex A",
    scopeNote:
      "Atlas covers the technical Annex-A subset (A.8 asset, A.9 access, A.10 crypto, A.13 network, A.12.6 vuln). The ISMS itself — risk assessment, policies, management review — is out of scope.",
  },
  {
    key: "hipaa",
    label: "HIPAA",
    full: "HIPAA Security Rule (45 CFR §164.3xx)",
    scopeNote:
      "Atlas covers the Technical Safeguards (§164.312) that are infra-observable. Administrative (§164.308) and Physical (§164.310) safeguards, and BAAs, are entirely out of scope.",
  },
  {
    key: "gdpr",
    label: "GDPR",
    full: "GDPR Art. 32 (security of processing)",
    scopeNote:
      "Only Art. 32 (security of processing) is technical; Atlas checks encryption/confidentiality/resilience signals for it. Lawful basis, DPAs, DSAR handling, and the rest of GDPR are legal/organizational and out of scope.",
  },
];

/** A control mapped to the framework requirement IDs it satisfies. `assessKey` gates on whether Atlas
 *  crawls the data it needs; `findingId` (when present) is the dashboard finding whose presence = fail. */
export interface Control {
  id: string;
  title: string;
  requirement: string;
  domain: ControlDomain;
  mappings: Partial<Record<Framework, string[]>>;
  /** Capability key into `ComplianceFacts.assessable`; false → `not-assessable` (a crawl gap). */
  assessKey: string;
  /** The node kinds this control applies to; if none exist in the estate → `not-applicable`. */
  appliesTo?: string[];
  /** The finding whose presence means this control FAILS (absence → pass, once assessable+applicable). */
  findingId?: string;
  /** Shown when `not-assessable` — names the crawl gap so it doubles as a roadmap item. */
  notAssessableReason?: string;
}

export const CONTROLS: Control[] = [
  {
    id: "net.no-world-open-ingress",
    title: "No security group open to the whole internet",
    requirement:
      "No security group allows inbound traffic from 0.0.0.0/0 (or ::/0). Public entry belongs behind a load balancer/WAF with scoped ingress.",
    domain: "network",
    assessKey: "network",
    appliesTo: ["aws.securitygroup"],
    findingId: "sg-world-open",
    mappings: {
      pci: ["1.2.1", "1.3.1", "1.4.1"],
      cis: ["5.2", "4.1"],
      nist: ["SC-7", "AC-4"],
      iso: ["A.13.1.1", "A.13.1.3"],
      hipaa: ["§164.312(e)(1)"],
      gdpr: ["Art.32(1)(b)"],
    },
  },
  {
    id: "net.lb-scheme-intentional",
    title: "Load balancer exposure matches intent",
    requirement:
      "Internet-facing load balancers are deliberate — no LB named private/internal is actually internet-facing.",
    domain: "network",
    assessKey: "network",
    appliesTo: ["aws.elb"],
    findingId: "elb-private-but-public",
    mappings: {
      pci: ["1.3.4", "1.4.4"],
      cis: ["4.1"],
      nist: ["SC-7"],
      iso: ["A.13.1.3"],
    },
  },
  {
    id: "iam.no-wildcard",
    title: "No wildcard (admin-equivalent) IAM policies",
    requirement:
      "No IAM policy statement allows action '*' on resource '*'. Least privilege: scope to the specific actions and ARNs needed.",
    domain: "access",
    assessKey: "iamPolicy",
    appliesTo: ["aws.iam.role", "aws.iam.policy"],
    findingId: "iam-wildcard",
    mappings: {
      pci: ["7.2.1", "7.2.2"],
      cis: ["1.16"],
      nist: ["AC-6", "AC-6(1)"],
      iso: ["A.9.2.3", "A.9.4.1"],
      hipaa: ["§164.312(a)(1)"],
      gdpr: ["Art.32(1)(b)"],
    },
  },
  {
    id: "vuln.no-known-critical",
    title: "No known critical/high vulnerabilities in dependencies",
    requirement:
      "Deployed code has no dependency with a known critical or high-severity CVE/GHSA; patch to the fixed version and gate new ones at PR time.",
    domain: "vulnerability",
    assessKey: "vulns",
    appliesTo: ["external.package"],
    findingId: "vulnerabilities",
    mappings: {
      pci: ["6.3.1", "6.3.3"],
      cis: ["ECR.1"],
      nist: ["SI-2", "RA-5"],
      iso: ["A.12.6.1"],
      gdpr: ["Art.32(1)(d)"],
    },
  },
  {
    id: "vuln.no-reachable",
    title: "No internet-reachable service running vulnerable code",
    requirement:
      "The toxic combination: no internet-exposed resource is running a dependency with a known critical/high CVE. This is the prioritised, remotely-exploitable subset of vulnerability management.",
    domain: "vulnerability",
    assessKey: "vulns",
    appliesTo: ["external.package"],
    findingId: "exposed-vulnerable",
    mappings: {
      pci: ["6.3.1", "11.3.1"],
      nist: ["RA-5", "SI-2", "SC-7"],
      iso: ["A.12.6.1", "A.14.2.5"],
      hipaa: ["§164.308(a)(1)(ii)(B)"],
    },
  },
  {
    id: "resilience.prod-db-multi-az",
    title: "Production databases are multi-AZ",
    requirement:
      "Production databases run across multiple availability zones so a single-AZ failure doesn't take data offline.",
    domain: "resilience",
    assessKey: "multiAz",
    appliesTo: ["aws.rds.instance"],
    findingId: "rds-single-az",
    mappings: {
      nist: ["CP-9", "CP-10"],
      iso: ["A.17.1.2"],
      gdpr: ["Art.32(1)(b)", "Art.32(1)(c)"],
    },
  },
  {
    id: "sdlc.ci-gate",
    title: "Repositories have a CI/CD build/test/security gate",
    requirement:
      "Every repository has a pipeline so changes are built, tested, and scanned before release — not shipped manually.",
    domain: "sdlc",
    assessKey: "ciPipeline",
    appliesTo: ["bitbucket.repository", "github.repository"],
    findingId: "repos-no-pipeline",
    mappings: {
      pci: ["6.3.2", "6.5.1"],
      nist: ["SA-11", "CM-3"],
      iso: ["A.14.2.2", "A.14.2.8"],
    },
  },
  // ── Controls Atlas cannot yet assess (crawl gaps). Rendered as `not-assessable` — a designed,
  //    honest state that doubles as the connector roadmap, never a silent pass. ──
  {
    id: "crypto.at-rest",
    title: "Data encrypted at rest",
    requirement: "Datastores (RDS, S3, EBS, DynamoDB) encrypt data at rest with KMS.",
    domain: "encryption",
    assessKey: "encryptionAtRest",
    appliesTo: ["aws.rds.instance", "aws.s3.bucket", "aws.dynamodb.table"],
    notAssessableReason:
      "Atlas does not yet crawl encryption state (RDS StorageEncrypted / S3 default encryption / EBS). Connector gap.",
    mappings: {
      pci: ["3.5.1"],
      cis: ["2.1.1", "2.3.1", "RDS.3"],
      nist: ["SC-28"],
      iso: ["A.10.1.1"],
      hipaa: ["§164.312(a)(2)(iv)"],
      gdpr: ["Art.32(1)(a)"],
    },
  },
  {
    id: "crypto.in-transit",
    title: "Data encrypted in transit (TLS)",
    requirement: "Public endpoints and load-balancer listeners require TLS; no plaintext HTTP.",
    domain: "encryption",
    assessKey: "encryptionInTransit",
    appliesTo: ["aws.elb"],
    notAssessableReason: "Atlas does not yet crawl listener protocols / TLS policy. Connector gap.",
    mappings: {
      pci: ["4.2.1"],
      cis: ["ELB.1"],
      nist: ["SC-8", "SC-8(1)"],
      iso: ["A.13.2.1"],
      hipaa: ["§164.312(e)(1)"],
      gdpr: ["Art.32(1)(a)"],
    },
  },
  {
    id: "data.no-public-storage",
    title: "No publicly-accessible object storage",
    requirement: "No S3 bucket is public via ACL, policy, or a missing public-access block.",
    domain: "data-protection",
    assessKey: "publicStorage",
    appliesTo: ["aws.s3.bucket"],
    notAssessableReason:
      "Atlas does not yet crawl S3 public-access-block / bucket ACL / policy. Connector gap (Security Phase 2b).",
    mappings: {
      pci: ["1.3.1", "7.2.1"],
      cis: ["2.1.5", "S3.1", "S3.2"],
      nist: ["AC-3", "SC-7"],
      iso: ["A.13.1.3"],
      hipaa: ["§164.312(a)(1)"],
      gdpr: ["Art.32(1)(b)"],
    },
  },
  {
    id: "logging.audit-trail",
    title: "Audit logging enabled",
    requirement:
      "Account-wide audit logging (CloudTrail) and network flow logs are enabled and retained.",
    domain: "logging",
    assessKey: "auditLogging",
    notAssessableReason:
      "Atlas crawls log GROUPS but not CloudTrail/flow-log enablement or retention. Connector gap.",
    mappings: {
      pci: ["10.2.1", "10.3.1"],
      cis: ["3.1", "3.5"],
      nist: ["AU-2", "AU-12"],
      iso: ["A.12.4.1"],
      hipaa: ["§164.312(b)"],
    },
  },
  {
    id: "access.mfa-privileged",
    title: "MFA on root and privileged accounts",
    requirement: "The account root user and privileged IAM users have MFA enabled.",
    domain: "access",
    assessKey: "iamCredentials",
    notAssessableReason:
      "Atlas does not yet crawl IAM credential report / MFA / root usage. Connector gap.",
    mappings: {
      pci: ["8.4.2", "8.5.1"],
      cis: ["1.5", "1.6", "1.10"],
      nist: ["IA-2", "IA-2(1)"],
      iso: ["A.9.4.2"],
      hipaa: ["§164.312(d)"],
    },
  },
];

/** Evidence Atlas already computed for a finding (the failing resources), passed through to a control. */
export interface EvidenceRef {
  id: string;
  label: string;
}

/** Everything the evaluator needs, gathered by the API from the graph (no API types leak in here). */
export interface ComplianceFacts {
  /** Open findings by id → their failure evidence (a control fails when its findingId is present). */
  openFindings: Record<string, { count: number; detail: string; evidence: EvidenceRef[] }>;
  /** Node-kind → count in the estate, for applicability (0 relevant resources → not-applicable). */
  inventory: Record<string, number>;
  /** Capability → whether Atlas currently crawls what the control needs (false → not-assessable). */
  assessable: Record<string, boolean>;
}

export type ControlSeverity = "high" | "medium" | "low";

/** Risk weight per control — used to prioritise what to fix (and to weight the coverage headline),
 *  so a world-open SG or a reachable vuln outranks a missing CI gate. Independent of pass/fail. */
const CONTROL_SEVERITY: Record<string, ControlSeverity> = {
  "net.no-world-open-ingress": "high",
  "net.lb-scheme-intentional": "medium",
  "iam.no-wildcard": "high",
  "vuln.no-known-critical": "high",
  "vuln.no-reachable": "high",
  "resilience.prod-db-multi-az": "medium",
  "sdlc.ci-gate": "low",
  "crypto.at-rest": "high",
  "crypto.in-transit": "high",
  "data.no-public-storage": "high",
  "logging.audit-trail": "medium",
  "access.mfa-privileged": "high",
};

export interface ControlResult {
  control: Control;
  status: ControlStatus;
  severity: ControlSeverity;
  detail: string;
  count: number;
  evidence: EvidenceRef[];
}

function appliesInEstate(control: Control, inventory: Record<string, number>): boolean {
  if (!control.appliesTo || control.appliesTo.length === 0) return true;
  return control.appliesTo.some((k) => (inventory[k] ?? 0) > 0);
}

/** Pure: evaluate every control against the gathered facts. Deterministic and order-stable. */
export function evaluateControls(facts: ComplianceFacts): ControlResult[] {
  return CONTROLS.map((control): ControlResult => {
    const severity = CONTROL_SEVERITY[control.id] ?? "medium";
    const base = { control, severity };
    if (!facts.assessable[control.assessKey]) {
      return {
        ...base,
        status: "not-assessable",
        detail:
          control.notAssessableReason ?? "Atlas does not yet crawl the data this control needs.",
        count: 0,
        evidence: [],
      };
    }
    if (!appliesInEstate(control, facts.inventory)) {
      return {
        ...base,
        status: "not-applicable",
        detail: "No resources of the relevant type in this estate.",
        count: 0,
        evidence: [],
      };
    }
    const finding = control.findingId ? facts.openFindings[control.findingId] : undefined;
    if (finding) {
      return {
        ...base,
        status: "fail",
        detail: finding.detail,
        count: finding.count,
        evidence: finding.evidence,
      };
    }
    return { ...base, status: "pass", detail: "No violations found.", count: 0, evidence: [] };
  });
}

export interface FrameworkSummary {
  framework: FrameworkMeta;
  /** Controls Atlas maps to this framework, with their evaluated status. */
  results: ControlResult[];
  passed: number;
  failed: number;
  /** High-severity failures — the "fix these first" count that leads the UI (not the raw pass rate). */
  highFails: number;
  notAssessable: number;
  notApplicable: number;
  /** Assessable = pass + fail (the controls we could actually judge). */
  assessed: number;
  /** pass / assessed, or null when nothing was assessable. */
  passRate: number | null;
}

/** Group evaluated controls per framework and compute honest coverage (assessed vs. not). */
export function summarizeByFramework(results: ControlResult[]): FrameworkSummary[] {
  return FRAMEWORKS.map((framework) => {
    const rs = results.filter((r) => r.control.mappings[framework.key]?.length);
    const passed = rs.filter((r) => r.status === "pass").length;
    const failed = rs.filter((r) => r.status === "fail").length;
    const highFails = rs.filter((r) => r.status === "fail" && r.severity === "high").length;
    const notAssessable = rs.filter((r) => r.status === "not-assessable").length;
    const notApplicable = rs.filter((r) => r.status === "not-applicable").length;
    const assessed = passed + failed;
    return {
      framework,
      results: rs,
      passed,
      failed,
      highFails,
      notAssessable,
      notApplicable,
      assessed,
      passRate: assessed > 0 ? passed / assessed : null,
    };
  });
}
