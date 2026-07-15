"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  CheckCircle2,
  CircleAlert,
  Info,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { CloudIcon } from "@/components/cloud-icon";
import { kindIcon, KIND_LOGO } from "@/lib/kind-visual";
import {
  getInbox,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "@/lib/browser-api";

const POLL_MS = 45_000;

// Only the glyph carries the severity color; the circle stays neutral (no tinted background).
const SEVERITY_ICON: Record<NotificationItem["severity"], { icon: LucideIcon; color: string }> = {
  success: { icon: CheckCircle2, color: "text-success" },
  danger: { icon: TriangleAlert, color: "text-danger" },
  warning: { icon: CircleAlert, color: "text-warning" },
  info: { icon: Info, color: "text-muted-foreground" },
};

/** Compact relative time: "just now", "5m", "3h", "2d". */
function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Notification bell (top bar). A durable in-app inbox alongside the ephemeral toasts: the
 * unread count polls quietly; opening the panel shows recent notifications (health changes and
 * other noteworthy events), each linking to the relevant view. Marking read is org-level.
 */
export function NotificationBell({ orgId }: { orgId: string }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Close on any click outside the bell + Escape. (A fixed-inset backdrop won't work here: the
  // header's backdrop-blur is a containing block, so a fixed overlay is clipped to the header.)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const refresh = useCallback(async () => {
    try {
      const feed = await getInbox(orgId);
      setItems(feed.items);
      setUnread(feed.unread);
    } catch {
      /* quiet - the bell is best-effort */
    }
  }, [orgId]);

  // Poll the unread count quietly in the background.
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  }

  async function markAll() {
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    await markAllNotificationsRead(orgId).catch(() => void refresh());
  }

  async function openItem(item: NotificationItem) {
    setOpen(false);
    if (!item.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)),
      );
      void markNotificationRead(orgId, item.id).catch(() => {});
    }
    if (item.href) router.push(item.href);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="absolute right-0 z-50 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAll()}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Check className="size-3.5" /> Mark all read
                </button>
              ) : null}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell className="mx-auto mb-2 size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">You&apos;re all caught up</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Health changes and other alerts will show up here.
                  </p>
                </div>
              ) : (
                <ul className="motion-stagger divide-y divide-border">
                  {items.map((item) => {
                    const sev = SEVERITY_ICON[item.severity];
                    const SevIcon = sev.icon;
                    // Prefer the real resource logo (e.g. the AWS RDS mark) on a severity-tinted
                    // circle; fall back to the severity icon when there's no node/logo.
                    const logo = item.nodeKind ? KIND_LOGO[item.nodeKind] : undefined;
                    const KindIcon = item.nodeKind ? kindIcon(item.nodeKind) : null;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => void openItem(item)}
                          className={cn(
                            "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
                            // Read rows sit on a clearly darker grey; unread stay bright on the
                            // card. That contrast is how read/unread reads at a glance.
                            item.readAt ? "bg-muted/80 hover:bg-muted" : "hover:bg-muted/30",
                          )}
                        >
                          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                            {logo ? (
                              <CloudIcon name={logo} className="size-[18px]" />
                            ) : KindIcon ? (
                              <KindIcon className={cn("size-4", sev.color)} />
                            ) : (
                              <SevIcon className={cn("size-4", sev.color)} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span
                                className={cn(
                                  "truncate text-sm",
                                  item.readAt ? "font-normal" : "font-medium",
                                )}
                              >
                                {item.title}
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {ago(item.createdAt)}
                              </span>
                            </span>
                            {item.body ? (
                              <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                                {item.body}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
