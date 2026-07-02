import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { IntegrationsHub } from "@/components/integrations/integrations-hub";
import type { ConnectionSummary } from "@/lib/browser-api";

export const dynamic = "force-dynamic";

/**
 * Integrations hub (docs/18). The one place to connect accounts - provider tiles with their
 * connected sources + a guided connect flow. Server-fetches connections; mutations happen
 * client-side (Admin-gated by the API + the `canManage` flag).
 */
export default async function IntegrationsPage() {
  const shell = await requireShell();
  const connections =
    (
      await apiGet<ApiOk<ConnectionSummary[]>>("/connections", {
        token: shell.token,
        orgId: shell.orgId,
      })
    ).body?.data ?? [];

  return (
    <IntegrationsHub
      orgId={shell.orgId}
      connections={connections}
      canManage={shell.role === "Owner" || shell.role === "Admin"}
    />
  );
}
