"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/certainty";
import { CloudIcon } from "@/components/cloud-icon";
import {
  AwsSetup,
  GithubSetup,
  AzureSetup,
  GcpSetup,
  BitbucketSetup,
} from "@/components/integrations/provider-setup";
import { PROVIDERS, type ProviderMeta } from "@/components/integrations/providers";
import {
  createConnection,
  verifyConnection,
  deleteConnection,
  triggerSync,
  type ConnectionSummary,
} from "@/lib/browser-api";
import { cn } from "@/lib/cn";

/** The right setup steps for each connectable provider. */
function ProviderSetup({ providerId }: { providerId: string }) {
  switch (providerId) {
    case "aws":
      return <AwsSetup />;
    case "azure":
      return <AzureSetup />;
    case "gcp":
      return <GcpSetup />;
    case "bitbucket":
      return <BitbucketSetup />;
    default:
      return <GithubSetup />;
  }
}

const CREDENTIAL_NOUN: Record<string, string> = {
  aws: "role",
  github: "App",
  azure: "service principal",
  gcp: "service account",
  bitbucket: "API token",
};

/**
 * Integrations hub (docs/18) - the one place to connect the company's accounts. A tile per
 * provider (AWS / GitHub / Azure / GCP / Bitbucket connectable; GitLab / Datadog "coming
 * soon"), each showing its connected accounts with status, a guided Connect flow, and
 * disconnect (which purges that source's graph).
 */
export function IntegrationsHub({
  orgId,
  connections,
  canManage,
}: {
  orgId: string;
  connections: ConnectionSummary[];
  canManage: boolean;
}) {
  const [connectProvider, setConnectProvider] = React.useState<ProviderMeta | null>(null);

  const byProvider = new Map<string, ConnectionSummary[]>();
  for (const c of connections) {
    const arr = byProvider.get(c.provider) ?? [];
    arr.push(c);
    byProvider.set(c.provider, arr);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect your cloud, code, and observability accounts. Atlas builds one cited graph across
          everything you connect.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((p) => (
          <ProviderTile
            key={p.id}
            provider={p}
            connections={byProvider.get(p.id) ?? []}
            canManage={canManage}
            orgId={orgId}
            onConnect={() => setConnectProvider(p)}
          />
        ))}
      </div>

      <ConnectSheet
        provider={connectProvider}
        orgId={orgId}
        onClose={() => setConnectProvider(null)}
      />
    </div>
  );
}

