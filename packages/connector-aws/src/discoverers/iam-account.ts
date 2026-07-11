/**
 * IAM account-security discoverer (global) — Security Phase 2b. Reads account-level security posture
 * that isn't attached to any single resource: root-user MFA + root access keys (GetAccountSummary)
 * and the account password policy (GetAccountPasswordPolicy). Emits ONE `aws.account` node carrying
 * these as attributes, so compliance controls (root MFA, password policy) can key off it. Read-only.
 *
 * Its own `service`/`iamAction` means the verify/health probe surfaces a missing
 * `iam:GetAccountSummary` as a precise "grant this" on the Integrations hub + Compliance page.
 */
import {
  IAMClient,
  GetAccountSummaryCommand,
  GetAccountPasswordPolicyCommand,
} from "@aws-sdk/client-iam";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";
import { classifyAwsError } from "../aws/retry";

export const iamAccountDiscoverer: Discoverer = {
  service: "iam-account",
  scope: "global",
  kind: "aws.account",
  iamAction: "iam:GetAccountSummary",
  async *crawl(input) {
    const client = new IAMClient(clientConfig(input.credentials, input.region));
    // Root MFA + access keys + user/MFA counts. A denial here propagates → recorded as the missing
    // action by the probe (this is the discoverer's declared iamAction).
    const summary = await client.send(new GetAccountSummaryCommand({}));

    // Password policy is best-effort: NoSuchEntity means "no policy set" (itself a finding), and a
    // denial of iam:GetAccountPasswordPolicy shouldn't fail the whole account crawl.
    let passwordPolicy: Record<string, unknown> | null = null;
    let passwordPolicyKnown = true;
    try {
      const pp = await client.send(new GetAccountPasswordPolicyCommand({}));
      passwordPolicy = (pp.PasswordPolicy as Record<string, unknown> | undefined) ?? null;
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      if (/NoSuchEntity/i.test(name))
        passwordPolicy = null; // no policy configured
      else if (classifyAwsError(err) === "access-denied") passwordPolicyKnown = false;
      else throw err;
    }

    yield emit(iamAccountDiscoverer, input, input.account, {
      accountId: input.account,
      summaryMap: summary.SummaryMap ?? {},
      passwordPolicy,
      passwordPolicyKnown,
    });
  },
};
