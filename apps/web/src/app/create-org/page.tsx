import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession, apiGet, type ApiOk } from "@/lib/api";
import { AtlasLogo } from "@/components/brand";
import { CreateOrgForm } from "../create-org-form";

export const dynamic = "force-dynamic";

interface MeResponse {
  memberships: { orgId: string }[];
}

/**
 * The single "create an organization" surface (docs/12 §6.3) — reachable by a brand-new org-less
 * user (funneled from `/`) and by an existing user spinning up a second workspace (org switcher).
 * A clean, centered, card-less flow: the Atlas mark up top, the wizard in the middle. No sign-in
 * hero — this is setup, not marketing.
 */
export default async function CreateOrgPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const me = (await apiGet<ApiOk<MeResponse>>("/me", { token: session.token })).body?.data;
  const hasOrgs = (me?.memberships.length ?? 0) > 0;

  return (
    <main className="relative flex min-h-dvh flex-col bg-background">
      {/* A soft brand glow at the top — a hint of the Atlas AI green, tasteful, both themes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(55% 100% at 50% 0%, rgba(76,175,120,0.10) 0%, transparent 70%)",
        }}
      />

      {hasOrgs ? (
        <Link
          href="/dashboard"
          className="absolute left-5 top-5 z-10 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to dashboard
        </Link>
      ) : null}

      {/* Brand — top, centered. */}
      <div className="relative flex justify-center pt-14">
        <div className="flex items-center gap-2.5">
          <AtlasLogo size={30} className="size-[30px] dark:invert" />
          <span className="text-lg font-semibold tracking-tight">Atlas</span>
        </div>
      </div>

      {/* Wizard — wider (fewer chip rows → less scroll), with clear space below the brand. */}
      <div className="relative mx-auto w-full max-w-2xl px-6 pb-20 pt-14">
        <CreateOrgForm />
      </div>
    </main>
  );
}
