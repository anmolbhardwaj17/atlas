import * as React from "react";
import { Lock } from "lucide-react";
import { CodeBlock } from "@/components/ui/code-block";
import { Steps, Step } from "@/components/patterns/steps";

/**
 * Provider connect instructions (docs/13 §4-5), shared by the onboarding wizard and the
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
        <Step title="Create a read-only IAM user">
          In the AWS console, create (or reuse) an IAM user for Atlas and attach a read-only policy
          - the least-privilege one below, or an AWS-managed policy like{" "}
          <InlineCode>ReadOnlyAccess</InlineCode> / <InlineCode>SecurityAudit</InlineCode>. Only{" "}
          <InlineCode>Describe*</InlineCode> / <InlineCode>List*</InlineCode> /{" "}
          <InlineCode>Get*</InlineCode> - read-only by construction.
        </Step>
        <Step title="Create an access key">
          On that user, create an access key (<strong>Access Key ID</strong> +{" "}
          <strong>Secret Access Key</strong>). Copy them now - AWS shows the secret only once.
        </Step>
        <Step title="Paste the keys + regions and verify">
          Back in Atlas, enter the keys and the regions to crawl. Atlas stores them encrypted, then
          runs a live permission probe - a missing permission is reported as a fixable gap, never a
          silent failure.
        </Step>
      </Steps>
      <p className="text-xs text-muted-foreground">
        Tip: an assumable read-only role is more secure than long-lived keys - if your team prefers
        that, use a role whose access keys rotate, or reach out to switch this connection to role
        auth.
      </p>
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
          workflows (deploy targets) - enough to connect code to the infrastructure it ships to,
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
# Reader is a built-in role - describe/list only, no mutating actions.`;

export function AzureSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Create a read-only service principal">
          In Microsoft Entra ID, register an app / service principal for Atlas and assign it the
          built-in <InlineCode>Reader</InlineCode> role at the subscription scope - read-only by
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
          <InlineCode>roles/viewer</InlineCode> - a project-wide read-only role.
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

const BITBUCKET_SCOPES = `read:account
read:workspace:bitbucket
read:repository:bitbucket
read:pullrequest:bitbucket
read:pipeline:bitbucket`;

export function JenkinsSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Generate a Jenkins API token">
          Click your name (top-right) → <strong>Security</strong> → <strong>API Token</strong> →{" "}
          <InlineCode>Add new Token</InlineCode> → <strong>Generate</strong>, then copy it (Jenkins
          shows it only once). For least privilege, use a user with only{" "}
          <InlineCode>Overall/Read</InlineCode> + <InlineCode>Job/Read</InlineCode> — no
          Build/Configure needed.
        </Step>
        <Step title="Give Atlas the server URL, username + token">
          Atlas reaches your Jenkins over HTTPS with the username + API token — read-only, it never
          triggers builds.
        </Step>
        <Step title="Atlas links deploys to infrastructure">
          From each job's pipeline Atlas reads its deploy targets (ECR pushes,{" "}
          <InlineCode>aws ecs</InlineCode>/<InlineCode>lambda</InlineCode>) and connects{" "}
          <em>what ships</em> to the running services it deploys — closing the loop from a PR to
          production.
        </Step>
      </Steps>
      <div className="rounded-md border border-warning/30 bg-warning/5 p-3.5">
        <p className="flex items-center gap-2 text-sm font-medium text-warning">
          <Lock className="size-4 shrink-0" />
          Private Jenkins? Allowlist Atlas first
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Behind a VPN or firewall? Atlas can&apos;t reach it until you allowlist its outbound IP.
          Save now — your token stays stored — then hit <strong>Re-verify</strong> once that&apos;s
          done.
        </p>
      </div>
    </div>
  );
}

export function SlackSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Create an Incoming Webhook">
          In Slack, open <strong>Apps</strong> and add <InlineCode>Incoming Webhooks</InlineCode>.
          Pick the channel Atlas should post to (e.g. <InlineCode>#alerts</InlineCode>) and copy the
          generated webhook URL.
        </Step>
        <Step title="Paste the webhook into Atlas">
          Atlas only ever <strong>posts</strong> messages to that URL - it&apos;s write-only and
          never reads your workspace. The URL is stored encrypted and never shown again.
        </Step>
        <Step title="What Atlas sends">
          A heads-up the moment a resource breaks, recovers, or gets exposed - plus a short daily
          digest of what changed. Send a test after connecting to see it land.
        </Step>
      </Steps>
    </div>
  );
}

export function DiscordSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Create a webhook">
          In your Discord server, go to <strong>Server Settings → Integrations → Webhooks</strong>,
          choose <InlineCode>New Webhook</InlineCode>, select the channel, and{" "}
          <InlineCode>Copy Webhook URL</InlineCode>.
        </Step>
        <Step title="Paste the webhook into Atlas">
          Atlas only <strong>posts</strong> to that URL - write-only, stored encrypted, and never
          shown again.
        </Step>
        <Step title="What Atlas sends">
          A heads-up when a resource breaks, recovers, or gets exposed - plus a short daily digest.
          Send a test after connecting to confirm it works.
        </Step>
      </Steps>
    </div>
  );
}

export function TeamsSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Add an Incoming Webhook connector">
          In the target channel, open <strong>⋯ → Connectors</strong> (or <strong>Workflows</strong>
          ), pick <InlineCode>Incoming Webhook</InlineCode>, name it &quot;Atlas&quot;, create it,
          and copy the URL.
        </Step>
        <Step title="Paste the webhook into Atlas">
          Atlas only <strong>posts</strong> to that URL - write-only, stored encrypted, and never
          shown again.
        </Step>
        <Step title="What Atlas sends">
          A heads-up when a resource breaks, recovers, or gets exposed - plus a short daily digest.
          Send a test after connecting to confirm it works.
        </Step>
      </Steps>
    </div>
  );
}

export function BitbucketSetup() {
  return (
    <div className="space-y-5">
      <Steps>
        <Step title="Create a read-only API token with scopes">
          In your Atlassian account → <strong>Security → API tokens</strong>, choose{" "}
          <InlineCode>Create API token with scopes</InlineCode> (App passwords are deprecated),
          select <strong>Bitbucket</strong>, and grant only the <InlineCode>read</InlineCode> scopes
          below.
        </Step>
        <Step title="Give Atlas your email + the token">
          Atlas authenticates with your Atlassian <strong>account email</strong> as the username and
          the <strong>API token</strong> as the password (read-only - it never gets write access).
        </Step>
        <Step title="Atlas indexes structure, not code">
          From each repo Atlas reads ownership, dependency manifests, and Pipelines (deploy targets)
          - enough to connect code to the infrastructure it ships to, without storing your source.
        </Step>
      </Steps>
      <CodeBlock label="Required read scopes" code={BITBUCKET_SCOPES} />
    </div>
  );
}
