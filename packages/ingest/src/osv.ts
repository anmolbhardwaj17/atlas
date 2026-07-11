/**
 * OSV.dev client (docs/plans/security-vulnerabilities.md, step 2). OSV is Google's free, no-account
 * vulnerability database aggregating GHSA/CVE across ecosystems. We use it to turn `package@version`
 * dependency nodes into real, cited `vulnerability` findings — the "no extra scanner account"
 * intelligence path. Pure `fetch` client (no SDK), best-effort (a failed lookup never breaks a sync).
 *
 * API: POST /v1/querybatch (package -> vuln ids, index-aligned) then GET /v1/vulns/{id} (full record).
 */

import { fetchWithTimeout } from "@atlas/connector-sdk";

// Default fetch with a hard deadline (OSV runs inside the sync worker; a hung socket must not stall
// it). Tests inject their own `fetchImpl`, so they're unaffected.
const timeoutFetch: typeof fetch = (input, init) =>
  fetchWithTimeout(input as string | URL, (init ?? {}) as RequestInit);

const BATCH_ENDPOINT = "https://api.osv.dev/v1/querybatch";
const VULN_ENDPOINT = "https://api.osv.dev/v1/vulns";
const BATCH_SIZE = 100; // OSV accepts up to 1000/batch; keep it modest.
const DETAIL_CONCURRENCY = 8;

/** OSV ecosystem identifiers (a subset — the ones our manifest parser emits). */
export type OsvEcosystem =
  "npm" | "PyPI" | "Go" | "Maven" | "RubyGems" | "crates.io" | "NuGet" | "Packagist";

export interface OsvQueryPkg {
  name: string;
  version: string;
  ecosystem: OsvEcosystem;
}

export type VulnSeverity = "critical" | "high" | "medium" | "low" | "unknown";

export interface OsvVulnerability {
  id: string; // GHSA-… or CVE-…
  summary: string | null;
  severity: VulnSeverity;
  aliases: string[];
  /** First fixed version from the affected ranges, if OSV provides one. */
  fixedVersion: string | null;
  /** Primary advisory URL (for provenance / citation). */
  reference: string | null;
  published: string | null;
}

export interface PackageVulns {
  pkg: OsvQueryPkg;
  vulnerabilities: OsvVulnerability[];
}

export interface OsvClientConfig {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  batchEndpoint?: string;
  vulnEndpoint?: string;
}

/** `ecosystem:name@version` — the stable key aligning batch queries to their packages. */
export function pkgKey(p: OsvQueryPkg): string {
  return `${p.ecosystem}:${p.name}@${p.version}`;
}

interface BatchResponse {
  results?: Array<{ vulns?: Array<{ id?: string }> } | null>;
}
interface OsvRecord {
  id?: string;
  summary?: string;
  aliases?: string[];
  published?: string;
  severity?: Array<{ type?: string; score?: string }>;
  affected?: Array<{
    ranges?: Array<{ events?: Array<{ fixed?: string }> }>;
    database_specific?: { severity?: string };
  }>;
  references?: Array<{ type?: string; url?: string }>;
  database_specific?: { severity?: string };
}

export class OsvClient {
  private readonly fetchImpl: typeof fetch;
  private readonly batchEndpoint: string;
  private readonly vulnEndpoint: string;

  constructor(config: OsvClientConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? timeoutFetch;
    this.batchEndpoint = config.batchEndpoint ?? BATCH_ENDPOINT;
    this.vulnEndpoint = config.vulnEndpoint ?? VULN_ENDPOINT;
  }

  /** Batch-map each package → its vuln ids (index-aligned; empty on any error — best-effort). */
  async queryBatch(pkgs: OsvQueryPkg[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (let i = 0; i < pkgs.length; i += BATCH_SIZE) {
      const chunk = pkgs.slice(i, i + BATCH_SIZE);
      const body = {
        queries: chunk.map((p) => ({
          package: { name: p.name, ecosystem: p.ecosystem },
          version: p.version,
        })),
      };
      try {
        const res = await this.fetchImpl(this.batchEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as BatchResponse;
        const results = data.results ?? [];
        chunk.forEach((p, idx) => {
          const ids = (results[idx]?.vulns ?? [])
            .map((v) => v.id)
            .filter((id): id is string => typeof id === "string");
          if (ids.length > 0) out.set(pkgKey(p), ids);
        });
      } catch {
        // best-effort: skip this chunk
      }
    }
    return out;
  }

  /** Full record for one vuln id → our normalized shape (null on error). */
  async getVulnerability(id: string): Promise<OsvVulnerability | null> {
    try {
      const res = await this.fetchImpl(`${this.vulnEndpoint}/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      return normalizeRecord((await res.json()) as OsvRecord);
    } catch {
      return null;
    }
  }

  /**
   * End-to-end scan: batch-query the packages, fetch each unique vuln once (bounded concurrency),
   * and return the vulnerabilities per package. Deterministic given the same OSV responses.
   */
  async scan(pkgs: OsvQueryPkg[]): Promise<PackageVulns[]> {
    if (pkgs.length === 0) return [];
    const byPkg = await this.queryBatch(pkgs);
    const uniqueIds = [...new Set([...byPkg.values()].flat())];
    const details = new Map<string, OsvVulnerability>();
    await mapPool(uniqueIds, DETAIL_CONCURRENCY, async (id) => {
      const v = await this.getVulnerability(id);
      if (v) details.set(id, v);
    });
    return pkgs.map((p) => ({
      pkg: p,
      vulnerabilities: (byPkg.get(pkgKey(p)) ?? [])
        .map((id) => details.get(id))
        .filter((v): v is OsvVulnerability => v !== undefined),
    }));
  }
}

const SEV_MAP: Record<string, VulnSeverity> = {
  critical: "critical",
  high: "high",
  moderate: "medium",
  medium: "medium",
  low: "low",
};

function normalizeRecord(r: OsvRecord): OsvVulnerability | null {
  if (!r.id) return null;
  const sevStr = (
    r.database_specific?.severity ??
    r.affected?.find((a) => a.database_specific?.severity)?.database_specific?.severity ??
    ""
  ).toLowerCase();
  const severity = SEV_MAP[sevStr] ?? "unknown";
  const fixedVersion =
    r.affected
      ?.flatMap((a) => a.ranges ?? [])
      .flatMap((rg) => rg.events ?? [])
      .map((e) => e.fixed)
      .find((f): f is string => typeof f === "string") ?? null;
  const reference =
    r.references?.find((x) => x.type === "ADVISORY")?.url ?? r.references?.[0]?.url ?? null;
  return {
    id: r.id,
    summary: r.summary ?? null,
    severity,
    aliases: r.aliases ?? [],
    fixedVersion,
    reference,
    published: r.published ?? null,
  };
}

/** Run `fn` over items with bounded concurrency. */
async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}
