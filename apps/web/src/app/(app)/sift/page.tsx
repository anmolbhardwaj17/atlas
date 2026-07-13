import { Suspense } from "react";
import { getPageAuth } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { SiftSetup, type RepoOption } from "@/components/sift/sift-setup";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";
import SiftLoading from "./loading";

export const dynamic = "force-dynamic";

/** Repository nodes as the graph stores them — we only need the identity + which host they live on. */
interface RepoNode {
  id: string;
  name: string;
  provider: string | null;
}

/**
 * Sift — AI code review under the Atlas umbrella. The page is Sift's own setup screen: the guided
 * setup (Sift × Atlas) on the left and a two-step config wizard on the right (review settings, then
 * the repositories to review). The repo list is every repository Atlas already knows about, across
 * whichever code hosts are connected — the user picks which ones Sift covers. The original
 * "Coming soon" statement is preserved and reachable from a small link at the top.
 */
// Connectors namespace the repo node kind by host (bitbucket.repository, github.repository, …); the
// demo estate uses the bare "repository". Fetch them all so the picker shows every repo we know.
const REPO_KINDS = [
  "bitbucket.repository",
  "github.repository",
  "gitlab.repository",
  "repository",
] as const;

export default function SiftPage() {
  return (
    <Suspense fallback={<SiftLoading />}>
      <SiftContent />
    </Suspense>
  );
}

async function SiftContent() {
  const { token, orgId } = await getPageAuth();
  // Every repository we've discovered, regardless of whether it's wired to anything else. Providers
  // are mixed (Bitbucket / GitHub / GitLab) so the picker stays host-agnostic.
  const results = await Promise.all(
    REPO_KINDS.map((kind) =>
      apiGet<ApiOk<RepoNode[]>>(`/nodes?kind=${encodeURIComponent(kind)}&limit=100`, {
        token,
        orgId,
      }),
    ),
  );
  const seen = new Set<string>();
  const repos: RepoOption[] = results
    .flatMap((r) => r.body?.data ?? [])
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .map((n) => ({ id: n.id, name: n.name, provider: n.provider }));

  return (
    <>
      <SetBreadcrumbs items={[{ label: "Sift" }]} />
      <SiftSetup repos={repos} />
    </>
  );
}
