"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Boxes, Cloud, Github, Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/ui/code-block";
import { Steps, Step } from "@/components/patterns/steps";
import { seedDemo } from "@/lib/browser-api";

/**
 * Onboarding / first-run empty state (P1.2, docs/09 §8). The graph is empty, so this is
 * the org's front door. Two paths:
 *   1. **Load sample data** — one click seeds the "Shopyard" estate via the real pipeline
 *      so the user is exploring a cited graph in seconds (TTFI < 30 min, NFR-22). No creds.
 *   2. **Connect a real source** — AWS (read-only IAM role) or GitHub (App install) setup
 *      instructions with copy-ready policy/config (docs/13 §4–5). Live verification needs
 *      customer creds (deferral ledger), so sample data is the recommended quick start.
 *
 * Composed from the design-system primitives (Steps, CodeBlock, Card, Button, Tabs) so the
 * pattern is repeatable across surfaces. Mono B&W theme; the only hue is semantic status.
 */
export function Onboarding({ orgId, canSeed }: { orgId: string; canSeed: boolean }) {
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <header className="space-y-2 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Boxes className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Build your knowledge graph</h1>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground">
          Atlas turns your infrastructure and code into one continuously-updated, cited graph you
          can explore, search, and ask questions about. Start with sample data now, or connect a
          real source.
        </p>
      </header>

      <SampleDataCard orgId={orgId} canSeed={canSeed} />

      <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or connect a real source
          <span className="h-px flex-1 bg-border" />
        </div>
        <ConnectSource />
      </div>
    </div>
  );
}

function SampleDataCard({ orgId, canSeed }: { orgId: string; canSeed: boolean }) {
  const router = useRouter();
  const [state, setState] = React.useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setState("loading");
    setError(null);
    try {
      await seedDemo(orgId);
      // The dashboard is a server component — refresh re-renders it with the seeded graph.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  }

  return (
    <Card className="border-foreground/20 bg-muted/30">
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-foreground text-background">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="font-medium">Load sample data</p>
            <p className="mt-0.5 max-w-md text-sm text-muted-foreground">
              Seed a realistic e-commerce estate (services, databases, repos, deploys) built through
              the real ingest &amp; inference pipeline. Explore it immediately — no credentials
              needed.
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0">
          {canSeed ? (
            <Button
              onClick={() => void load()}
              disabled={state === "loading"}
              className="w-full sm:w-auto"
            >
              {state === "loading" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Building graph…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Load sample data
                </>
              )}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground sm:text-right">
              Ask an organization admin to load sample data.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectSource() {
  return (
    <Card>
      <CardContent className="p-6">
        <Tabs defaultValue="aws">
          <TabsList className="grid w-full max-w-xs grid-cols-2">
            <TabsTrigger value="aws">
              <Cloud className="mr-1.5 size-4" /> AWS
            </TabsTrigger>
            <TabsTrigger value="github">
              <Github className="mr-1.5 size-4" /> GitHub
            </TabsTrigger>
          </TabsList>

          <TabsContent value="aws" className="pt-4">
            <AwsInstructions />
          </TabsContent>
          <TabsContent value="github" className="pt-4">
            <GithubInstructions />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

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

function AwsInstructions() {
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
      <p className="text-xs text-muted-foreground">
        Live verification needs a real AWS role. If you&apos;re just evaluating Atlas, load the
        sample data above instead.
      </p>
    </div>
  );
}

function GithubInstructions() {
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
      <p className="text-xs text-muted-foreground">
        Live indexing needs an App installation. If you&apos;re just evaluating Atlas, load the
        sample data above instead.
      </p>
    </div>
  );
}
