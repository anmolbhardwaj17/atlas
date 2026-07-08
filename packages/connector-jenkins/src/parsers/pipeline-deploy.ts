/**
 * Deploy-evidence extraction from a Jenkins pipeline script (Jenkinsfile / the `<script>` in
 * a job's config.xml) — docs/07c §3. A pipeline is where a job says where it ships:
 *   - ECR image pushes (`<acct>.dkr.ecr.<region>.amazonaws.com/<repo>:tag`) — the strongest
 *     witness: the image lands on a crawled ECR repo whose USES_IMAGE taskdef chain resolves
 *     to the exact ECS service (docs/05 R1/R7).
 *   - `aws ecs update-service --cluster X --service Y` — direct target naming.
 *   - `aws lambda update-function-code --function-name Z` — direct target naming.
 *
 * Text-scan, not a Groovy parse: we extract evidence, not semantics — and anything containing an
 * unresolved `$VAR`/`${VAR}` is SKIPPED, never guessed (P3: a missing edge beats a wrong one).
 * The connector only observes; the DEPLOYS_TO inference happens in R1 (connectors observe, rules
 * infer — P4). The output shape is identical to the GitHub/Bitbucket deploy signals so R1 needs no
 * Jenkins-specific code beyond registering the signal kind.
 */

export interface EcrImageRef {
  account: string;
  region: string;
  repository: string;
}

export type DeployTargetRef =
  { kind: "ecs"; cluster: string | null; service: string } | { kind: "lambda"; function: string };

export interface PipelineDeployEvidence {
  ecrImages: EcrImageRef[];
  targets: DeployTargetRef[];
}

const ECR_IMAGE = /(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([a-zA-Z0-9._/-]+)/g;

/** Skip any value that still holds an unresolved shell/groovy variable. */
function unresolved(value: string): boolean {
  return value.includes("$") || value.includes("${");
}

/** `--flag value` or `--flag=value`; value ends at whitespace/quote/paren. */
function flag(line: string, name: string): string | null {
  const m = new RegExp(`--${name}[=\\s]+["']?([^\\s"'();]+)`).exec(line);
  const v = m?.[1];
  return v && !unresolved(v) ? v : null;
}

export function parsePipelineDeploys(script: string): PipelineDeployEvidence {
  const ecrImages: EcrImageRef[] = [];
  const targets: DeployTargetRef[] = [];
  const seenImg = new Set<string>();
  const seenTgt = new Set<string>();

  for (const m of script.matchAll(ECR_IMAGE)) {
    const account = m[1] ?? "";
    const region = m[2] ?? "";
    const repository = (m[3] ?? "").replace(/[:@].*$/, "").replace(/\/+$/, "");
    if (!account || !region || !repository || unresolved(repository)) continue;
    const key = `${account}/${region}/${repository}`;
    if (seenImg.has(key)) continue;
    seenImg.add(key);
    ecrImages.push({ account, region, repository });
  }

  for (const line of script.split(/\r?\n/)) {
    if (/aws\s+ecs\s+update-service/.test(line)) {
      const service = flag(line, "service");
      if (service) {
        const cluster = flag(line, "cluster");
        const key = `ecs:${cluster ?? ""}/${service}`;
        if (!seenTgt.has(key)) {
          seenTgt.add(key);
          targets.push({ kind: "ecs", cluster, service });
        }
      }
    }
    if (/aws\s+lambda\s+update-function-code/.test(line)) {
      const fn = flag(line, "function-name");
      if (fn) {
        const key = `lambda:${fn}`;
        if (!seenTgt.has(key)) {
          seenTgt.add(key);
          targets.push({ kind: "lambda", function: fn });
        }
      }
    }
  }

  return { ecrImages, targets };
}
