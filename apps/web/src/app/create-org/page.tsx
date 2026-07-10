import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock, Zap, Sparkles } from "lucide-react";
import { getSession, apiGet, type ApiOk } from "@/lib/api";
import { AtlasLogo } from "@/components/brand";
import { CreateOrgForm } from "../create-org-form";

export const dynamic = "force-dynamic";

interface MeResponse {
  memberships: { orgId: string }[];
}

// Branded dark hero, same language as the login screen (a dark gradient card floating on the
// themed page). Green brand glow layered on top ties it to the Atlas AI identity.
const HERO_BG = "radial-gradient(120% 110% at 18% 12%, #3d3d3d 0%, #1a1a1a 45%, #050505 100%)";
const HERO_GLOW =
  "radial-gradient(60% 55% at 78% 88%, rgba(76,175,120,0.28) 0%, rgba(76,175,120,0.06) 40%, transparent 72%)";

const REASSURE = [
  { icon: Lock, label: "Read-only, always" },
  { icon: Zap, label: "Live in minutes" },
  { icon: Sparkles, label: "Answers with sources" },
];

/**
 * The single "create an organization" surface (docs/12 §6.3). Reachable by a brand-new org-less user
 * (funneled from `/`) and by an existing user spinning up a second workspace (org switcher). Unlike
 * `/`, it never bounces a user who already has an org. Split layout mirrors the sign-in screen: a
 * branded hero + the create wizard.
 */
export default async function CreateOrgPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const me = (await apiGet<ApiOk<MeResponse>>("/me", { token: session.token })).body?.data;
  const hasOrgs = (me?.memberships.length ?? 0) > 0;

  return (
    <main className="min-h-dvh bg-background md:grid md:grid-cols-[1.05fr_1fr]">
      {/* ── Left: branded hero (hidden on mobile) ── */}
      <aside
        className="relative m-2.5 hidden flex-col justify-between overflow-hidden rounded-2xl p-8 text-white shadow-sm md:m-3 md:flex"
        style={{ background: HERO_BG }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: HERO_GLOW }}
        />
        {/* Faint Atlas mark bleeding off the top-left corner. */}
        <AtlasLogo
          size={520}
          className="pointer-events-none absolute -left-24 -top-24 size-[520px] opacity-[0.06] [filter:invert(1)]"
        />

        <div className="relative flex items-center gap-2">
          <AtlasLogo size={26} className="size-[26px] [filter:invert(1)]" />
          <span className="text-lg font-semibold tracking-tight">Atlas</span>
        </div>

        <div className="relative">
          <h2 className="max-w-sm text-balance text-4xl font-semibold leading-tight tracking-tight">
            Everything you run, in one graph.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
            Name your workspace and Atlas gets ready to turn your cloud and code into a living,
            cited map you can explore, search, and ask.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {REASSURE.map((r) => (
              <li
                key={r.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm"
              >
                <r.icon className="size-3.5" /> {r.label}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ── Right: the create wizard ── */}
      <section className="relative flex min-h-dvh flex-col justify-center px-6 py-12 sm:px-10">
        {hasOrgs ? (
          <Link
            href="/dashboard"
            className="absolute left-6 top-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:left-10 sm:top-8"
          >
            <ArrowLeft className="size-4" /> Back to dashboard
          </Link>
        ) : null}
        <div className="mx-auto w-full max-w-md">
          <CreateOrgForm />
        </div>
      </section>
    </main>
  );
}
