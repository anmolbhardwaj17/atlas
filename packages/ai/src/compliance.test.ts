import { describe, expect, it } from "vitest";
import {
  CONTROLS,
  FRAMEWORKS,
  evaluateControls,
  summarizeByFramework,
  type ComplianceFacts,
} from "./compliance";

const baseFacts = (over: Partial<ComplianceFacts> = {}): ComplianceFacts => ({
  openFindings: {},
  inventory: {
    "aws.securitygroup": 6,
    "aws.elb": 2,
    "aws.iam.role": 4,
    "aws.rds.instance": 2,
    "external.package": 300,
    "bitbucket.repository": 56,
    "aws.s3.bucket": 9,
    "aws.dynamodb.table": 0,
  },
  assessable: {
    network: true,
    iamPolicy: true,
    vulns: true,
    multiAz: true,
    publicDatabase: true,
    ciPipeline: true,
    encryptionAtRest: false,
    encryptionInTransit: false,
    publicStorage: false,
    auditLogging: false,
    iamCredentials: false,
  },
  ...over,
});

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`expected ${what}`);
  return v;
}
const byId = (rs: ReturnType<typeof evaluateControls>, id: string) =>
  must(
    rs.find((r) => r.control.id === id),
    id,
  );

describe("compliance evaluation", () => {
  it("passes an assessable control with no backing finding", () => {
    const rs = evaluateControls(baseFacts());
    expect(byId(rs, "net.no-world-open-ingress").status).toBe("pass");
  });

  it("fails a control when its backing finding is open, carrying the evidence", () => {
    const rs = evaluateControls(
      baseFacts({
        openFindings: {
          "sg-world-open": {
            count: 2,
            detail: "sg-web (port 22); sg-db (port 5432)",
            evidence: [{ id: "n1", label: "sg-web" }],
          },
        },
      }),
    );
    const c = byId(rs, "net.no-world-open-ingress");
    expect(c.status).toBe("fail");
    expect(c.count).toBe(2);
    expect(c.evidence).toHaveLength(1);
  });

  it("marks a control not-assessable when Atlas doesn't crawl the data (never a silent pass)", () => {
    const rs = evaluateControls(baseFacts());
    expect(byId(rs, "crypto.at-rest").status).toBe("not-assessable");
    expect(byId(rs, "data.no-public-storage").status).toBe("not-assessable");
    expect(byId(rs, "access.mfa-privileged").status).toBe("not-assessable");
  });

  it("marks a control not-applicable when the estate has no such resource", () => {
    const rs = evaluateControls(baseFacts({ inventory: { "aws.rds.instance": 0 } }));
    expect(byId(rs, "resilience.prod-db-multi-az").status).toBe("not-applicable");
  });

  it("summarizes per framework: assessed = pass+fail, pass rate excludes not-assessable/NA", () => {
    const summary = summarizeByFramework(
      evaluateControls(
        baseFacts({
          openFindings: {
            "iam-wildcard": {
              count: 1,
              detail: "AdminRole",
              evidence: [{ id: "r", label: "AdminRole" }],
            },
          },
        }),
      ),
    );
    const pci = must(
      summary.find((s) => s.framework.key === "pci"),
      "pci summary",
    );
    // PCI maps to several controls; at least the wildcard one fails, and encryption/public/MFA are
    // not-assessable — so assessed < total and the pass rate ignores the unknowns.
    expect(pci.failed).toBeGreaterThanOrEqual(1);
    expect(pci.notAssessable).toBeGreaterThanOrEqual(1);
    expect(pci.assessed).toBe(pci.passed + pci.failed);
    expect(pci.passRate).not.toBeNull();
  });

  it("data.no-public-database: pass when clean, fail on the rds-public finding, NA without RDS", () => {
    // Assessable + no open finding → pass.
    expect(byId(evaluateControls(baseFacts()), "data.no-public-database").status).toBe("pass");
    // The rds-public posture finding is open → the control fails and carries the evidence.
    const failed = byId(
      evaluateControls(
        baseFacts({
          openFindings: {
            "rds-public": {
              count: 1,
              detail: "orders-prod",
              evidence: [{ id: "db1", label: "orders-prod" }],
            },
          },
        }),
      ),
      "data.no-public-database",
    );
    expect(failed.status).toBe("fail");
    expect(failed.evidence).toHaveLength(1);
    // No RDS in the estate → not-applicable (never a silent pass).
    expect(
      byId(
        evaluateControls(baseFacts({ inventory: { "aws.rds.instance": 0 } })),
        "data.no-public-database",
      ).status,
    ).toBe("not-applicable");
  });

  it("every control maps to at least one framework, and every framework has ≥1 control", () => {
    for (const c of CONTROLS) {
      expect(Object.values(c.mappings).some((v) => v && v.length > 0)).toBe(true);
    }
    const summary = summarizeByFramework(evaluateControls(baseFacts()));
    for (const fw of FRAMEWORKS) {
      expect(
        must(
          summary.find((s) => s.framework.key === fw.key),
          fw.key,
        ).results.length,
      ).toBeGreaterThan(0);
    }
  });
});
