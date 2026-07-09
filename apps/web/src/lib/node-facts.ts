/**
 * Curated, human-readable facts about a resource — the "what IS this thing" answer, so a detail
 * page leads with meaning (engine, endpoint, runtime) instead of a raw camelCase attribute dump.
 * Per-kind headline facts first, then a capped generic scalar fallback. Mirrors the map's detail
 * panel so the two surfaces read the same.
 */

/** ISO date → compact local form; anything else unchanged. */
function fact(v: unknown): string {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  }
  return s;
}

/** camelCase attribute key → readable label ("engineVersion" → "Engine version"). */
export function prettyKey(key: string): string {
  const words = key
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Shown elsewhere on the page (or pure noise, or already folded into a curated fact) — excluded
// from the generic key-facts fallback.
const FACT_SKIP = new Set([
  "region",
  "accountRef",
  "health",
  "tags",
  "vpcConfig",
  "role",
  "isPrivate",
  "fullName",
  "description",
  // Folded into curated "Engine"/"Endpoint" facts — don't repeat them generically.
  "engineVersion",
  "endpointAddress",
  "endpointPort",
]);

/** Normalise a label/key for dedupe so "Multi-AZ" and "Multi az" collapse to one. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Per-kind headline facts, then a generic scalar fallback — capped so it stays a summary. */
export function keyFacts(
  kind: string,
  attributes: Record<string, unknown>,
): Array<[string, string]> {
  const a = attributes ?? {};
  const get = (k: string): unknown => a[k];
  const out: Array<[string, string]> = [];
  const push = (label: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") out.push([label, fact(v)]);
  };

  switch (kind) {
    case "aws.lambda.function":
      push("Runtime", get("runtime"));
      push("Handler", get("handler"));
      push("Memory", get("memorySize"));
      break;
    case "aws.ec2.instance":
      push("Type", get("instanceType"));
      push("State", get("state"));
      push("Private IP", get("privateIp"));
      break;
    case "aws.rds.instance": {
      const engine = get("engine");
      const ver = get("engineVersion");
      push("Engine", engine ? `${String(engine)}${ver ? ` ${String(ver)}` : ""}` : undefined);
      const host = get("endpointAddress");
      push("Endpoint", host ? `${String(host)}:${String(get("endpointPort") ?? "")}` : undefined);
      push("Multi-AZ", get("multiAz"));
      break;
    }
    case "aws.elb":
      push("Type", get("type"));
      push("Scheme", get("scheme"));
      push("DNS", get("dnsName"));
      break;
    case "aws.ecs.service": {
      push("Cluster", get("cluster"));
      push("Desired tasks", get("desiredCount"));
      const td = get("taskDefinition");
      if (typeof td === "string") {
        const m = /task-definition\/(.+)$/.exec(td);
        push("Task definition", m?.[1] ?? td);
      }
      break;
    }
    case "aws.s3.bucket":
      push("Created", get("creationDate"));
      break;
    case "bitbucket.repository":
    case "github.repository":
      push("Language", get("language"));
      push("Main branch", get("mainBranch") ?? get("defaultBranch"));
      push("Updated", get("updatedOn") ?? get("updatedAt"));
      break;
    default:
      break;
  }

  // Generic fallback: remaining scalar attributes, capped so the panel stays a summary.
  const seen = new Set(out.map(([l]) => norm(l)));
  for (const [k, v] of Object.entries(a)) {
    if (out.length >= 6) break;
    if (FACT_SKIP.has(k) || seen.has(norm(prettyKey(k)))) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    push(prettyKey(k), v);
  }
  return out.slice(0, 6);
}

/** Kinds whose CloudWatch coverage is worth pointing at → the metric dimension value. */
const CLOUDWATCH_KINDS: Record<string, (a: Record<string, unknown>) => string | null> = {
  "aws.ec2.instance": (a) => (typeof a.instanceId === "string" ? a.instanceId : null),
  "aws.lambda.function": (a) => (typeof a.functionName === "string" ? a.functionName : null),
  "aws.rds.instance": (a) =>
    typeof a.dbInstanceIdentifier === "string" ? a.dbInstanceIdentifier : null,
  "aws.elb": (a) => (typeof a.loadBalancerName === "string" ? a.loadBalancerName : null),
  "aws.ecs.service": (a) => (typeof a.serviceName === "string" ? a.serviceName : null),
};

/** A deep link into the AWS CloudWatch console for a resource (zero fetch — nothing is read or
 *  stored). Null when the kind/region isn't monitorable. Mirrors the map's MonitoringRow. */
export function cloudwatchLink(
  kind: string,
  region: string | null,
  attributes: Record<string, unknown>,
): string | null {
  const dim = CLOUDWATCH_KINDS[kind]?.(attributes ?? {});
  if (!dim || !region) return null;
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#metricsV2:graph=~();query=~'${encodeURIComponent(dim)}`;
}
