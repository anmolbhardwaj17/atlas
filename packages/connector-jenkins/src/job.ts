import type { NodeUpsert, Signal } from "@atlas/connector-sdk";
import { jobUrn } from "./urn";
import { parsePipelineDeploys } from "./parsers/pipeline-deploy";

/** The (context-enriched) payload the crawl hands to normalize/extractSignals for one job. */
export interface JobPayload {
  baseUrl: string;
  fullName: string;
  name?: string;
  url?: string;
  color?: string;
  buildable?: boolean | null;
  lastBuild?: { number?: number; result?: string; timestamp?: number } | null;
  /** The pipeline script (Jenkinsfile / config.xml `<script>`), for deploy extraction. */
  script?: string | null;
  /** The job's SCM git remote (for the future BUILDS job→repo link). */
  scmUrl?: string | null;
}

/** A Jenkins job → `jenkins.job` node (docs/07c §2). */
export function jobNode(payload: unknown): NodeUpsert {
  const p = payload as JobPayload;
  const lb = p.lastBuild ?? null;
  return {
    urn: jobUrn(p.baseUrl, p.fullName),
    kind: "jenkins.job",
    displayName: p.name ?? p.fullName,
    attributes: {
      fullName: p.fullName,
      url: p.url ?? null,
      buildable: p.buildable ?? null,
      lastResult: lb?.result ?? colorToResult(p.color),
      lastBuildNumber: lb?.number ?? null,
      lastBuildAt: lb?.timestamp ? new Date(lb.timestamp).toISOString() : null,
      scmUrl: p.scmUrl ?? null,
    },
  };
}

/**
 * Deploy evidence → a `jenkins.deploy` signal (docs/07c §3/§4). Same `{repo, targets, ecrImages}`
 * shape as the GitHub/Bitbucket deploy signals, so R1 resolves it into DEPLOYS_TO with no
 * Jenkins-specific inference code. For Jenkins the *deployer* is the job itself (job → runtime),
 * so the job URN is the edge source (`data.repo`).
 */
export function jobSignals(payload: unknown): Signal[] {
  const p = payload as JobPayload;
  if (!p.script) return [];
  const d = parsePipelineDeploys(p.script);
  if (d.targets.length === 0 && d.ecrImages.length === 0) return [];
  const self = jobUrn(p.baseUrl, p.fullName);
  return [
    {
      kind: "jenkins.deploy",
      subjectUrn: self,
      data: { repo: self, targets: d.targets, ecrImages: d.ecrImages },
    },
  ];
}

/** Jenkins encodes last-build status in the ball "color" (blue=ok, red=fail, yellow=unstable). */
function colorToResult(color?: string): string | null {
  if (!color) return null;
  const c = color.replace(/_anime$/, "");
  if (c === "blue") return "SUCCESS";
  if (c === "red") return "FAILURE";
  if (c === "yellow") return "UNSTABLE";
  if (c === "disabled" || c === "notbuilt" || c === "aborted") return c.toUpperCase();
  return null;
}
