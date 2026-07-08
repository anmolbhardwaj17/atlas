import type { ResourceRef } from "@atlas/connector-sdk";
import type { JenkinsClient } from "./client";
import type { JobPayload } from "./job";

interface RawJob {
  _class?: string;
  name?: string;
  fullName?: string;
  url?: string;
  color?: string;
  buildable?: boolean;
  lastBuild?: { number?: number; result?: string; timestamp?: number } | null;
  jobs?: RawJob[];
}

// Jenkins nests jobs inside folders; the tree API can't recurse unbounded, so we ask for a few
// levels and flatten to leaf jobs. Deeply-nested folders beyond this are a rare edge (07c §10).
const LEAF = "name,fullName,url,color,buildable,lastBuild[number,result,timestamp]";
const TREE = `jobs[_class,${LEAF},jobs[_class,${LEAF},jobs[_class,${LEAF}]]]`;

function isFolder(j: RawJob): boolean {
  return Array.isArray(j.jobs) && j.jobs.length > 0;
}

function* flatten(jobs: RawJob[]): Generator<RawJob> {
  for (const j of jobs) {
    if (isFolder(j)) yield* flatten(j.jobs ?? []);
    else yield j;
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Best-effort extract of the pipeline script + SCM git url from a job's config.xml. */
function parseConfigXml(xml: string | null): { script: string | null; scmUrl: string | null } {
  if (!xml) return { script: null, scmUrl: null };
  const script = /<script>([\s\S]*?)<\/script>/.exec(xml)?.[1];
  const scmUrl = /<url>\s*((?:https?:\/\/|git@)[^<]+)<\/url>/.exec(xml)?.[1]?.trim() ?? null;
  return { script: script ? decodeXml(script) : null, scmUrl };
}

/**
 * Enumerate every job on the server, enriching each with its pipeline script + SCM url (from
 * config.xml) so normalize/extractSignals are pure. One tree call + one config.xml per job.
 */
export async function* discoverJobs(
  client: JenkinsClient,
  baseUrl: string,
  scopeKey: string,
  signal?: AbortSignal,
): AsyncIterable<{ ref: ResourceRef; payload: JobPayload }> {
  const root = await client.json<{ jobs?: RawJob[] }>(`/api/json?tree=${TREE}`, signal);
  for (const j of flatten(root.jobs ?? [])) {
    const fullName = j.fullName ?? j.name;
    if (!fullName) continue;
    const jobPath = j.url
      ? new URL(j.url).pathname.replace(/\/+$/, "")
      : `/job/${encodeURIComponent(fullName)}`;
    const { script, scmUrl } = parseConfigXml(await client.text(`${jobPath}/config.xml`, signal));
    const payload: JobPayload = {
      baseUrl,
      fullName,
      name: j.name ?? fullName,
      url: j.url ?? "",
      color: j.color ?? "",
      buildable: j.buildable ?? null,
      lastBuild: j.lastBuild ?? null,
      script,
      scmUrl,
    };
    yield { ref: { scopeKey, externalId: `job:${fullName}`, kind: "jenkins.job" }, payload };
  }
}
