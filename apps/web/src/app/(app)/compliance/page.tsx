import { Suspense } from "react";
import { getPageAuth } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { ComplianceView, type ComplianceReport } from "@/components/compliance/compliance-view";
import ComplianceLoading from "./loading";

export const dynamic = "force-dynamic";

/** Data-bound part: cookie-only auth + the live `/compliance` fetch, streamed behind <Suspense>
 *  so the page returns its skeleton immediately and never blocks the RSC flush (perf P3). */
async function ComplianceContent() {
  const { token, orgId } = await getPageAuth();
  const res = await apiGet<ApiOk<ComplianceReport>>("/compliance", { token, orgId });
  // A failed fetch must not blank the page — throw to the in-shell error boundary instead.
  if (res.body === null) throw new Error(`Failed to load compliance report (status ${res.status})`);
  return <ComplianceView report={res.body.data} />;
}

/**
 * Compliance (docs/plans/compliance.md). Maps Atlas's technical evidence onto the
 * infrastructure-observable subset of ISO/HIPAA/PCI/NIST/CIS/GDPR — honestly, with an explicit
 * not-assessable state and a coverage caveat so it never implies certification.
 */
export default function CompliancePage() {
  return (
    <Suspense fallback={<ComplianceLoading />}>
      <ComplianceContent />
    </Suspense>
  );
}
