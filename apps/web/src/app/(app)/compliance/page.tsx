import { Suspense } from "react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { ComplianceView, type ComplianceReport } from "@/components/compliance/compliance-view";
import ComplianceLoading from "./loading";

export const dynamic = "force-dynamic";

/** Data-bound part: the live `/compliance` fetch + the view, streamed behind <Suspense> (perf P3). */
async function ComplianceContent({ token, orgId }: { token: string; orgId: string }) {
  const res = await apiGet<ApiOk<ComplianceReport>>("/compliance", { token, orgId });
  return <ComplianceView report={res.body?.data ?? null} />;
}

/**
 * Compliance (docs/plans/compliance.md). Maps Atlas's technical evidence onto the
 * infrastructure-observable subset of ISO/HIPAA/PCI/NIST/CIS/GDPR — honestly, with an explicit
 * not-assessable state and a coverage caveat so it never implies certification.
 */
export default async function CompliancePage() {
  const shell = await requireShell();
  return (
    <Suspense fallback={<ComplianceLoading />}>
      <ComplianceContent token={shell.token} orgId={shell.orgId} />
    </Suspense>
  );
}
