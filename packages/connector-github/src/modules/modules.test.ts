import { describe, it, expect } from "vitest";
import type { EdgeUpsert } from "@atlas/connector-sdk";
import { repositoryModule, type RepositoryPayload } from "./repository";
import { pullRequestModule } from "./pull-request";
import { workflowModule } from "./workflow";
import { teamModule, userModule, packageModule } from "./nodes";
import { GITHUB_MODULES, MODULE_BY_KIND } from "./index";

function first<T>(a: readonly T[]): T {
  const v = a[0];
  if (v === undefined) throw new Error("expected an element");
  return v;
}
const edgeOf = (edges: EdgeUpsert[], type: string): EdgeUpsert[] =>
  edges.filter((e) => e.type === type);

describe("registry", () => {
  it("registers all six modules by kind", () => {
    expect(MODULE_BY_KIND.size).toBe(GITHUB_MODULES.length);
    expect([...MODULE_BY_KIND.keys()].sort()).toEqual([
      "external.package",
      "github.pull_request",
      "github.repository",
      "github.team",
      "github.user",
      "github.workflow",
    ]);
  });
});

describe("repositoryModule", () => {
  const payload: RepositoryPayload = {
    owner: "acme",
    repo: "checkout-svc",
    data: { defaultBranch: "main", visibility: "private", language: "TypeScript" },
    codeowners: "*  @acme/payments\n/docs/  @octocat\n",
    manifests: [
      { path: "package.json", content: JSON.stringify({ dependencies: { react: "^18.0.0" } }) },
    ],
  };

  it("normalizes to a repo node with the canonical URN", () => {
    const node = repositoryModule.normalize(payload);
    expect(node.urn).toBe("github:acme/checkout-svc");
    expect(node.kind).toBe("github.repository");
    expect(node.displayName).toBe("acme/checkout-svc");
  });

  it("emits OWNED_BY (team+user) and DEPENDS_ON_PKG from repo files", () => {
    const edges = repositoryModule.observedEdges(payload);
    expect(edgeOf(edges, "OWNED_BY").map((e) => e.toUrn)).toEqual([
      "github:acme:team:payments",
      "github:user:octocat",
    ]);
    expect(first(edgeOf(edges, "DEPENDS_ON_PKG"))).toMatchObject({
      fromUrn: "github:acme/checkout-svc",
      toUrn: "external:npm:package:react",
      origin: "observed",
      attributes: { version: "^18.0.0", manifest: "package.json" },
    });
  });
});

describe("workflowModule", () => {
  const payload = {
    owner: "acme",
    repo: "checkout-svc",
    path: ".github/workflows/deploy.yml",
    content: [
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - uses: aws-actions/amazon-ecs-deploy-task-definition@v2",
      "        with: { cluster: prod, service: checkout }",
    ].join("\n"),
  };

  it("emits CONTAINS(repo→workflow) + a deploy signal (targets for R1)", () => {
    expect(workflowModule.normalize(payload).urn).toBe(
      "github:acme/checkout-svc:workflow:.github/workflows/deploy.yml",
    );
    expect(first(workflowModule.observedEdges(payload))).toMatchObject({
      type: "CONTAINS",
      fromUrn: "github:acme/checkout-svc",
      toUrn: "github:acme/checkout-svc:workflow:.github/workflows/deploy.yml",
    });
    const sig = first(workflowModule.extractSignals(payload));
    expect(sig.kind).toBe("github.workflow.deploy");
    expect(sig.data.targets).toContainEqual({ kind: "ecs", cluster: "prod", service: "checkout" });
  });
});

describe("pullRequestModule", () => {
  const payload = {
    owner: "acme",
    repo: "checkout-svc",
    data: {
      number: 482,
      title: "Fix checkout",
      user: { login: "octocat" },
      state: "closed",
      mergedAt: "2026-06-30T00:00:00Z",
      changedFiles: ["src/checkout.ts"],
    },
  };
  it("normalizes to a PR node + emits a changed-files signal (R6), no observed edge", () => {
    expect(pullRequestModule.normalize(payload).urn).toBe("github:acme/checkout-svc:pr:482");
    expect(pullRequestModule.observedEdges(payload)).toEqual([]);
    expect(first(pullRequestModule.extractSignals(payload))).toMatchObject({
      kind: "github.pr.files",
      data: { files: ["src/checkout.ts"], author: "octocat" },
    });
  });
});

describe("leaf node modules", () => {
  it("team / user / package normalize to their URNs, no edges", () => {
    expect(teamModule.normalize({ owner: "acme", data: { slug: "payments" } }).urn).toBe(
      "github:acme:team:payments",
    );
    expect(userModule.normalize({ data: { login: "OctoCat" } }).urn).toBe("github:user:octocat");
    expect(packageModule.normalize({ ecosystem: "npm", name: "react", version: "18" }).urn).toBe(
      "external:npm:package:react",
    );
    expect(packageModule.observedEdges({ ecosystem: "npm", name: "react" })).toEqual([]);
  });
});
