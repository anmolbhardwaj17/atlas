/**
 * IAM role discoverer (global). Crawled ONLY to derive edges (docs/06 §4 note): lists
 * roles and attaches their inline policy statements for the R8 access inference. MVP is
 * coarse (OQ-AWS-3): inline policies only; managed-policy expansion is additive. Policy
 * docs are sensitive (docs/13 AWR-7) — only structured statements are emitted, downstream.
 */
import {
  IAMClient,
  paginateListRoles,
  ListRolePoliciesCommand,
  GetRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";

interface Statement {
  Effect?: string;
  Action?: string | string[];
  Resource?: string | string[];
}

/** GetRolePolicy returns a URL-encoded JSON policy document. */
function parsePolicyDocument(doc: string | undefined): Statement[] {
  if (!doc) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(doc)) as { Statement?: Statement | Statement[] };
    const s = parsed.Statement;
    return s ? (Array.isArray(s) ? s : [s]) : [];
  } catch {
    return [];
  }
}

export const iamRoleDiscoverer: Discoverer = {
  service: "iam",
  scope: "global",
  kind: "aws.iam.role",
  iamAction: "iam:ListRoles",
  async *crawl(input) {
    const client = new IAMClient(clientConfig(input.credentials, input.region));
    for await (const page of paginateListRoles({ client }, {})) {
      for (const role of page.Roles ?? []) {
        if (!role.RoleName) continue;
        const statements: Statement[] = [];
        const names = await client.send(new ListRolePoliciesCommand({ RoleName: role.RoleName }));
        for (const policyName of names.PolicyNames ?? []) {
          const p = await client.send(
            new GetRolePolicyCommand({ RoleName: role.RoleName, PolicyName: policyName }),
          );
          statements.push(...parsePolicyDocument(p.PolicyDocument));
        }
        yield emit(this, input, role.RoleName, {
          RoleName: role.RoleName,
          Arn: role.Arn,
          Path: role.Path,
          PolicyStatements: statements,
        });
      }
    }
  },
};
