"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  Waypoints,
  Boxes,
  Sparkles,
  Lightbulb,
  Plug,
  Settings,
  CornerDownLeft,
  type LucideIcon,
} from "lucide-react";
import { searchNodes, type SearchHit } from "@/lib/browser-api";
import { kindIcon, kindStyle, kindShort, KIND_LOGO } from "@/lib/kind-visual";
import { CloudIcon } from "@/components/cloud-icon";
import { cn } from "@/lib/cn";

/** Support-data kinds are not navigable estate - they live in Insights/Explore-by-kind, not
 *  the command palette (so "map" surfaces the Map page, not an axios CVE). */
const PALETTE_HIDE = /^(external\.package|security\.vulnerability|aws\.logs\.group)$/;

/** Real per-kind icon in a category-tinted chip - the same visual language as the map/Explore. */
function ResourceIcon({ kind }: { kind: string }) {
  const logo = KIND_LOGO[kind];
  const Icon = kindIcon(kind);
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md",
        logo ? "bg-muted/60" : kindStyle(kind),
      )}
    >
      {logo ? <CloudIcon name={logo} className="size-4" /> : <Icon className="size-3.5" />}
    </span>
  );
}

/**
 * ⌘K command palette (docs/09 §5.5). Not just resource search - a keyboard-first launcher
 * for the whole app: jump to any page, find any resource (the same hybrid engine the AI
 * uses for entity resolution), or hand the query straight to Ask Atlas. ⌘K/Ctrl-K to open,
 * ↑↓ to move, ↵ to run, Esc to close.
 */
const NAV: Array<{ label: string; href: string; icon: LucideIcon; keywords: string }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: "overview home" },
  { label: "Map", href: "/map", icon: Waypoints, keywords: "infrastructure graph flow" },
  { label: "Explore", href: "/explore", icon: Boxes, keywords: "browse resources repos" },
  { label: "Ask Atlas", href: "/ask", icon: Sparkles, keywords: "ai chat question diagnose" },
  { label: "Insights", href: "/insights", icon: Lightbulb, keywords: "findings recommendations" },
  { label: "Integrations", href: "/integrations", icon: Plug, keywords: "connect aws bitbucket" },
  { label: "Settings", href: "/settings", icon: Settings, keywords: "config alerts llm members" },
];

type Item =
  | { type: "nav"; key: string; label: string; href: string; icon: LucideIcon; group: string }
  | {
      type: "resource";
      key: string;
      label: string;
      sub: string;
      kind: string;
      href: string;
      group: string;
    }
  | { type: "ask"; key: string; label: string; href: string; group: string };

export function CommandPalette({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Global open shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("atlas:open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("atlas:open-command", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else {
      setQ("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  // Debounced resource search (only when the query is substantial enough to be a name).
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchNodes(orgId, term, ctrl.signal)
        .then((r) => setHits(r))
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, orgId]);

  // Compose the unified, grouped item list. Ordering adapts to intent: when the query clearly
  // names a PAGE (a nav label starts with it, e.g. "map"→Map), "Go to" leads; otherwise
  // resources lead. Support-data kinds (packages/CVEs/logs) are filtered out so navigation
  // queries aren't buried under CVE noise.
  const items = useMemo<Item[]>(() => {
    const term = q.trim();
    const lower = term.toLowerCase();

    const navGroup: Item[] = (
      term ? NAV.filter((n) => `${n.label} ${n.keywords}`.toLowerCase().includes(lower)) : NAV
    ).map((n) => ({
      type: "nav" as const,
      key: `n:${n.href}`,
      label: n.label,
      href: n.href,
      icon: n.icon,
      group: "Go to",
    }));

    const resourceGroup: Item[] =
      term.length >= 2
        ? hits
            .filter((h) => !PALETTE_HIDE.test(h.node.kind))
            .map((h) => ({
              type: "resource" as const,
              key: `r:${h.node.id}`,
              label: h.node.name ?? h.node.id.slice(0, 8),
              sub: kindShort(h.node.kind),
              kind: h.node.kind,
              href: `/explore/${h.node.id}`,
              group: "Resources",
            }))
        : [];

    const askGroup: Item[] =
      term.length >= 3
        ? [
            {
              type: "ask" as const,
              key: "ask",
              label: `Ask Atlas: “${term}”`,
              href: `/ask?q=${encodeURIComponent(term)}`,
              group: "Ask Atlas",
            },
          ]
        : [];

    // Strong page match → navigation leads (typing "map" should default to the Map page).
    const strongNav = term.length >= 2 && NAV.some((n) => n.label.toLowerCase().startsWith(lower));
    return strongNav
      ? [...navGroup, ...resourceGroup, ...askGroup]
      : [...resourceGroup, ...askGroup, ...navGroup];
  }, [q, hits]);

  // Keep the active index in range as the list changes.
  useEffect(() => setActive(0), [items.length]);

  function run(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  if (!open) return null;

  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[15dvh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={16} className="text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(items[active]);
              }
            }}
            placeholder="Search resources, jump to a page, or ask Atlas…"
            className="w-full bg-transparent py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        <ul className="max-h-96 overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches — try a resource name, or press ↵ to ask Atlas.
            </li>
          ) : (
            items.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <li key={item.key}>
                  {header ? (
                    <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {header}
                    </p>
                  ) : null}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(item)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
                      i === active ? "bg-primary/15 text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {item.type === "nav" ? (
                      <span className="grid size-6 shrink-0 place-items-center">
                        <item.icon size={15} className="text-muted-foreground" />
                      </span>
                    ) : item.type === "ask" ? (
                      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10">
                        <Sparkles size={14} className="text-primary" />
                      </span>
                    ) : (
                      <ResourceIcon kind={item.kind} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                    {item.type === "resource" ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{item.sub}</span>
                    ) : null}
                    {i === active ? (
                      <CornerDownLeft size={13} className="shrink-0 text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
