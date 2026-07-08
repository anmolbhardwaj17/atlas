"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Trash2, RefreshCw, ShieldAlert, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
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
import {
  AwsSetup,
  GithubSetup,
  AzureSetup,
  GcpSetup,
  BitbucketSetup,
  JenkinsSetup,
} from "@/components/integrations/provider-setup";
import { PROVIDERS, ProviderLogo, type ProviderMeta } from "@/components/integrations/providers";
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
    case "jenkins":
      return <JenkinsSetup />;
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
  const [tab, setTab] = React.useState<(typeof TABS)[number]>("All");
  const [query, setQuery] = React.useState("");

  const byProvider = new Map<string, ConnectionSummary[]>();
  for (const c of connections) {
    const arr = byProvider.get(c.provider) ?? [];
    arr.push(c);
    byProvider.set(c.provider, arr);
  }

  const q = query.trim().toLowerCase();
  const hasConn = (id: string) => (byProvider.get(id)?.length ?? 0) > 0;
  // Every provider is a row (available + coming-soon). Connected ones float to the top so a
  // consumer sees "what's already set up" first.
  const rows = PROVIDERS.filter(
    (p) =>
      (tab === "All" || p.category === tab) &&
      (q === "" || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)),
  ).sort((a, b) => Number(hasConn(b.id)) - Number(hasConn(a.id)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect your cloud, code, CI/CD, and observability accounts. Atlas builds one cited graph
          across everything you connect.
        </p>
      </div>

      {/* Category tabs + search — the row list below filters live. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                tab === t
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search integrations…"
            className="h-9 w-full rounded-md border border-border bg-transparent pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/40"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border py-14 text-center text-sm text-muted-foreground">
          No integrations match your search.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              connections={byProvider.get(p.id) ?? []}
              canManage={canManage}
              orgId={orgId}
              onConnect={() => setConnectProvider(p)}
            />
          ))}
        </div>
      )}

      {/* A decorative footer, set well apart from the table so it reads as page-bottom flourish. */}
      <div className="pt-16">
        <p className="mb-4 text-center text-xs text-muted-foreground">
          One graph across your whole stack
        </p>
        <LogoShowcase />
      </div>

      <ConnectSheet
        provider={connectProvider}
        orgId={orgId}
        onClose={() => setConnectProvider(null)}
      />
    </div>
  );
}

const TABS = ["All", "Cloud", "Code", "CI/CD", "Observability"] as const;

// A decorative wall of the tools Atlas actually connects across — the real providers plus the
// infra/DevOps ecosystem we build the graph from. Domain-relevant only (no consumer/productivity
// apps we don't integrate). Logos only (no labels, no status).
const SHOWCASE_LOGOS = Array.from(
  new Set([
    ...PROVIDERS.map((p) => p.logo),
    "kubernetes",
    "terraform-icon",
    "pulumi",
    "docker-icon",
    "prometheus",
    "sentry-icon",
    "pagerduty",
  ]),
);

/** The stylish logo wall at the bottom — everything Atlas plugs into. Borderless, with the row
 *  edges faded into the page so it reads as a decorative footer, not a boxed card. */
