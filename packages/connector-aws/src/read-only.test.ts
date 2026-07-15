import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * P2 — read-only by construction (a cardinal rule: no code path may mutate a customer's cloud). This
 * is an architectural-fitness test: it scans the AWS connector source for every `*Command` reference
 * and fails if any is a MUTATING SDK command. A future `PutObjectCommand` / `TerminateInstancesCommand`
 * / `DeleteBucketCommand` etc. — however innocently added — breaks CI here, long before it could ever
 * touch a customer account. (Belt-and-suspenders alongside the read-only IAM policy: even a
 * mis-scoped role couldn't be exploited if the code physically can't issue a write.)
 */

// Read-only AWS SDK command prefixes — the only verbs the crawler is allowed to use.
const READ_ONLY_PREFIXES = ["Describe", "Get", "List", "Lookup"];
// Non-read commands that are auth/identity (STS), never a customer-resource mutation.
const ALLOWED_EXACT = new Set(["AssumeRoleCommand", "GetCallerIdentityCommand"]);

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectTsFiles(p));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("P2 — AWS connector is read-only by construction", () => {
  it("references only read-only SDK commands (no Create/Put/Delete/Modify/Terminate/…)", () => {
    const commands = new Set<string>();
    for (const file of collectTsFiles(SRC_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]+Command)\b/g)) commands.add(m[1]);
    }

    // Sanity: we actually found the commands (guards against the scan silently matching nothing).
    expect(commands.size).toBeGreaterThan(10);

    const mutating = [...commands]
      .filter((c) => !ALLOWED_EXACT.has(c) && !READ_ONLY_PREFIXES.some((p) => c.startsWith(p)))
      .sort();

    expect(
      mutating,
      `mutating AWS SDK command(s) found — violates P2 (read-only by construction): ${mutating.join(", ")}`,
    ).toEqual([]);
  });
});
