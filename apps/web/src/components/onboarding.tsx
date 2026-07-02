"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Boxes, Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CloudIcon } from "@/components/cloud-icon";
import {
  AwsSetup,
  GithubSetup,
  AzureSetup,
  GcpSetup,
  BitbucketSetup,
} from "@/components/integrations/provider-setup";
import { seedDemo } from "@/lib/browser-api";

/**
 * Onboarding / first-run empty state (P1.2, docs/09 §8). The graph is empty, so this is
 * the org's front door. Two paths:
 *   1. **Load sample data** - one click seeds the "Shopyard" estate via the real pipeline
 *      so the user is exploring a cited graph in seconds (TTFI < 30 min, NFR-22). No creds.
 *   2. **Connect a real source** - AWS / GitHub / Bitbucket / Azure / GCP read-only setup
 *      instructions with copy-ready policy/config (docs/13 §4-5), shared with the Integrations
 *      hub. Live verification needs customer creds, so sample data is the recommended quick start.
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
      // The dashboard is a server component - refresh re-renders it with the seeded graph.
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
              the real ingest &amp; inference pipeline. Explore it immediately - no credentials
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
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5">
            <TabsTrigger value="aws">
              <CloudIcon name="aws" className="mr-1.5 size-4" /> AWS
            </TabsTrigger>
            <TabsTrigger value="github">
              <CloudIcon name="github-icon" className="mr-1.5 size-4" /> GitHub
            </TabsTrigger>
            <TabsTrigger value="bitbucket">
              <CloudIcon name="bitbucket" className="mr-1.5 size-4" /> Bitbucket
            </TabsTrigger>
            <TabsTrigger value="azure">
              <CloudIcon name="microsoft-azure" className="mr-1.5 size-4" /> Azure
            </TabsTrigger>
            <TabsTrigger value="gcp">
              <CloudIcon name="google-cloud" className="mr-1.5 size-4" /> GCP
            </TabsTrigger>
          </TabsList>

          <TabsContent value="aws" className="pt-4">
            <AwsSetup />
          </TabsContent>
          <TabsContent value="github" className="pt-4">
            <GithubSetup />
          </TabsContent>
          <TabsContent value="bitbucket" className="pt-4">
            <BitbucketSetup />
          </TabsContent>
          <TabsContent value="azure" className="pt-4">
            <AzureSetup />
          </TabsContent>
          <TabsContent value="gcp" className="pt-4">
            <GcpSetup />
          </TabsContent>
        </Tabs>
        <p className="mt-4 text-xs text-muted-foreground">
          Live verification needs real credentials. Just evaluating? Load the sample data above.
          Full setup lives on the <span className="font-medium text-foreground">Integrations</span>{" "}
          page.
        </p>
      </CardContent>
    </Card>
  );
}
