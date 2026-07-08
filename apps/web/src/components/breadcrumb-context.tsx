"use client";

import * as React from "react";
import type { Crumb } from "@/components/patterns/breadcrumbs";

/**
 * Breadcrumb wiring so page-specific crumbs can render in the shared top bar (next to the sidebar
 * toggle), not in the page body. A detail page publishes its crumbs with <SetBreadcrumbs>; the
 * header reads them with useBreadcrumbs. Client context because the header is rendered once by the
 * layout and can't otherwise see the current page's data (e.g. a finding title).
 */
interface BreadcrumbCtx {
  crumbs: Crumb[];
  setCrumbs: (c: Crumb[]) => void;
}
const BreadcrumbContext = React.createContext<BreadcrumbCtx | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([]);
  const value = React.useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbs(): Crumb[] {
  return React.useContext(BreadcrumbContext)?.crumbs ?? [];
}

/** Publish this page's breadcrumb into the top bar. Renders nothing; clears on unmount. */
export function SetBreadcrumbs({ items }: { items: Crumb[] }) {
  const set = React.useContext(BreadcrumbContext)?.setCrumbs;
  const key = JSON.stringify(items);
  // `key` captures items (JSON) so the effect only re-runs when the crumbs actually change.
  React.useEffect(() => {
    if (!set) return;
    set(items);
    return () => set([]);
  }, [key, set, items]);
  return null;
}
