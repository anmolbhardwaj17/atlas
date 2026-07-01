import { describe, it, expect } from "vitest";
import { GITHUB_NODE_KINDS, GITHUB_NODE_KIND_LIST } from "./node-kinds";

describe("GitHub node-kind catalog", () => {
  it("covers the MVP catalog (docs/05 §3.2 + external.package)", () => {
    expect(GITHUB_NODE_KIND_LIST.map((k) => k.kind).sort()).toEqual([
      "external.package",
      "github.pull_request",
      "github.repository",
      "github.team",
      "github.user",
      "github.workflow",
    ]);
  });

  it("scopes external.package under provider 'external'", () => {
    expect(GITHUB_NODE_KINDS["external.package"].provider).toBe("external");
    expect(GITHUB_NODE_KINDS["github.repository"].provider).toBe("github");
  });
});
