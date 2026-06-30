/**
 * Org slug helpers (docs/04 — slug CHECK is `^[a-z0-9-]{3,40}$`). `deriveSlug`
 * turns a display name into a valid slug; `isValidSlug` mirrors the DB constraint
 * so we fail with a clean validation error instead of a raw constraint violation.
 */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9-]{3,40}$/.test(value);
}

export function deriveSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  // Pad short/empty results so the {3,40} constraint holds (e.g. name "AI" → "ai-org").
  return base.length >= 3 ? base : `${base || "org"}-org`.slice(0, 40);
}
