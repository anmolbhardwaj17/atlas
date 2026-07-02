"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Trash2, Check, X, RefreshCw } from "lucide-react";
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
 * Integrations hub (docs/18) — the one place to connect the company's accounts. A tile per
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
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [note, setNote] = React.useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const canSync = conn.status === "connected" || conn.status === "degraded";

  async function remove() {
    setBusy(true);
    try {
      await deleteConnection(orgId, conn.id);
      router.refresh();
    } catch {
      setBusy(false);
      setConfirming(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setNote(null);
    try {
      const r = await triggerSync(orgId, conn.id);
      setNote({
        tone: "ok",
        text:
          r.status === "already_running"
            ? "Already syncing…"
            : "Sync started — new data lands in a few minutes.",
      });
      setTimeout(() => router.refresh(), 1500);
    } catch (e) {
      setNote({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't start a sync." });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">{conn.displayName}</span>
        <span className="flex shrink-0 items-center gap-2">
          <StatusBadge status={conn.status} />
          {canManage && canSync && !confirming ? (
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing}
              aria-label="Sync now"
              title="Sync now — fetch the latest data"
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
            </button>
          ) : null}
          {canManage &&
            (confirming ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  aria-label="Confirm disconnect"
                  className="text-danger hover:opacity-80"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  aria-label="Cancel"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label="Disconnect"
                title="Disconnect (removes this source's data)"
                className="text-muted-foreground hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            ))}
        </span>
      </div>
      {note ? (
        <span
          className={cn("text-xs", note.tone === "ok" ? "text-muted-foreground" : "text-warning")}
        >
          {note.text}
        </span>
      ) : null}
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Bitbucket is the first live credential flow (email + scoped API token → verify).
  const needsCreds = provider?.id === "bitbucket";

  // Reset the form whenever a different provider's sheet opens.
  React.useEffect(() => {
    if (provider) {
      setName(`${provider.name.split(" ")[0]} — production`);
      setWorkspace("");
      setEmail("");
      setToken("");
      setError(null);
      setBusy(false);
    }
  }, [provider]);

  async function add() {
    if (!provider || name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (needsCreds) {
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
          setError("Bitbucket rejected the credentials — check the email, token, and its scopes.");
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

                {needsCreds ? (
                  <>
                    <div className="space-y-2">
                      <label htmlFor="bb-workspace" className="text-sm font-medium">
                        Workspace <span className="text-muted-foreground">(optional)</span>
                      </label>
                      <Input
                        id="bb-workspace"
                        value={workspace}
                        onChange={(e) => setWorkspace(e.target.value)}
                        placeholder="e.g. siemba — leave blank to auto-detect"
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
                        Sent once to verify + stored encrypted in the secrets broker — never saved
                        in the database or shown again.
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
