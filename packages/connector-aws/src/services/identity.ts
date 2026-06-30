/**
 * IAM role module (docs/06 §4). IAM is crawled ONLY to derive edges — roles are the
 * target of ASSUMES_ROLE and their policy statements feed the R8 access inference
 * (docs/05 §6.4) — never a first-class browsable resource (docs/06 §4 note, NG6). IAM
 * is global-scoped. Policy documents are sensitive (docs/13 AWR-7): only the structured
 * statements needed for inference are emitted as a signal, not raw secrets.
 */
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";

interface PolicyStatement {
  Effect?: string;
  Action?: string | string[];
  Resource?: string | string[];
}
interface IamRole {
  RoleName: string;
  Arn?: string;
  Path?: string;
  /** Resolved at fetch-detail: flattened inline + attached policy statements. */
  PolicyStatements?: PolicyStatement[];
}

export const iamRoleModule: ServiceModule<IamRole> = {
  kind: "aws.iam.role",
  service: "iam",
  scope: "global",
  normalize({ account, data }) {
    return {
      urn: awsUrn("aws.iam.role", { account, naturalKey: data.RoleName }),
      kind: "aws.iam.role",
      displayName: data.RoleName,
      attributes: {
        region: "global",
        accountRef: account,
        roleName: data.RoleName,
        path: data.Path,
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals({ account, data }) {
    const statements = data.PolicyStatements ?? [];
    if (statements.length === 0) return [];
    const subjectUrn = awsUrn("aws.iam.role", { account, naturalKey: data.RoleName });
    return [
      {
        kind: "aws.iam.policy_statements",
        subjectUrn,
        data: {
          statements: statements.map((s) => ({
            effect: s.Effect,
            actions: toArray(s.Action),
            resources: toArray(s.Resource),
          })),
        },
      },
    ];
  },
};

function toArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
