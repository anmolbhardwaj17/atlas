import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { roleMeta, severityMeta } from "@/lib/taxonomy";

/**
 * Categorical tag primitives built on the shadcn `Badge` + the `taxonomy` metadata, so a
 * category always renders identically wherever it appears. Semantic status/certainty tags
 * live in `certainty.tsx`; these are the identity/category tags (roles today, more later).
 */

/** Org role as a privilege-ranked, iconed tag (Owner / Admin / Member). */
export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const m = roleMeta(role);
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", m.className, className)}>
      <Icon className="size-3" aria-hidden />
      {m.label}
    </Badge>
  );
}

/** Finding severity as a filled tag (High / Medium / Low) - dashboard "needs attention". */
export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const m = severityMeta(severity);
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", m.className, className)}>
      <Icon className="size-3" aria-hidden />
      {m.label}
    </Badge>
  );
}
