"use client";

import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";
import { Separator } from "@/components/ui/separator";

/** The top-bar breadcrumb slot — shows the current page's crumbs (published via SetBreadcrumbs),
 *  or nothing on top-level pages. Sits right after the sidebar toggle. */
export function HeaderBreadcrumbs() {
  const crumbs = useBreadcrumbs();
  if (crumbs.length === 0) return null;
  return (
    <>
      <Separator orientation="vertical" className="mr-1 h-4" />
      <Breadcrumbs items={crumbs} />
    </>
  );
}
