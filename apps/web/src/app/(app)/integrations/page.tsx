import { Suspense } from "react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { IntegrationsHub } from "@/components/integrations/integrations-hub";
import type { ConnectionSummary, ChannelSummary } from "@/lib/browser-api";
import IntegrationsLoading from "./loading";

export const dynamic = "force-dynamic";

/**
 * Integrations hub (docs/18). The one place to connect accounts - provider tiles with their
 * connected sources + a guided connect flow. Server-fetches connections; mutations happen
 * client-side (Admin-gated by the API + the `canManage` flag). Auth + data live inside the
 * <Suspense> child so the page returns its skeleton immediately (needs the member's role, so it
 * uses the full shell).
 */
export default function IntegrationsPage() {
  return (
    <Suspense fallback={<IntegrationsLoading />}>
      <IntegrationsContent />
    </Suspense>
  );
}

async function IntegrationsContent() {
  const shell = await requireShell();
  const auth = { token: shell.token, orgId: shell.orgId };
  // Graph-source connections (AWS/GitHub/…) + outbound alert channels (Slack/Discord/Teams) — the
  // hub surfaces both, so a connected Slack channel reads as "Connected" here too.
  const [connections, channels] = await Promise.all([
    apiGet<ApiOk<ConnectionSummary[]>>("/connections", auth).then((r) => r.body?.data ?? []),
    apiGet<ApiOk<ChannelSummary[]>>("/notifications", auth).then((r) => r.body?.data ?? []),
  ]);

  return (
    <IntegrationsHub
      orgId={shell.orgId}
      connections={connections}
      channels={channels}
      canManage={shell.role === "Owner" || shell.role === "Admin"}
    />
  );
}
