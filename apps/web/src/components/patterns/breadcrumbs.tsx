import * as React from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * App breadcrumb — composed over the shadcn Breadcrumb primitive. The last crumb is the current
 * page (non-link); earlier crumbs link to their section. Use on nested/detail pages so there's a
 * consistent way back and a sense of place (e.g. Insights › <finding title>).
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <React.Fragment key={i}>
              <BreadcrumbItem>
                {last || !c.href ? (
                  <BreadcrumbPage className="max-w-[48ch] truncate">{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={c.href}>{c.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {last ? null : <BreadcrumbSeparator />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
