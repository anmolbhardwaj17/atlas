/**
 * CODEOWNERS parser (docs/07 §7.2, pure). Maps path patterns → owning teams/users.
 * Owner tokens: `@org/team` → team, `@login` → user, `email@x` → ignored (no node).
 * The connector emits observed OWNED_BY edges from the distinct owners (ownership
 * propagation to the derived service is the inferred R5 step, not here).
 */
export interface CodeownersRule {
  pattern: string;
  owners: string[];
}

export type CodeownerRef =
  { type: "team"; org: string; slug: string } | { type: "user"; login: string };

/** Parse CODEOWNERS content into ordered rules (comments/blank lines skipped). */
export function parseCodeowners(content: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern || owners.length === 0) continue;
    rules.push({ pattern, owners });
  }
  return rules;
}

/** Classify an owner token; returns null for emails / malformed tokens (no node). */
export function classifyOwner(token: string): CodeownerRef | null {
  if (!token.startsWith("@")) return null; // email or junk
  const body = token.slice(1);
  const slash = body.indexOf("/");
  if (slash > 0) {
    return { type: "team", org: body.slice(0, slash), slug: body.slice(slash + 1) };
  }
  if (body.length > 0) return { type: "user", login: body };
  return null;
}

/** Distinct, resolvable owners across all rules (dedup by token). */
export function distinctOwners(rules: CodeownersRule[]): CodeownerRef[] {
  const seen = new Set<string>();
  const out: CodeownerRef[] = [];
  for (const rule of rules) {
    for (const token of rule.owners) {
      if (seen.has(token)) continue;
      seen.add(token);
      const ref = classifyOwner(token);
      if (ref) out.push(ref);
    }
  }
  return out;
}
