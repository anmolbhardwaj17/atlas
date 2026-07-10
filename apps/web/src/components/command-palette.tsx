"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
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
import { AtlasAiMark } from "@/components/brand";
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
// Ask Atlas leads - the AI is the headline interface (P1). Its icon is the real AI mark,
// rendered specially (href === "/ask") since it's an image, not a Lucide glyph.
const NAV: Array<{ label: string; href: string; icon: LucideIcon; keywords: string }> = [
  { label: "Ask Atlas", href: "/ask", icon: Sparkles, keywords: "ai chat question diagnose" },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: "overview home" },
  { label: "Map", href: "/map", icon: Waypoints, keywords: "infrastructure graph flow" },
  { label: "Explore", href: "/explore", icon: Boxes, keywords: "browse resources repos" },
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
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  // Whether Shift is currently held while the palette is open. Holding Shift switches the primary
  // action from "navigate" to "ask Atlas", so we surface that affordance live (footer + active row)
  // rather than hiding it behind an undiscoverable shortcut.
  const [shiftHeld, setShiftHeld] = useState(false);
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
      setShiftHeld(false);
    }
  }, [open]);

  // Track Shift while the palette is open so the "hold Shift to ask" affordance can react live. We
  // reset on blur/close too, so a released-outside-the-window Shift never leaves the hint stuck on.
  useEffect(() => {
    if (!open) return;
    const sync = (e: KeyboardEvent) => setShiftHeld(e.shiftKey);
    const clear = () => setShiftHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, [open]);

  // Debounced resource search (only when the query is substantial enough to be a name).
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true); // in-flight from the first keystroke, so the UI never looks "empty"
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchNodes(orgId, term, ctrl.signal)
        .then((r) => {
          setHits(r);
          setSearching(false);
        })
        .catch(() => undefined); // aborted → a newer search is already running; keep searching
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

  // Send the current context to Ask Atlas instead of navigating: a highlighted resource asks about
  // that resource by name; otherwise the raw query is handed over. No-op if there's nothing to ask.
  function ask(item: Item | undefined) {
    const askQ = item?.type === "resource" ? item.label : q.trim();
    if (!askQ) return;
    setOpen(false);
    router.push(`/ask?q=${encodeURIComponent(askQ)}`);
  }

  // Enter (or click) runs the item. Holding Shift flips the action to "ask Atlas" — the resource's
  // href navigates you to it, Shift hands it to the AI instead (P1: the AI is the interface).
  function run(item: Item | undefined, opts?: { ask?: boolean }) {
    if (opts?.ask) return ask(item);
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  if (!open) return null;

  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15dvh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          {searching ? (
            <Loader2 size={18} className="shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search size={18} className="shrink-0 text-muted-foreground" />
          )}
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
                run(items[active], { ask: e.shiftKey });
              }
            }}
            placeholder="Search resources, jump to a page, or ask Atlas…"
            className="w-full bg-transparent py-3.5 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        <ul className="max-h-96 overflow-y-auto p-2">
          {/* Resources still loading: a clear "working" row so the list never looks empty. */}
          {searching && !items.some((it) => it.type === "resource") ? (
            <li>
              <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Resources
              </p>
              <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin" /> Searching your estate…
              </div>
            </li>
          ) : null}
          {items.length === 0 && !searching ? (
            <li className="px-3 py-10 text-center text-sm text-muted-foreground">
              No matches - try a resource name, or press ↵ to ask Atlas.
            </li>
          ) : (
            items.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <li key={item.key}>
                  {header ? (
                    <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-1">
                      {header}
                    </p>
                  ) : null}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={(e) => run(item, { ask: e.shiftKey })}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      i === active ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {item.type === "ask" || (item.type === "nav" && item.href === "/ask") ? (
                      <span className="grid size-6 shrink-0 place-items-center">
                        <AtlasAiMark size={18} />
                      </span>
                    ) : item.type === "nav" ? (
                      <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-background">
                        <item.icon size={14} className="text-muted-foreground" />
                      </span>
                    ) : (
                      <ResourceIcon kind={item.kind} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                    {item.type === "resource" ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{item.sub}</span>
                    ) : null}
                    {i === active ? (
                      item.type === "ask" ? (
                        // The ask row's primary action already IS ask — just the enter glyph.
                        <CornerDownLeft size={13} className="shrink-0 text-muted-foreground" />
                      ) : (
                        // Surface the Shift alternate action inline on the row (not just the footer),
                        // so it's discoverable: a persistent "⇧ ask" chip that lights up — and swaps
                        // the ↵ for the AI mark — while Shift is actually held.
                        <span className="flex shrink-0 items-center gap-2">
                          <span
                            className={cn(
                              "flex items-center gap-1 text-[11px] transition-colors",
                              shiftHeld ? "text-foreground" : "text-muted-foreground/70",
                            )}
                          >
                            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] leading-none">
                              ⇧
                            </kbd>
                            ask
                          </span>
                          {shiftHeld ? (
                            <AtlasAiMark size={15} />
                          ) : (
                            <CornerDownLeft size={13} className="text-muted-foreground" />
                          )}
                        </span>
                      )
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {/* Keyboard hint footer - gives the palette a finished, app-like feel. */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <AtlasAiMark size={13} /> Press ↵ to ask Atlas anything
          </span>
          <span className="hidden items-center gap-2.5 sm:flex">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> select
            </span>
            {/* The Shift affordance — brightens while Shift is actually held so it reads as "active". */}
            <span
              className={cn(
                "flex items-center gap-1 transition-colors",
                shiftHeld && "text-foreground",
              )}
            >
              <Kbd>⇧</Kbd>
              <Kbd>↵</Kbd> ask
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Small keyboard-key chip for the palette footer. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
      {children}
    </kbd>
  );
}
