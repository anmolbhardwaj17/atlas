/**
 * Deploy-evidence extraction from `bitbucket-pipelines.yml` (docs/plans/operational-
 * intelligence.md Phase A). The pipeline file is where a repo says where it ships:
 *   - ECR image pushes (`<acct>.dkr.ecr.<region>.amazonaws.com/<repo>:tag`) — the
 *     strongest witness: the image lands on a crawled ECR repository, whose USES_IMAGE
 *     taskdef chain resolves to the exact ECS service.
 *   - `aws ecs update-service --cluster X --service Y` — direct target naming.
 *   - `aws lambda update-function-code --function-name Z` — direct target naming.
 * Text-scan, not YAML-parse: we extract evidence, we don't execute semantics — and
 * anything containing an unresolved `$VARIABLE` is SKIPPED rather than guessed (P3:
 * prefer a missing edge to a wrong one). The connector only observes; the DEPLOYS_TO
 * inference itself happens in the R1 rule (connectors observe, rules infer — P4).
 */

export interface EcrImageRef {
  account: string;
  region: string;
  /** ECR repository name (may contain `/` for namespaced repos), tag/digest stripped. */
  repository: string;
}

export type DeployTargetRef =
  | { kind: "ecs"; cluster: string | null; service: string; environment?: string | null }
  | { kind: "lambda"; function: string; environment?: string | null };

/**
 * One set of pipeline variables to expand before extraction. Real pipelines are
 * parameterized (`--cluster $CLUSTER_NAME`), and the values live in Bitbucket's repo /
 * deployment-environment variables — readable via API when non-secured. A repo with three
 * deployment environments yields three var sets → three concrete target sets (demo,
 * pilot, production are all true deploy targets).
 */
export interface PipelineVarSet {
  /** Deployment-environment name (evidence attribution), or null for repo-level vars. */
  environment: string | null;
  vars: Record<string, string>;
}

export interface PipelineDeployEvidence {
  ecrImages: EcrImageRef[];
  targets: DeployTargetRef[];
}

