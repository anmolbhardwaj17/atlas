import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { AdvisorView, type Proposal } from "@/components/advisor/advisor-view";

export const dynamic = "force-dynamic";

/**
 * Advisor (docs/plans/optimization.md) — grounded architecture-improvement proposals, each shown as
 * a current-vs-proposed graph and debatable via Ask Atlas. The pattern engine runs server-side over
 * the live graph; the proposed graph is a recommendation the UI clearly labels, never truth.
 */
export default async function AdvisorPage() {
  const shell = await requireShell();
  const res = await apiGet<ApiOk<{ proposals: Proposal[] }>>("/advisor/proposals", {
    token: shell.token,
    orgId: shell.orgId,
  });
  return <AdvisorView proposals={res.body?.data?.proposals ?? []} />;
}