function LogoShowcase() {
  const logos = SHOWCASE_LOGOS.filter((l) => hasCloudIcon(l));
  return (
    <div className="[mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div className="flex flex-wrap justify-center gap-3 py-2">
        {logos.map((logo) => (
          <div
            key={logo}
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-background shadow-sm ring-1 ring-black/5 transition-transform hover:-translate-y-0.5 dark:ring-white/10"
          >
            <CloudIcon name={logo} className="size-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One integration as a list row: logo + name + category + a one-line state, and an action on the
 *  right. When connected the whole row (and the "Connected" pill) opens a Manage slide-over that
 *  lists the account(s) as readable blocks — so the list itself stays clean and aligned. */
function ProviderRow({
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
  const connected = connections.length > 0;
  const [manageOpen, setManageOpen] = React.useState(false);
  const needsAttention = connections.filter(
    (c) => c.status === "degraded" || c.status === "error",
  ).length;
  const anySyncing = connections.some((c) => c.syncing === true);
  const openManage = () => {
    if (connected) setManageOpen(true);
  };

  // Once connected, the blurb gives way to a one-line summary of the real state at a glance.
  let summary = provider.blurb;
  if (connected) {
    const only = connections.length === 1 ? connections[0] : undefined;
    if (anySyncing) summary = "Syncing — pulling the latest data…";
    else if (needsAttention > 0)
      summary = `${needsAttention} need${needsAttention === 1 ? "s" : ""} attention`;
    else if (only?.lastSync)
      summary = `Synced ${timeAgo(only.lastSync.finishedAt)} · ${only.lastSync.resources} resources`;
    else summary = `${connections.length} connections · all healthy`;
  }

  return (
    <>
      <div className="flex items-center gap-4 bg-card px-4 py-3.5">
        <div className="grid size-10 shrink-0 place-items-center">
          <ProviderLogo provider={provider} className="size-7" />
        </div>
        <button
          type="button"
          onClick={openManage}
          disabled={!connected}
          className={cn("min-w-0 flex-1 text-left", connected ? "group" : "cursor-default")}
        >
          <div className="flex items-center gap-2">
            <span className={cn("truncate font-medium", connected && "group-hover:underline")}>
              {provider.name}
            </span>
            <span className="hidden shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
              {provider.category}
            </span>
          </div>
          <p
            className={cn(
              "truncate text-sm",
              needsAttention > 0 ? "text-warning" : "text-muted-foreground",
            )}
          >
            {summary}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {comingSoon ? (
            <span className="text-xs text-muted-foreground">Coming soon</span>
          ) : connected ? (
            <>
              {canManage ? (
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9"
                  onClick={onConnect}
                  aria-label={`Add another ${provider.name} connection`}
                  title="Add another connection"
                >
                  <Plus className="size-4" />
                </Button>
              ) : null}
              <button
                type="button"
                onClick={openManage}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <Check className="size-4" />
                {connections.length > 1 ? `${connections.length} connected` : "Connected"}
              </button>
            </>
          ) : canManage ? (
            <Button variant="outline" className="h-9" onClick={onConnect}>
              <Plus className="size-4" /> Connect
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Ask an admin</span>
          )}
        </div>
      </div>
      <ManageSheet
        open={manageOpen}
        onOpenChange={setManageOpen}
        provider={provider}
        connections={connections}
        orgId={orgId}
        canManage={canManage}
        onConnect={onConnect}
      />
    </>
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

/** The "Manage <provider>" slide-over — lists a provider's connection(s) as full, readable
 *  blocks (status, sync, permission gaps, actions) plus an "add another" affordance. Opened by
 *  clicking a connected provider row, so the list itself stays clean and aligned. */
function ManageSheet({
  open,
  onOpenChange,
  provider,
  connections,
  orgId,
  canManage,
  onConnect,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  provider: ProviderMeta;
  connections: ConnectionSummary[];
  orgId: string;
  canManage: boolean;
  onConnect: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center">
              <ProviderLogo provider={provider} className="size-6" />
            </span>
            {provider.name}
          </SheetTitle>
          <SheetDescription>
            {connections.length} connection{connections.length === 1 ? "" : "s"} · read-only
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-3">
          {connections.map((c) => (
            <ConnectionBlock key={c.id} conn={c} orgId={orgId} canManage={canManage} />
          ))}
          {canManage ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                onConnect();
              }}
            >
              <Plus className="size-4" /> Add another connection
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ConnectionBlock({
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
      toast.success(`Sync started for ${conn.displayName}`, {
        description: "Atlas is pulling the latest data. This can take a minute.",
      });
      router.refresh(); // the row's live "Syncing…" state takes over from here
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't start a sync.";
      setNote(message);
      toast.error("Couldn't start a sync", { description: message });
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3.5 text-sm">
      {/* Header — name + live status. */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{conn.displayName}</span>
        <span className="flex shrink-0 items-center gap-2">
          {conn.demo ? (
            <span className="rounded-full border border-transparent bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Sample
            </span>
          ) : null}
          <StatusBadge status={conn.status} />
        </span>
      </div>

      {/* Sync status. */}
      <p className="mt-2">
        {syncing ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Syncing — pulling the latest data…
          </span>
        ) : conn.lastSync ? (
          <span
            className={cn(
              conn.lastSync.status === "failed" ? "text-danger" : "text-muted-foreground",
            )}
          >
            {conn.lastSync.status === "failed"
              ? `Last sync failed ${timeAgo(conn.lastSync.finishedAt)}`
              : `Last synced ${timeAgo(conn.lastSync.finishedAt)} · ${conn.lastSync.resources} resources`}
            {conn.lastSync.status === "partial" && conn.lastSync.scopesFailed > 0 ? (
              <span className="text-warning">
                {" "}
                · {conn.lastSync.scopesFailed} scope
                {conn.lastSync.scopesFailed === 1 ? "" : "s"} skipped
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">Not synced yet.</span>
        )}
      </p>

      {/* What was skipped this sync (when we have no explicit permission list to show). */}
      {missingPerms.length === 0 &&
      conn.lastSync?.status === "partial" &&
      (conn.lastSync.skippedScopes?.length ?? 0) > 0 ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-medium text-warning">
            Skipped this sync — usually a missing read permission on the token:
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(conn.lastSync.skippedScopes ?? []).map((s) => (
              <code
                key={s}
                className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[11px] text-warning"
              >
                {s}
              </code>
            ))}
          </div>
        </div>
      ) : null}

      {/* Missing permissions — the detail, with room to breathe. */}
      {conn.status === "degraded" && missingPerms.length > 0 ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <ShieldAlert className="size-3.5 shrink-0" />
            {missingPerms.length} permission{missingPerms.length === 1 ? "" : "s"} missing — grant
            these for full coverage
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {missingPerms.map((p) => (
              <code
                key={p}
                className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[11px] text-warning"
              >
                {p}
              </code>
            ))}
          </div>
        </div>
      ) : null}

      {note ? <p className="mt-2 text-xs text-danger">{note}</p> : null}

      {/* Actions. */}
      {canManage ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {canSync ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void sync()}
              disabled={triggering || syncing}
            >
              <RefreshCw className={cn("size-3.5", (triggering || syncing) && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            className="ml-auto text-muted-foreground hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="size-3.5" /> Disconnect
          </Button>
        </div>
      ) : null}

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
    </div>
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
  // Jenkins: server URL + username (email state reused as the username field) + API token (token).
  const [baseUrl, setBaseUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Live credential flows: Bitbucket (email + token), AWS (access keys), Jenkins (url + user + token).
  const isBitbucket = provider?.id === "bitbucket";
  const isAws = provider?.id === "aws";
  const isJenkins = provider?.id === "jenkins";
  const needsCreds = isBitbucket || isAws || isJenkins;

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
      setBaseUrl("");
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
      } else if (isJenkins) {
        if (!baseUrl.trim()) {
          setError("Enter your Jenkins server URL (e.g. https://ci.acme.com).");
          setBusy(false);
          return;
        }
        if (!email.trim() || !token.trim()) {
          setError("Enter the Jenkins username and API token.");
          setBusy(false);
          return;
        }
        const conn = await createConnection(orgId, provider.id, name.trim(), {
          baseUrl: baseUrl.trim(),
        });
        const verified = await verifyConnection(orgId, conn.id, {
          username: email.trim(),
          apiToken: token.trim(),
        });
        if (verified.status === "error") {
          setError(
            "Jenkins rejected the credentials - check the server URL, username, and API token.",
          );
          setBusy(false);
          return;
        }
      } else {
        await createConnection(orgId, provider.id, name.trim());
      }
      toast.success(`Connected ${name.trim()}`, {
        description: needsCreds
          ? "Credentials verified. Atlas is starting its first sync."
          : `${provider.name} connection added.`,
      });
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
                  <ProviderLogo provider={provider} className="size-5" />
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
                ) : isJenkins ? (
                  <>
                    <div className="space-y-2">
                      <label htmlFor="jk-url" className="text-sm font-medium">
                        Jenkins server URL
                      </label>
                      <Input
                        id="jk-url"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://ci.acme.com"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="jk-user" className="text-sm font-medium">
                        Username
                      </label>
                      <Input
                        id="jk-user"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="A read-only Jenkins user"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="jk-token" className="text-sm font-medium">
                        API token
                      </label>
                      <Input
                        id="jk-token"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="User → Configure → API Token"
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        Sent once to verify + stored encrypted in the secrets broker - never saved
                        in the database or shown again. Use a user with Overall/Read + Job/Read
                        only.
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