function ProviderTile({
  provider,
  connections,
  canManage,
  orgId,
  onConnect,
}: {
  provider: ProviderMeta;
  connections: ConnectionSummary[];
  canManage: boolean;
  orgId: string;
  onConnect: () => void;
}) {
  const comingSoon = provider.status === "coming-soon";
  return (
    <Card className={cn(comingSoon && "opacity-70")}>
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background">
            <CloudIcon name={provider.logo} className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{provider.name}</span>
              {comingSoon && (
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Soon
                </span>
              )}
            </div>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {provider.category}
            </span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{provider.blurb}</p>

        <div className="mt-auto space-y-2">
          {connections.length > 0 && (
            <ul className="space-y-1.5 border-t border-border pt-3">
              {connections.map((c) => (
                <ConnectionRow key={c.id} conn={c} orgId={orgId} canManage={canManage} />
              ))}
            </ul>
          )}

          {comingSoon ? (
            <Button variant="outline" size="sm" className="w-full" disabled>
              Coming soon
            </Button>
          ) : canManage ? (
            <Button size="sm" className="w-full" onClick={onConnect}>
              <Plus className="size-4" />
              {connections.length > 0 ? "Add another" : `Connect ${provider.name.split(" ")[0]}`}
            </Button>
          ) : connections.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ask an admin to connect this source.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Compact relative time for the sync line ("just now", "5m ago", "3h ago", "2d ago"). */
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ConnectionRow({
  conn,
  orgId,
  canManage,
}: {
  conn: ConnectionSummary;
  orgId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [triggering, setTriggering] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const canSync = !conn.demo && (conn.status === "connected" || conn.status === "degraded");
  const syncing = conn.syncing === true;
  const missingPerms = conn.health?.missingPermissions ?? [];

  // While a run is in flight, poll so the row flips to "Last synced…" when it lands.
  React.useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [syncing, router]);

  async function remove() {
    setBusy(true);
    try {
      await deleteConnection(orgId, conn.id);
      setConfirmOpen(false);
      toast.success(`Disconnected ${conn.displayName}`, {
        description: "The source and its data have been removed from your graph.",
      });
      router.refresh();
    } catch (e) {
      toast.error("Couldn't disconnect", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setTriggering(true);
    setNote(null);
    try {
      await triggerSync(orgId, conn.id);
      router.refresh(); // the row's live "Syncing…" state takes over from here
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't start a sync.");
    } finally {
      setTriggering(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">{conn.displayName}</span>
        <span className="flex shrink-0 items-center gap-2">
          {conn.demo ? (
            <span className="rounded-full border border-transparent bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Sample
            </span>
          ) : null}
          <StatusBadge status={conn.status} />
          {canManage && canSync ? (
            <button
              type="button"
              onClick={() => void sync()}
              disabled={triggering || syncing}
              aria-label="Sync now"
              title={syncing ? "Sync in progress" : "Sync now - fetch the latest data"}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", (triggering || syncing) && "animate-spin")} />
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              aria-label="Disconnect"
              title="Disconnect (removes this source's data)"
              className="text-muted-foreground hover:text-danger"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </span>
      </div>
      {syncing ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Syncing - pulling the latest data…
        </span>
      ) : conn.lastSync ? (
        <span
          className={cn(
            "text-xs",
            conn.lastSync.status === "failed" ? "text-danger" : "text-muted-foreground",
          )}
        >
          {conn.lastSync.status === "failed"
            ? `Last sync failed ${timeAgo(conn.lastSync.finishedAt)}`
            : `Last synced ${timeAgo(conn.lastSync.finishedAt)} · ${conn.lastSync.resources} resources`}
          {conn.lastSync.status === "partial" && conn.lastSync.scopesFailed > 0 ? (
            <span className="text-warning">
              {" "}
              · {conn.lastSync.scopesFailed} scope{conn.lastSync.scopesFailed === 1 ? "" : "s"}{" "}
              skipped
            </span>
          ) : null}
        </span>
      ) : null}
      {conn.status === "degraded" && missingPerms.length > 0 ? (
        <span className="text-xs text-warning" title={missingPerms.join(", ")}>
          Missing read access: <span className="font-mono">{missingPerms.join(", ")}</span>
        </span>
      ) : null}
      {note ? <span className="text-xs text-danger">{note}</span> : null}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {conn.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the connection and{" "}
              <strong>purges everything Atlas learned from it</strong> - its resources, edges, and
              signals disappear from your graph, map, and Ask AI answers. Reconnecting later starts
              a fresh sync. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open while the request is in flight
                void remove();
              }}
              disabled={busy}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Disconnecting…
                </>
              ) : (
                "Disconnect"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function ConnectSheet({
  provider,
  orgId,
  onClose,
}: {
  provider: ProviderMeta | null;
  orgId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [workspace, setWorkspace] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [token, setToken] = React.useState("");
  // AWS (static access-key auth): regions to crawl + the IAM user's access key + secret key.
  const [regions, setRegions] = React.useState("us-east-1");
  const [accessKeyId, setAccessKeyId] = React.useState("");
  const [secretAccessKey, setSecretAccessKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Live credential flows: Bitbucket (email + API token) and AWS (access key + secret key).
  const isBitbucket = provider?.id === "bitbucket";
  const isAws = provider?.id === "aws";
  const needsCreds = isBitbucket || isAws;

  // Reset the form whenever a different provider's sheet opens.
  React.useEffect(() => {
    if (provider) {
      setName(`${provider.name.split(" ")[0]} - production`);
      setWorkspace("");
      setEmail("");
      setToken("");
      setRegions("us-east-1");
      setAccessKeyId("");
      setSecretAccessKey("");
      setError(null);
      setBusy(false);
    }
  }, [provider]);

  async function add() {
    if (!provider || name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (isBitbucket) {
        if (!email.trim() || !token.trim()) {
          setError("Enter your Atlassian email and API token.");
          setBusy(false);
          return;
        }
        const config = workspace.trim() ? { workspace: workspace.trim() } : undefined;
        const conn = await createConnection(orgId, provider.id, name.trim(), config);
        const verified = await verifyConnection(orgId, conn.id, {
          email: email.trim(),
          apiToken: token.trim(),
        });
        if (verified.status === "error") {
          setError("Bitbucket rejected the credentials - check the email, token, and its scopes.");
          setBusy(false);
          return;
        }
      } else if (isAws) {
        const regionList = regions
          .split(",")
          .map((r) => r.trim().toLowerCase())
          .filter(Boolean);
        if (regionList.length === 0) {
          setError("Enter at least one AWS region (e.g. us-east-1).");
          setBusy(false);
          return;
        }
        if (!accessKeyId.trim() || !secretAccessKey.trim()) {
          setError("Enter the Access Key ID and Secret Access Key.");
          setBusy(false);
          return;
        }
        // authMode 'keys' → the connector uses the access keys directly (no AssumeRole).
        const conn = await createConnection(orgId, provider.id, name.trim(), {
          authMode: "keys",
          regions: regionList,
        });
        const verified = await verifyConnection(orgId, conn.id, {
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
        });
        if (verified.status === "error") {
          setError(
            "AWS rejected the credentials - check the Access Key ID, Secret Access Key, and that the IAM user has read access.",
          );
          setBusy(false);
          return;
        }
      } else {
        await createConnection(orgId, provider.id, name.trim());
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!provider} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {provider && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background">
                  <CloudIcon name={provider.logo} className="size-5" />
                </span>
                Connect {provider.name}
              </SheetTitle>
              <SheetDescription>
                Follow the steps, then add the connection. Atlas requests read-only access only.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <ProviderSetup providerId={provider.id} />

              <div className="space-y-3 border-t border-border pt-4">
                <div className="space-y-2">
                  <label htmlFor="conn-name" className="text-sm font-medium">
                    Connection name
                  </label>
                  <Input
                    id="conn-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Production account"
                  />
                </div>

                {isBitbucket ? (
                  <>
                    <div className="space-y-2">
                      <label htmlFor="bb-workspace" className="text-sm font-medium">
                        Workspace <span className="text-muted-foreground">(optional)</span>
                      </label>
                      <Input
                        id="bb-workspace"
                        value={workspace}
                        onChange={(e) => setWorkspace(e.target.value)}
                        placeholder="e.g. siemba - leave blank to auto-detect"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="bb-email" className="text-sm font-medium">
                        Atlassian email
                      </label>
                      <Input
                        id="bb-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="bb-token" className="text-sm font-medium">
                        API token
                      </label>
                      <Input
                        id="bb-token"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Scoped API token (read scopes)"
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        Sent once to verify + stored encrypted in the secrets broker - never saved
                        in the database or shown again.
                      </p>
                    </div>
                  </>
                ) : isAws ? (
                  <>
                    <div className="space-y-2">
                      <label htmlFor="aws-regions" className="text-sm font-medium">
                        Regions <span className="text-muted-foreground">(comma-separated)</span>
                      </label>
                      <Input
                        id="aws-regions"
                        value={regions}
                        onChange={(e) => setRegions(e.target.value)}
                        placeholder="e.g. us-east-1, eu-west-1"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="aws-access-key" className="text-sm font-medium">
                        Access Key ID
                      </label>
                      <Input
                        id="aws-access-key"
                        value={accessKeyId}
                        onChange={(e) => setAccessKeyId(e.target.value)}
                        placeholder="AKIA…"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="aws-secret-key" className="text-sm font-medium">
                        Secret Access Key
                      </label>
                      <Input
                        id="aws-secret-key"
                        type="password"
                        value={secretAccessKey}
                        onChange={(e) => setSecretAccessKey(e.target.value)}
                        placeholder="Secret access key"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground">
                        Sent once to verify + stored encrypted in the secrets broker - never saved
                        in the database or shown again. Use an IAM user with a read-only policy.
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This adds the connection. Live verification (credentials) is the next step once
                    your {CREDENTIAL_NOUN[provider.id] ?? "credentials"} are set up.
                  </p>
                )}

                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
                <Button onClick={() => void add()} disabled={busy || name.trim().length === 0}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {needsCreds ? "Connect & verify" : "Add connection"}
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
