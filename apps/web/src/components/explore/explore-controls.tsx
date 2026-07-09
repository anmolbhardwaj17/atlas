"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  Network,
  Search,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { PROVIDER_META } from "@/lib/taxonomy";
import { cn } from "@/lib/cn";

/**
 * Explore filter bar + results shell (docs/09 §5.3). A client wrapper so the filters can be rich
 * (multi-select facets with the same icons/colours used across the app) and responsive (navigation
 * runs in a transition, dimming the server-rendered results while the next page loads — no dead-air
 * "did it lag?" moment). Facets are multi-value: OR within a facet, AND across facets. The URL stays
 * the source of truth (shareable + back-button friendly).
 */
export interface NodeFilterValues {
  q: string | undefined;
  category: string[];
  source: string[];
  health: string[];
  status: string[];
}

const CATEGORY_ICON: Record<string, LucideIcon> = {
  code: Code2,
  compute: Cpu,
  data: Database,
  storage: HardDrive,
  networking: Network,
  identity: KeyRound,
  security: ShieldCheck,
  derived: Boxes,
};
const HEALTH: Array<[string, string, string]> = [
  ["unhealthy", "Unhealthy", "bg-danger"],
  ["degraded", "Degraded", "bg-warning"],
  ["healthy", "Healthy", "bg-success"],
  ["unknown", "Not checked", "bg-muted-foreground/40"],
];
const STATUS: Array<[string, string, string]> = [
  ["active", "Active", "bg-success"],
  ["stale", "Stale", "bg-warning"],
];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const SOURCE_LABEL: Record<string, string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "Google Cloud",
  bitbucket: "Bitbucket",
  github: "GitHub",
  gitlab: "GitLab",
  datadog: "Datadog",
  atlas: "Inferred services",
  external: "External",
};
const CATEGORY_LABEL: Record<string, string> = {
  code: "Code",
  compute: "Compute",
  data: "Data stores",
  storage: "Storage",
  networking: "Networking",
  identity: "Identity",
  security: "Security",
  derived: "Services",
};
const labelOf = (map: Record<string, string>, v: string): string => map[v] ?? cap(v);

const PLACEHOLDERS = [
  "Search by name…",
  "Search resources…",
  "Find a service, datastore, or repo…",
];

interface Opt {
  value: string;
  label: string;
  icon: ReactNode;
}

