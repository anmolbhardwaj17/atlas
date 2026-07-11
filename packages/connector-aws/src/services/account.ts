/**
 * AWS account node (Security Phase 2b) — one node per account carrying account-level security posture
 * that no single resource owns: root-user MFA, root access keys, and the password policy. Compliance
 * controls (root MFA, password policy) read these attributes; a finding fires when root MFA is off.
 */
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";

interface AccountData {
  accountId: string;
  summaryMap: Record<string, number>;
  passwordPolicy: Record<string, unknown> | null;
  passwordPolicyKnown: boolean;
  cloudTrailMultiRegion?: boolean | null;
}

export const accountModule: ServiceModule<AccountData> = {
  kind: "aws.account",
  service: "iam-account",
  scope: "global",
  normalize({ account, data }) {
    const s = data.summaryMap ?? {};
    return {
      urn: awsUrn("aws.account", { account, naturalKey: account }),
      kind: "aws.account",
      displayName: `AWS account ${account}`,
      attributes: {
        region: "global",
        accountRef: account,
        accountId: data.accountId,
        // GetAccountSummary → AccountMFAEnabled is 1 when the ROOT user has MFA; access keys present
        // on root is a classic CIS finding.
        rootMfaEnabled: s.AccountMFAEnabled === 1,
        rootAccessKeys: (s.AccountAccessKeysPresent ?? 0) > 0,
        users: s.Users ?? null,
        mfaDevices: s.MFADevices ?? null,
        // true = a policy is set, false = none configured, null = we couldn't read it (denied).
        passwordPolicySet: data.passwordPolicyKnown ? data.passwordPolicy !== null : null,
        passwordPolicy: data.passwordPolicy,
        // true = a multi-region CloudTrail is actively logging; false = none; null = couldn't read.
        cloudTrailEnabled: data.cloudTrailMultiRegion ?? null,
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};