const ECR_IMAGE = /(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([a-zA-Z0-9._/-]+)/g;

/**
 * Atlassian's official AWS Pipes — the idiomatic way a Bitbucket pipeline talks to AWS, and the
 * form real pipelines actually use. We were only reading raw `aws` CLI lines and full ECR image
 * URIs, so an entire deploy style was invisible: a repo whose pipeline is
 *
 *     - pipe: atlassian/aws-ecr-push-image:1.5.0
 *       variables:
 *         AWS_OIDC_ROLE_ARN: 'arn:aws:iam::123456789012:role/Bitbucket-ECR-Pipeline-Role'
 *         AWS_DEFAULT_REGION: $AWS_DEFAULT_REGION
 *         IMAGE_NAME: ${IMAGE_NAME}
 *
 * never writes the `<acct>.dkr.ecr.<region>.amazonaws.com/<repo>` string the regex above needs —
 * yet it names the account, region and repository between them. Reassembling those recovers the
 * strongest witness we have (image → ECR repo → taskdef USES_IMAGE → the exact ECS service).
 */
const AWS_PIPE = /^-?\s*pipe:\s*["']?atlassian\/(aws-[a-z0-9-]+)/;
/** The account is usually only stated inside the OIDC role ARN the pipe assumes. */
const ACCOUNT_IN_ARN = /arn:aws:iam::(\d{12}):/;

interface PipeBlock {
  pipe: string;
  vars: Record<string, string>;
}

/**
 * Collect `pipe:` invocations with their `variables:` mapping.
 *
 * Indentation-scoped rather than YAML-parsed, matching this module's existing text-scan stance: we
 * are extracting evidence, not executing semantics, and a real `bitbucket-pipelines.yml` is full of
 * anchors/merges (`<<: *update_ecs`) that a strict parse would have to resolve anyway. A line
 * indented deeper than its `pipe:` belongs to that pipe; the first dedent ends the block.
 */
function collectPipeBlocks(text: string): PipeBlock[] {
  const out: PipeBlock[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const m = AWS_PIPE.exec(raw.trim());
    if (!m) continue;
    const indent = raw.search(/\S/);
    const vars: Record<string, string> = {};
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? "";
      if (!l.trim()) continue;
      if (l.search(/\S/) <= indent) break;
      const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.+?)\s*$/.exec(l.trim());
      if (kv?.[1] && kv[2]) vars[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
    out.push({ pipe: m[1] as string, vars });
  }
  return out;
}

/** `--flag value`, `--flag=value` — value ends at whitespace/quote/paren. */
function flag(line: string, name: string): string | null {
  const m = new RegExp(`--${name}[=\\s]+["']?([^\\s"'();]+)`).exec(line);
  return m?.[1] ?? null;
}

/** An extracted value is only usable when fully literal (no unresolved shell/yaml vars). */
function literal(value: string | null): string | null {
  if (!value) return null;
  return /[${}]/.test(value) ? null : value;
}

/** Expand `$KEY` / `${KEY}` for the known keys only; unknown/secured vars stay put (and
 *  any value still containing them is later dropped by `literal` — P3, never guess). */
function substitute(content: string, vars: Record<string, string>): string {
  let out = content;
  // Longest keys first so $NODE_SERVICE_NAME is never clobbered by a shorter $NODE.
  for (const key of Object.keys(vars).sort((a, b) => b.length - a.length)) {
    out = out.replaceAll(`\${${key}}`, vars[key] as string);
    out = out.replace(new RegExp(`\\$${key}\\b`, "g"), vars[key] as string);
  }
  return out;
}

export function parsePipelineDeploys(
  content: string,
  varSets: PipelineVarSet[] = [],
): PipelineDeployEvidence {
  const ecrSeen = new Map<string, EcrImageRef>();
  const targets: DeployTargetRef[] = [];
  const targetSeen = new Set<string>();

  // One extraction pass on the raw file (fully-literal pipelines), plus one per var set.
  const passes: Array<{ environment: string | null; text: string }> = [
    { environment: null, text: content },
    ...varSets.map((v) => ({ environment: v.environment, text: substitute(content, v.vars) })),
  ];

  for (const pass of passes) {
    // Atlassian AWS Pipes. Runs on the substituted text, so `IMAGE_NAME: ${IMAGE_NAME}` resolves
    // from the deployment-environment variables — and a repo with demo/pilot/production envs yields
    // a target per environment, each correctly attributed.
    for (const { pipe, vars } of collectPipeBlocks(pass.text)) {
      if (pipe === "aws-ecr-push-image") {
        const account =
          literal(vars["AWS_ACCOUNT_ID"] ?? null) ??
          ACCOUNT_IN_ARN.exec(vars["AWS_OIDC_ROLE_ARN"] ?? "")?.[1] ??
          null;
        const region = literal(vars["AWS_DEFAULT_REGION"] ?? vars["AWS_REGION"] ?? null);
        const repository = literal((vars["IMAGE_NAME"] ?? "").split(":")[0]?.toLowerCase() ?? null);
        // All three or nothing — a half-known image would resolve to the wrong ECR repo (P3).
        if (account && region && repository) {
          ecrSeen.set(`${account}/${region}/${repository}`, { account, region, repository });
        }
      }

      if (pipe === "aws-lambda-deploy") {
        const fn = literal(vars["FUNCTION_NAME"] ?? null);
        if (fn && !targetSeen.has(`lambda:${fn}`)) {
          targetSeen.add(`lambda:${fn}`);
          targets.push({ kind: "lambda", function: fn, environment: pass.environment });
        }
      }

      if (pipe === "aws-ecs-deploy") {
        const service = literal(vars["SERVICE_NAME"] ?? null);
        const cluster = literal(vars["CLUSTER_NAME"] ?? null);
        if (service && !targetSeen.has(`ecs:${cluster}:${service}`)) {
          targetSeen.add(`ecs:${cluster}:${service}`);
          targets.push({ kind: "ecs", cluster, service, environment: pass.environment });
        }
      }
    }

    for (const rawLine of pass.text.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("#")) continue;

      for (const m of line.matchAll(ECR_IMAGE)) {
        const account = m[1] as string;
        const region = m[2] as string;
        // Strip :tag / @digest; skip repos that are themselves variable-templated.
        const repoRaw = ((m[3] as string).split("@")[0] ?? "").split(":")[0] ?? "";
        const repository = literal(repoRaw.toLowerCase());
        if (!repository) continue;
        ecrSeen.set(`${account}/${region}/${repository}`, { account, region, repository });
      }

      if (/\becs\s+update-service\b/.test(line)) {
        const service = literal(flag(line, "service"));
        const cluster = literal(flag(line, "cluster"));
        if (service && !targetSeen.has(`ecs:${cluster}:${service}`)) {
          targetSeen.add(`ecs:${cluster}:${service}`);
          targets.push({ kind: "ecs", cluster, service, environment: pass.environment });
        }
      }

      if (/\blambda\s+update-function-(code|configuration)\b/.test(line)) {
        const fn = literal(flag(line, "function-name"));
        if (fn && !targetSeen.has(`lambda:${fn}`)) {
          targetSeen.add(`lambda:${fn}`);
          targets.push({ kind: "lambda", function: fn, environment: pass.environment });
        }
      }
    }
  }

  return { ecrImages: [...ecrSeen.values()], targets };
}
