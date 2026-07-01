/**
 * GitHub Actions workflow parser (docs/07 §7.1, pure). Extracts AWS deploy hints —
 * official AWS actions, ECS deploy `with:` params, `--cluster/--service/--function-name`
 * flags in `run:` scripts, and any ARNs — as candidate deploy TARGETS. These are emitted
 * as SIGNALS; resolving them to actual AWS nodes and deciding confidence is the R1
 * inference step (G1), not the connector (P3, docs/07 §7.1).
 */
import { parse as parseYaml } from "yaml";

export type DeployTarget =
  | { kind: "ecs"; cluster: string | null; service: string }
  | { kind: "lambda"; function: string }
  | { kind: "arn"; arn: string };

export interface WorkflowDeploys {
  /** AWS actions referenced (e.g. aws-actions/amazon-ecs-deploy-task-definition@v2). */
  actions: string[];
  targets: DeployTarget[];
}

const ARN_RE = /arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d{0,12}:[^\s"']+/g;

export function parseWorkflowDeploys(content: string): WorkflowDeploys {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return { actions: [], targets: [] };
  }

  const actions: string[] = [];
  const targets: DeployTarget[] = [];
  const seenTarget = new Set<string>();
  const pushTarget = (t: DeployTarget): void => {
    const key = JSON.stringify(t);
    if (!seenTarget.has(key)) {
      seenTarget.add(key);
      targets.push(t);
    }
  };

  for (const step of iterateSteps(doc)) {
    const uses = typeof step.uses === "string" ? step.uses : null;
    if (uses && uses.startsWith("aws-actions/")) actions.push(uses);

    const w = isRecord(step.with) ? step.with : {};
    if (uses && /amazon-ecs-deploy-task-definition/.test(uses)) {
      const service = str(w.service);
      if (service) pushTarget({ kind: "ecs", cluster: str(w.cluster), service });
    }
    const fn = str(w["function-name"]) ?? str(w.function_name);
    if (fn) pushTarget({ kind: "lambda", function: fn });

    if (typeof step.run === "string") {
      for (const t of parseRunScript(step.run)) pushTarget(t);
    }
  }

  // ARNs anywhere in the file (with:/env/run) are strong deploy hints.
  for (const arn of content.match(ARN_RE) ?? []) pushTarget({ kind: "arn", arn });

  return { actions, targets };
}

function parseRunScript(run: string): DeployTarget[] {
  const out: DeployTarget[] = [];
  const ecs = /aws\s+ecs\s+update-service[^\n]*?--service\s+(\S+)/.exec(run);
  if (ecs && ecs[1]) {
    const cluster = /--cluster\s+(\S+)/.exec(run)?.[1] ?? null;
    out.push({ kind: "ecs", cluster, service: ecs[1] });
  }
  const lambda = /aws\s+lambda\s+update-function-code[^\n]*?--function-name\s+(\S+)/.exec(run);
  if (lambda && lambda[1]) out.push({ kind: "lambda", function: lambda[1] });
  return out;
}

interface Step {
  uses?: unknown;
  with?: unknown;
  run?: unknown;
}

function* iterateSteps(doc: unknown): Generator<Step> {
  if (!isRecord(doc) || !isRecord(doc.jobs)) return;
  for (const job of Object.values(doc.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (isRecord(step)) yield step as Step;
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
