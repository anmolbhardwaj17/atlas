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

const AZURE_ROLE = `# Create a read-only service principal scoped to the subscription:
az ad sp create-for-rbac \\
  --name "atlas-reader" \\
  --role "Reader" \\
  --scopes "/subscriptions/<SUBSCRIPTION_ID>"
# Reader is a built-in role — describe/list only, no mutating actions.`;

export function AzureSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Create a read-only service principal">
          In Microsoft Entra ID, register an app / service principal for Atlas and assign it the
          built-in <InlineCode>Reader</InlineCode> role at the subscription scope — read-only by
          construction.
        </Step>
        <Step title="Grant Atlas the tenant, client &amp; subscription IDs">
          Atlas authenticates with the client ID + a secret (or a federated credential), scoped to
          the subscriptions you choose. It never gets write access.
        </Step>
        <Step title="Verify">
          Atlas runs a permission probe and reports any missing read scope as a fixable gap.
        </Step>
      </Steps>
      <CodeBlock label="Least-privilege role (az CLI)" code={AZURE_ROLE} />
    </div>
  );
}

const GCP_ROLE = `# Create a read-only service account and grant Viewer on the project:
gcloud iam service-accounts create atlas-reader \\
  --display-name "Atlas (read-only)"
gcloud projects add-iam-policy-binding <PROJECT_ID> \\
  --member "serviceAccount:atlas-reader@<PROJECT_ID>.iam.gserviceaccount.com" \\
  --role "roles/viewer"
# roles/viewer is read-only across the project.`;

export function GcpSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Create a read-only service account">
          In the GCP project, create a service account for Atlas and grant it{" "}
          <InlineCode>roles/viewer</InlineCode> — a project-wide read-only role.
        </Step>
        <Step title="Connect it (key or workload identity)">
          Atlas authenticates as the service account (a key, or keyless workload-identity
          federation). No write roles are ever requested.
        </Step>
        <Step title="Verify">
          Atlas probes the granted roles and reports any missing read permission as a fixable gap.
        </Step>
      </Steps>
      <CodeBlock label="Least-privilege role (gcloud)" code={GCP_ROLE} />
    </div>
  );
}

const BITBUCKET_SCOPES = `account: read
repository: read
pullrequest: read
pipeline: read`;

export function BitbucketSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Create a read-only App password">
          In your Bitbucket workspace settings, create an App password for Atlas with only the{" "}
          <InlineCode>read</InlineCode> scopes below (or install the Atlas OAuth app).
        </Step>
        <Step title="Atlas indexes structure, not code">
          From each repo Atlas reads ownership, dependency manifests, and Pipelines (deploy targets)
          — enough to connect code to the infrastructure it ships to, without storing your source.
        </Step>
        <Step title="Confirm the workspace">
          Back in Atlas, confirm the workspace. The graph fills in as the first sync runs.
        </Step>
      </Steps>
      <CodeBlock label="Required read scopes" code={BITBUCKET_SCOPES} />
    </div>
  );
}
