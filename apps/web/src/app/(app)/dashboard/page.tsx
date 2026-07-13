import { Suspense } from "react";
import { requireShell } from "@/lib/shell";
import { Dashboard } from "@/components/dashboard";
import DashboardLoading from "./loading";

export const dynamic = "force-dynamic";

/**
 * The page commits as soon as the (fast) auth/shell resolves, then STREAMS the dashboard behind a
 * <Suspense> boundary (perf P3): the heavy `/summary` fetch lives inside the async <Dashboard>, so
 * it no longer blocks the RSC flush. The fallback is the route's own skeleton, so the hand-off from
 * the navigation loading state to the streamed content is a single continuous skeleton (no flash).
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}

/** Auth + the heavy `/summary` both live inside the boundary so the page returns its skeleton
 *  synchronously. Dashboard needs the member's role + name, so it uses the full shell (one `/me`). */
async function DashboardContent() {
  const shell = await requireShell();
  return <Dashboard orgId={shell.orgId} token={shell.token} role={shell.role} name={shell.name} />;
}
