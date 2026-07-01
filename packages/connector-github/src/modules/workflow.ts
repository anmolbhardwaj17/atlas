/**
 * Workflow module (docs/07 §7.1). The workflow node + observed CONTAINS(repo→workflow),
 * and a deploy SIGNAL (AWS actions + candidate targets) parsed from the YAML. The
 * DEPLOYS_TO edge itself is inferred (R1) — the connector only supplies the evidence.
 */
import { repoUrn, workflowUrn } from "../urn";
import { observed, type GithubModule } from "./module";
import { parseWorkflowDeploys } from "../parsers/workflow";

export interface WorkflowPayload {
  owner: string;
  repo: string;
  /** Path on the default branch, e.g. `.github/workflows/deploy.yml`. */
  path: string;
  /** Raw YAML content. */
  content: string;
  data?: { name?: string; state?: string };
}

export const workflowModule: GithubModule<WorkflowPayload> = {
  kind: "github.workflow",
  normalize({ owner, repo, path, data }) {
    return {
      urn: workflowUrn(owner, repo, path),
      kind: "github.workflow",
      displayName: data?.name ?? path.split("/").pop() ?? path,
      attributes: { owner, repo, path, name: data?.name, state: data?.state },
    };
  },
  observedEdges({ owner, repo, path }) {
    return [observed("CONTAINS", repoUrn(owner, repo), workflowUrn(owner, repo, path))];
  },
  extractSignals({ owner, repo, path, content }) {
    const deploys = parseWorkflowDeploys(content);
    if (deploys.actions.length === 0 && deploys.targets.length === 0) return [];
    return [
      {
        kind: "github.workflow.deploy",
        subjectUrn: workflowUrn(owner, repo, path),
        data: { repo: repoUrn(owner, repo), actions: deploys.actions, targets: deploys.targets },
      },
    ];
  },
};
