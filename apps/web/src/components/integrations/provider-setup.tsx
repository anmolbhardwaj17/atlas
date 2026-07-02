import * as React from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { Steps, Step } from "@/components/patterns/steps";

/**
 * Provider connect instructions (docs/13 §4–5), shared by the onboarding wizard and the
 * Integrations hub so the guidance stays in one place. Read-only scopes only, by design.
 */

const AWS_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AtlasReadOnlyCore",
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*", "lambda:List*", "lambda:GetFunctionConfiguration",
        "ecs:List*", "ecs:Describe*", "ecr:DescribeRepositories",
        "elasticloadbalancing:Describe*", "route53:List*", "route53:Get*",
        "rds:Describe*", "dynamodb:List*", "dynamodb:DescribeTable",
        "s3:ListAllMyBuckets", "s3:GetBucketLocation", "s3:GetBucketTagging",
        "elasticache:Describe*",
        "iam:GetRole", "iam:ListRolePolicies", "iam:GetRolePolicy",
        "iam:ListAttachedRolePolicies", "iam:GetPolicy", "iam:GetPolicyVersion"
      ],
      "Resource": "*"
    }
  ]
}`;

const GITHUB_PERMS = `metadata: read
contents: read
pull_requests: read
actions: read
members: read`;

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>;
}

export function AwsSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Create a read-only IAM role">
          In the AWS console, create an IAM role that Atlas assumes. It grants only{" "}
          <InlineCode>Describe*</InlineCode> / <InlineCode>List*</InlineCode> /{" "}
          <InlineCode>Get*</InlineCode> — no mutating actions exist in the policy, so Atlas is
          read-only by construction.
        </Step>
        <Step title="Trust Atlas with your External ID">
          Set the role&apos;s trust policy to allow Atlas&apos;s principal, conditioned on your
          unique <strong>External ID</strong> (confused-deputy defense). Atlas generates the
          External ID when you add the connection.
        </Step>
        <Step title="Paste the Role ARN and verify">
          Back in Atlas, paste the role ARN. Atlas runs a live permission probe — a missing
          permission is reported as a fixable gap, never a silent failure.
        </Step>
      </Steps>
      <CodeBlock label="Least-privilege policy" code={AWS_POLICY} />
    </div>
  );
}

export function GithubSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Install the Atlas GitHub App">
          Install the Atlas App on your organization and select the repositories to index. Atlas
          requests read-only scopes only.
        </Step>
        <Step title="Atlas indexes structure, not code">
          From each repo Atlas reads CODEOWNERS (ownership), dependency manifests (packages), and
          workflows (deploy targets) — enough to connect code to the infrastructure it ships to,
          without storing your source.
        </Step>
        <Step title="Confirm the installation">
          Back in Atlas, confirm the installation. The graph fills in as the first sync runs.
        </Step>
      </Steps>
      <CodeBlock label="Required read permissions" code={GITHUB_PERMS} />
    </div>
  );
}