export function ExploreControls({
  values,
  sources,
  categories,
  children,
}: {
  values: NodeFilterValues;
  sources: string[];
  categories: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(values.q ?? "");
  const [category, setCategory] = useState<string[]>(values.category);
  const [source, setSource] = useState<string[]>(values.source);
  const [health, setHealth] = useState<string[]>(values.health);
  const [status, setStatus] = useState<string[]>(values.status);

  // Animated placeholder while empty + unfocused.
  const [focused, setFocused] = useState(false);
  const [phase, setPhase] = useState(0);
  const animating = !q && !focused;
  useEffect(() => {
    if (!animating) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % PLACEHOLDERS.length), 2800);
    return () => clearInterval(id);
  }, [animating]);

  const go = (
    next?: Partial<Record<"q" | "category" | "source" | "health" | "status", string[] | string>>,
  ) => {
    const cur = { q, category, source, health, status, ...next };
    const p = new URLSearchParams();
    if (typeof cur.q === "string" && cur.q.trim()) p.set("q", cur.q.trim());
    if ((cur.category as string[]).length) p.set("category", (cur.category as string[]).join(","));
    if ((cur.source as string[]).length) p.set("source", (cur.source as string[]).join(","));
    if ((cur.health as string[]).length) p.set("health", (cur.health as string[]).join(","));
    if ((cur.status as string[]).length) p.set("status", (cur.status as string[]).join(","));
    const qs = p.toString();
    startTransition(() => router.push(qs ? `/explore?${qs}` : "/explore"));
  };

  const toggle = (
    key: "category" | "source" | "health" | "status",
    set: (v: string[]) => void,
    current: string[],
    value: string,
  ) => {
    const nextArr = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    set(nextArr);
    go({ [key]: nextArr });
  };

  const clear = () => {
    setQ("");
    setCategory([]);
    setSource([]);
    setHealth([]);
    setStatus([]);
    startTransition(() => router.push("/explore"));
  };

  const hasFilters = Boolean(
    values.q ||
    values.category.length ||
    values.source.length ||
    values.health.length ||
    values.status.length,
  );

  const categoryOpts: Opt[] = categories.map((c) => ({
    value: c,
    label: labelOf(CATEGORY_LABEL, c),
    icon: iconFrom(CATEGORY_ICON[c] ?? Boxes),
  }));
  const sourceOpts: Opt[] = sources.map((s) => ({
    value: s,
    label: labelOf(SOURCE_LABEL, s),
    icon: <SourceGlyph provider={s} />,
  }));
  const healthOpts: Opt[] = HEALTH.map(([value, label, dot]) => ({
    value,
    label,
    icon: <Dot className={dot} />,
  }));
  const statusOpts: Opt[] = STATUS.map(([value, label, dot]) => ({
    value,
    label,
    icon: <Dot className={dot} />,
  }));

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={animating ? "" : "Search by name…"}
            aria-label="Search resources"
            className="pl-9"
          />
          {animating ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-9 right-3 flex items-center overflow-hidden text-sm text-muted-foreground"
            >
              {PLACEHOLDERS.map((t, i) => (
                <span
                  key={t}
                  className={cn(
                    "absolute transition-all duration-500",
                    i === phase ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
                  )}
                >
                  {t}
                </span>
              ))}
            </span>
          ) : null}
        </div>

        <FacetMenu
          placeholder="Any type"
          options={categoryOpts}
          selected={category}
          onToggle={(v) => toggle("category", setCategory, category, v)}
        />
        <FacetMenu
          placeholder="Any source"
          options={sourceOpts}
          selected={source}
          onToggle={(v) => toggle("source", setSource, source, v)}
        />
        <FacetMenu
          placeholder="Any health"
          options={healthOpts}
          selected={health}
          onToggle={(v) => toggle("health", setHealth, health, v)}
        />
        <FacetMenu
          placeholder="Any status"
          options={statusOpts}
          selected={status}
          onToggle={(v) => toggle("status", setStatus, status, v)}
        />

        <Button type="submit">Apply</Button>
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        {hasFilters ? (
          <Button type="button" variant="ghost" onClick={clear}>
            <X className="size-4" />
            Clear filters
          </Button>
        ) : null}
      </form>

      {/* Results dim while the next page loads, so a filter change reads as "working", not frozen. */}
      <div
        className={cn(
          "transition-opacity duration-200",
          pending && "pointer-events-none opacity-50",
        )}
        aria-busy={pending}
      >
        {children}
      </div>
    </div>
  );
}

/** A multi-select facet dropdown: trigger shows the current selection, items toggle without closing
 *  the menu (so you can pick several), each carrying its icon/colour. */
function FacetMenu({
  placeholder,
  options,
  selected,
  onToggle,
}: {
  placeholder: string;
  options: Opt[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? placeholder)
        : `${options.find((o) => o.value === selected[0])?.label ?? ""} +${selected.length - 1}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            selected.length > 0 && "border-foreground/30",
          )}
        >
          <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
            {label}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <DropdownMenuItem
              key={o.value}
              onSelect={(e) => {
                e.preventDefault();
                onToggle(o.value);
              }}
              className="flex items-center gap-2"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {on ? <Check className="size-4" /> : null}
              </span>
              {o.icon}
              <span className="flex-1 truncate">{o.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", className)} />;
}
function iconFrom(Icon: LucideIcon): ReactNode {
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}
function SourceGlyph({ provider }: { provider: string }) {
  const meta = PROVIDER_META[provider];
  if (meta?.logo && hasCloudIcon(meta.logo)) {
    return <CloudIcon name={meta.logo} className="size-4 shrink-0" />;
  }
  const Fallback = meta?.fallbackIcon;
  return Fallback ? <Fallback className="size-4 shrink-0 text-muted-foreground" /> : null;
}
