"use client";

import * as React from "react";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";

/**
 * Keeps the `atlas_active_org` cookie in sync with the server-resolved org so page-level
 * getPageAuth() can read the active org from the cookie WITHOUT a `/me` round-trip on every
 * navigation. Renders nothing; it just writes the cookie once on mount (and whenever the resolved
 * org changes). The OrgSwitcher already writes this cookie on an explicit switch — this covers the
 * common case where the user never switches, so the fast path is always primed after first paint.
 */
export function PersistActiveOrg({ orgId }: { orgId: string }) {
  React.useEffect(() => {
    const m = document.cookie.match(new RegExp(`(?:^|; )${ACTIVE_ORG_COOKIE}=([^;]*)`));
    const current = m?.[1] ? decodeURIComponent(m[1]) : null;
    if (current !== orgId) {
      document.cookie = `${ACTIVE_ORG_COOKIE}=${orgId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
  }, [orgId]);
  return null;
}
