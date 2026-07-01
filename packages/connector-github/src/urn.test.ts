import { describe, it, expect } from "vitest";
import { repoUrn, pullRequestUrn, workflowUrn, teamUrn, userUrn, packageUrn } from "./urn";

describe("GitHub URNs", () => {
  it("match the documented schemes (docs/05 §2.2)", () => {
    expect(repoUrn("acme", "checkout-svc")).toBe("github:acme/checkout-svc");
    expect(pullRequestUrn("acme", "checkout-svc", 482)).toBe("github:acme/checkout-svc:pr:482");
    expect(pullRequestUrn("acme", "checkout-svc", "482")).toBe("github:acme/checkout-svc:pr:482");
    expect(workflowUrn("acme", "checkout-svc", ".github/workflows/deploy.yml")).toBe(
      "github:acme/checkout-svc:workflow:.github/workflows/deploy.yml",
    );
    expect(teamUrn("acme", "payments")).toBe("github:acme:team:payments");
  });

  it("preserves case-significant keys but lowercases login/ecosystem (docs/05 §2.3)", () => {
    expect(repoUrn("Acme", "Checkout-SVC")).toBe("github:Acme/Checkout-SVC");
    expect(userUrn("OctoCat")).toBe("github:user:octocat");
    expect(packageUrn("NPM", "React")).toBe("external:npm:package:React");
  });

  it("is deterministic", () => {
    expect(repoUrn("acme", "svc")).toBe(repoUrn("acme", "svc"));
  });

  it("validates inputs", () => {
    expect(() => repoUrn("", "r")).toThrow(/owner is required/);
    expect(() => repoUrn("o", " ")).toThrow(/repo is required/);
    expect(() => pullRequestUrn("o", "r", "abc")).toThrow(/numeric/);
    expect(() => teamUrn("o", "")).toThrow(/team slug is required/);
    expect(() => userUrn("")).toThrow(/login is required/);
    expect(() => packageUrn("npm", "")).toThrow(/package name is required/);
  });
});
