/**
 * Pull request module (docs/07 §6, US-5/6). The PR node + a signal carrying the changed
 * file paths + merge metadata for the R6 `CHANGED_BY` inference (which resource did this
 * PR likely affect). PR→resource is INFERRED, so no observed edge here.
 */
import { pullRequestUrn } from "../urn";
import type { GithubModule } from "./module";

export interface PullRequestPayload {
  owner: string;
  repo: string;
  data: {
    number: number;
    title?: string;
    user?: { login?: string };
    state?: string;
    mergedAt?: string | null;
    baseRef?: string;
    headRef?: string;
    changedFiles?: string[];
    additions?: number;
    deletions?: number;
  };
}

export const pullRequestModule: GithubModule<PullRequestPayload> = {
  kind: "github.pull_request",
  normalize({ owner, repo, data }) {
    return {
      urn: pullRequestUrn(owner, repo, data.number),
      kind: "github.pull_request",
      displayName: `#${data.number} ${data.title ?? ""}`.trim(),
      attributes: {
        owner,
        repo,
        number: data.number,
        title: data.title,
        author: data.user?.login,
        state: data.state,
        mergedAt: data.mergedAt ?? null,
        baseRef: data.baseRef,
        headRef: data.headRef,
        changedFiles: data.changedFiles ?? [],
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals({ owner, repo, data }) {
    const subjectUrn = pullRequestUrn(owner, repo, data.number);
    return [
      {
        kind: "github.pr.files",
        subjectUrn,
        data: {
          files: data.changedFiles ?? [],
          mergedAt: data.mergedAt ?? null,
          author: data.user?.login ?? null,
        },
      },
    ];
  },
};
