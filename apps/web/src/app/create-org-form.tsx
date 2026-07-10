"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X, ArrowRight, ArrowLeft } from "lucide-react";
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
 *   1. Name + logo.
 *   2. A few optional questions (role, team size, goals, stack) — personalization + analytics.
 * The org is created at the END (on Finish or Skip), together with the profile, so a workspace is
 * only ever created once the user commits — never a half-made org stranded after step 1. Connecting
 * a real source is NOT here; it lives in the dashboard onboarding, so signup stays light.
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

  // Step 1 → just advance to the questions. Nothing is created yet.
  function toQuestions(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setStep(2);
  }

  // End of the flow → create the org (name + logo), then save the profile unless skipped, then go
  // to the dashboard. Creation only happens here, so there's no orphaned org from a half-finished
  // signup. A creation failure (e.g. slug taken) drops back to step 1 with the message.
  async function submit(skip: boolean): Promise<void> {
    if (!name.trim()) {
      setStep(1);
      setError("Please name your workspace.");
      return;
    }
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
        setStep(1);
        return;
      }
      const created = (await res.json().catch(() => null)) as { data?: { id?: string } } | null;
      const id = created?.data?.id ?? null;
      if (id) {
        document.cookie = `${ACTIVE_ORG_COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      }

      // Profile is best-effort — a failed save must never trap the user out of their new workspace.
      if (!skip && id) {
        const profile: Record<string, unknown> = {};
        if (role) profile.role = role;
        if (teamSize) profile.teamSize = teamSize;
        if (useCases.length) profile.useCases = useCases;
        if (stack.length) profile.stack = stack;
        if (industry) profile.industry = industry;
        if (referral) profile.referralSource = referral;
        if (Object.keys(profile).length > 0) {
          try {
            await fetch(`${apiUrl()}/orgs/${id}/profile`, {
              method: "PUT",
              headers: {
                "content-type": "application/json",
                Authorization: `Bearer ${await accessToken()}`,
              },
              body: JSON.stringify(profile),
            });
          } catch {
            /* swallow — org is created; entering the app matters more than the profile write */
          }
        }
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setStep(1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      <StepEyebrow n={step} />

      {step === 1 ? (
        <>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">Name your workspace</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This is where your team&apos;s graph lives. You can change it later.
          </p>
          <form onSubmit={toQuestions} className="mt-6 space-y-4">
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
                aria-label="Add a logo"
                className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                {logo ? (
                  <OrgLogo
                    name={name}
                    logoUrl={logo}
                    size={44}
                    className="rounded-lg border-solid"
                  />
                ) : (
                  <ImagePlus className="size-4" />
                )}
              </button>
              {logo ? (
                <button
                  type="button"
                  onClick={() => setLogo(null)}
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
                aria-label="Organization name"
                autoFocus
              />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end pt-1">
              <Button type="submit" disabled={!name.trim()}>
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>
          </form>
        </>
      ) : (
        <>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">Tell us about your team</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
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

          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}

          <div className="mt-8 flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={busy}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void submit(true)}
                disabled={busy}
              >
                Skip
              </Button>
              <Button type="button" onClick={() => void submit(false)} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Create workspace <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StepEyebrow({ n }: { n: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
