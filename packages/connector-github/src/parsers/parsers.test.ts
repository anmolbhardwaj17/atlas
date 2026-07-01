import { describe, it, expect } from "vitest";
import { parseCodeowners, classifyOwner, distinctOwners } from "./codeowners";
import { parseManifest } from "./manifest";
import { parseWorkflowDeploys } from "./workflow";

describe("parseCodeowners", () => {
  it("parses rules, skips comments/blanks, classifies owners", () => {
    const rules = parseCodeowners(
      ["# owners", "*       @acme/platform", "/web/   @octocat dev@acme.com", ""].join("\n"),
    );
    expect(rules).toEqual([
      { pattern: "*", owners: ["@acme/platform"] },
      { pattern: "/web/", owners: ["@octocat", "dev@acme.com"] },
    ]);
    expect(classifyOwner("@acme/platform")).toEqual({
      type: "team",
      org: "acme",
      slug: "platform",
    });
    expect(classifyOwner("@octocat")).toEqual({ type: "user", login: "octocat" });
    expect(classifyOwner("dev@acme.com")).toBeNull();
    expect(distinctOwners(rules)).toEqual([
      { type: "team", org: "acme", slug: "platform" },
      { type: "user", login: "octocat" },
    ]);
  });
});

describe("parseManifest", () => {
  it("npm package.json → deps + devDeps, deduped", () => {
    const deps = parseManifest(
      "package.json",
      JSON.stringify({ dependencies: { react: "^18.0.0" }, devDependencies: { vitest: "2.1.8" } }),
    );
    expect(deps).toEqual([
      { ecosystem: "npm", name: "react", version: "^18.0.0" },
      { ecosystem: "npm", name: "vitest", version: "2.1.8" },
    ]);
  });
  it("python requirements.txt → pinned + unpinned, flags skipped", () => {
    expect(parseManifest("requirements.txt", "flask==3.0.0\nrequests\n-r other.txt\n# c")).toEqual([
      { ecosystem: "pypi", name: "flask", version: "3.0.0" },
      { ecosystem: "pypi", name: "requests", version: null },
    ]);
  });
  it("go.mod → require block", () => {
    const deps = parseManifest(
      "go.mod",
      "module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/sync v0.5.0\n)\n",
    );
    expect(deps).toEqual([
      { ecosystem: "go", name: "github.com/gin-gonic/gin", version: "v1.9.1" },
      { ecosystem: "go", name: "golang.org/x/sync", version: "v0.5.0" },
    ]);
  });
  it("unknown file → []", () => {
    expect(parseManifest("README.md", "hi")).toEqual([]);
  });
});

describe("parseWorkflowDeploys", () => {
  it("extracts AWS actions, ECS with-params, run-script flags and ARNs", () => {
    const yaml = `
name: deploy
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          cluster: prod
          service: orders-api
      - run: aws lambda update-function-code --function-name resize-images --zip-file x
      - run: echo arn:aws:ecs:us-east-1:123456789012:service/prod/checkout
`;
    const out = parseWorkflowDeploys(yaml);
    expect(out.actions).toEqual([
      "aws-actions/configure-aws-credentials@v4",
      "aws-actions/amazon-ecs-deploy-task-definition@v2",
    ]);
    expect(out.targets).toContainEqual({ kind: "ecs", cluster: "prod", service: "orders-api" });
    expect(out.targets).toContainEqual({ kind: "lambda", function: "resize-images" });
    expect(out.targets).toContainEqual({
      kind: "arn",
      arn: "arn:aws:ecs:us-east-1:123456789012:service/prod/checkout",
    });
  });
  it("non-deploy workflow → empty", () => {
    expect(parseWorkflowDeploys("jobs:\n  test:\n    steps:\n      - run: npm test")).toEqual({
      actions: [],
      targets: [],
    });
  });
  it("malformed YAML → empty (degrades that signal only)", () => {
    expect(parseWorkflowDeploys("this: : : not yaml")).toEqual({ actions: [], targets: [] });
  });
});
