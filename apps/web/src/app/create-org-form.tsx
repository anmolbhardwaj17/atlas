"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";
import { fileToLogoDataUrl } from "@/lib/read-image";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { OrgLogo } from "@/components/org-logo";
import { PROVIDERS, ProviderLogo } from "@/components/integrations/providers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Two-step org onboarding (docs/12 §6.1, §6.3):
 *   1. Name + logo → creates the org (you become Owner) and switches you into it.
 *   2. A few optional questions (role, team size, goals, stack) → saved to the org profile for
 *      personalization + product analytics. Fully skippable. NB: connecting a real source is NOT
 *      here — that lives in the dashboard onboarding, so signup stays light.
 */

// Stable keys (not labels) so analytics survives copy changes; must match dto.ts ORG_PROFILE_*.
const ROLES = [
  { key: "on_call_sre", label: "On-call / SRE" },
  { key: "platform_staff", label: "Platform / Staff engineer" },
  { key: "eng_manager", label: "Engineering manager" },
  { key: "new_to_team", label: "New to the team" },
  { key: "leadership", label: "Eng leadership (VP / CTO)" },
] as const;

const TEAM_SIZES = [
  { key: "solo", label: "Just me" },
  { key: "2-20", label: "2–20" },
  { key: "20-100", label: "20–100" },
  { key: "100-500", label: "100–500" },
  { key: "500+", label: "500+" },
] as const;

const USE_CASES = [
  { key: "blast_radius", label: "Understand blast radius & incidents" },
  { key: "architecture", label: "Map & document our architecture" },
  { key: "onboarding", label: "Onboard new engineers" },
  { key: "security", label: "Find security & dependency risk" },
  { key: "change_tracking", label: "Track deploys & what changed" },
] as const;

const INDUSTRIES = [
  "SaaS",
  "Fintech",
  "E-commerce",
  "Healthcare",
  "Gaming",
  "Media",
  "Education",
  "Government",
  "Other",
];
const REFERRALS = ["Search", "Colleague", "Social", "Event", "Blog / article", "Other"];

export function CreateOrgForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [orgId, setOrgId] = useState<string | null>(null);

  // Step 1
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 2 (all optional)
  const [role, setRole] = useState<string | null>(null);
  const [teamSize, setTeamSize] = useState<string | null>(null);
  const [useCases, setUseCases] = useState<string[]>([]);
  const [stack, setStack] = useState<string[]>([]);
  const [industry, setIndustry] = useState("");
  const [referral, setReferral] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accessToken(): Promise<string> {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    return session?.access_token ?? "";
  }

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setLogo(await fileToLogoDataUrl(file));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that image.");
    }
  }

  function toggle(list: string[], set: (v: string[]) => void, key: string): void {
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  // Step 1 → create the org, become Owner, switch into it, then advance to the questions.
  async function createOrg(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/orgs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify({ name: name.trim(), ...(logo ? { logo } : {}) }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? (body as { error: { message?: string } }).error.message
            : `Request failed (${res.status})`;
        setError(message ?? `Request failed (${res.status})`);
        return;
      }
      const created = (await res.json().catch(() => null)) as { data?: { id?: string } } | null;
      const id = created?.data?.id ?? null;
      if (id) {
        setOrgId(id);
        document.cookie = `${ACTIVE_ORG_COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      }
      setStep(2);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Step 2 → save the profile (best-effort — never block entering the app), then go to the dashboard.
  async function finish(skip: boolean): Promise<void> {
    setBusy(true);
    if (!skip && orgId) {
      const profile: Record<string, unknown> = {};
      if (role) profile.role = role;
      if (teamSize) profile.teamSize = teamSize;
      if (useCases.length) profile.useCases = useCases;
      if (stack.length) profile.stack = stack;
      if (industry) profile.industry = industry;
      if (referral) profile.referralSource = referral;
      try {
        await fetch(`${apiUrl()}/orgs/${orgId}/profile`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${await accessToken()}`,
          },
          body: JSON.stringify(profile),
        });
      } catch {
        /* best-effort: a failed profile save must not trap the user out of their new workspace */
      }
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (step === 1) {
    return (
      <div className="w-full">
        <StepEyebrow n={1} />
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Name your workspace</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This is where your team&apos;s graph lives. You can change it later.
        </p>
        <form onSubmit={(e) => void createOrg(e)} className="mt-5 space-y-3">
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => void onPickLogo(e)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-label="Add a logo"
              className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              {logo ? (
                <OrgLogo name={name} logoUrl={logo} size={44} className="rounded-lg border-solid" />
              ) : (
                <ImagePlus className="size-4" />
              )}
            </button>
            {logo ? (
              <button
                type="button"
                onClick={() => setLogo(null)}
                disabled={busy}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Remove logo"
              >
                <X className="size-4" />
              </button>
            ) : null}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
              disabled={busy}
              aria-label="Organization name"
              autoFocus
            />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  Continue <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <StepEyebrow n={2} />
      <h2 className="mt-2 text-lg font-semibold">Tell us about your team</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Optional — it helps us tailor Atlas to how you work. Skip anytime.
      </p>

      <div className="mt-6 space-y-6">
        <Field label="What's your role?">
          <div className="flex flex-wrap gap-2">
            {ROLES.map((o) => (
              <Chip
                key={o.key}
                on={role === o.key}
                onClick={() => setRole(role === o.key ? null : o.key)}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="How big is your engineering team?">
          <div className="flex flex-wrap gap-2">
            {TEAM_SIZES.map((o) => (
              <Chip
                key={o.key}
                on={teamSize === o.key}
                onClick={() => setTeamSize(teamSize === o.key ? null : o.key)}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="What do you want to do with Atlas?" hint="Pick any">
          <div className="flex flex-wrap gap-2">
            {USE_CASES.map((o) => (
              <Chip
                key={o.key}
                on={useCases.includes(o.key)}
                onClick={() => toggle(useCases, setUseCases, o.key)}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="What's in your stack?" hint="Pick any">
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p) => (
              <Chip
                key={p.id}
                on={stack.includes(p.id)}
                onClick={() => toggle(stack, setStack, p.id)}
              >
                <ProviderLogo provider={p} className="size-4 shrink-0" />
                {p.name.replace(/^Amazon Web Services$/, "AWS").replace(/^Microsoft /, "")}
              </Chip>
            ))}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Industry">
            <Select
              value={industry}
              onChange={setIndustry}
              placeholder="Select…"
              options={INDUSTRIES}
            />
          </Field>
          <Field label="How did you hear about us?">
            <Select
              value={referral}
              onChange={setReferral}
              placeholder="Select…"
              options={REFERRALS}
            />
          </Field>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={() => void finish(true)} disabled={busy}>
          Skip
        </Button>
        <Button type="button" onClick={() => void finish(false)} disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Finish <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function StepEyebrow({ n }: { n: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <span>Step {n} of 2</span>
      <span className="flex gap-1">
        <span className={cn("h-1 w-6 rounded-full", n >= 1 ? "bg-foreground" : "bg-border")} />
        <span className={cn("h-1 w-6 rounded-full", n >= 2 ? "bg-foreground" : "bg-border")} />
      </span>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on
          ? "border-foreground bg-foreground text-background"
          : "border-border text-foreground hover:border-foreground/40 hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
