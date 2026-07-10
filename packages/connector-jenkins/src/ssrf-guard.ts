import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for the Jenkins connector (security sweep H1). Unlike the AWS/GitHub/Bitbucket
 * connectors — which talk to fixed, trusted hosts — Jenkins' `baseUrl` is **tenant-supplied**, so an
 * authenticated Atlas worker can be pointed at internal targets: cloud metadata (169.254.169.254),
 * Atlas's own OpenSearch/Redis on loopback, RFC1918 services, etc. We refuse any URL whose host is —
 * or (after DNS) resolves to — a private/loopback/link-local/CGNAT address, at BOTH parse time
 * (literal hosts) and request time (defends against a public name that maps to an internal IP, and
 * most DNS-rebinding). Read-only (P2) is about *writes*; this is about *where we're allowed to read*.
 */

export class SsrfBlockedError extends Error {
  constructor(readonly host: string) {
    super(
      `Refusing to connect to "${host}": it is (or resolves to) a private, loopback, or ` +
        `link-local address. Point Atlas at a publicly-reachable Jenkins URL.`,
    );
    this.name = "SsrfBlockedError";
  }
}

/** Hostnames that are internal by convention (never a legitimate public Jenkins). */
const BLOCKED_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

function isBlockedV4(ip: string): boolean {
  const p = ip.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isBlockedV6(ip: string): boolean {
  const l = ip.toLowerCase();
  if (l === "::1" || l === "::") return true; // loopback / unspecified
  if (l.startsWith("fe80")) return true; // fe80::/10 link-local
  if (l.startsWith("fc") || l.startsWith("fd")) return true; // fc00::/7 unique-local
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — classify the embedded v4.
  const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
  if (m?.[1]) return isBlockedV4(m[1]);
  return false;
}

/** True if a *literal IP* is in a blocked range. Unparseable → blocked (fail closed). */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true;
}

/** Strip IPv6 URL brackets and lowercase, so `[::1]` and `LocalHost` normalize. */
function normalizeHost(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

/**
 * Parse-time guard: reject an obviously-internal literal host (a private IP literal, `localhost`,
 * or a `.localhost`/`.internal`/`.local` suffix). Cannot catch a public name that maps to a private
 * IP — that's what {@link assertResolvesToPublic} is for.
 */
export function assertHostAllowed(hostname: string): void {
  const host = normalizeHost(hostname);
  if (!host) throw new SsrfBlockedError(hostname);
  if (
    BLOCKED_NAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new SsrfBlockedError(hostname);
  }
  if (isIP(host) && isBlockedIp(host)) throw new SsrfBlockedError(hostname);
}

type Resolver = (host: string) => Promise<Array<{ address: string }>>;
const defaultResolver: Resolver = (host) => dnsLookup(host, { all: true });

/**
 * Request-time guard: resolve `hostname` and reject if ANY returned address is blocked. Run before
 * every fetch so a public name that points at an internal IP is refused, and a DNS-rebind that
 * flips to a private answer is caught on its next request. `resolver` is injectable for tests.
 */
export async function assertResolvesToPublic(
  hostname: string,
  resolver: Resolver = defaultResolver,
): Promise<void> {
  const host = normalizeHost(hostname);
  // A literal IP never hits DNS — classify it directly.
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfBlockedError(hostname);
    return;
  }
  assertHostAllowed(hostname); // cheap literal-name rejection first
  let addrs: Array<{ address: string }>;
  try {
    addrs = await resolver(host);
  } catch {
    throw new SsrfBlockedError(hostname); // unresolvable → refuse (fail closed)
  }
  if (addrs.length === 0) throw new SsrfBlockedError(hostname);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfBlockedError(hostname);
  }
}
