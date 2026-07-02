import { describe, it, expect } from "vitest";
import { projectUrn, repositoryUrn, pipelineUrn, pullRequestUrn, userUrn } from "./urn";

describe("bitbucket URNs", () => {
  it("builds the documented scheme and lowercases slugs", () => {
    expect(projectUrn("Acme", "PLATFORM")).toBe("bitbucket:acme:project/platform");
    expect(repositoryUrn("Acme", "Mobile-App")).toBe("bitbucket:acme:repository/mobile-app");
    expect(pipelineUrn("acme", "mobile-app", "Production")).toBe(
      "bitbucket:acme:pipeline/mobile-app/production",
    );
    expect(pullRequestUrn("acme", "mobile-app", 231)).toBe(
      "bitbucket:acme:pullrequest/mobile-app/231",
    );
    expect(userUrn("acme", "diego")).toBe("bitbucket:acme:user/diego");
  });

  it("is idempotent (same inputs → same urn)", () => {
    expect(repositoryUrn("acme", "repo")).toBe(repositoryUrn("acme", "repo"));
  });

  it("rejects a non-numeric PR id and empty parts", () => {
    expect(() => pullRequestUrn("acme", "repo", "abc")).toThrow();
    expect(() => repositoryUrn("acme", "  ")).toThrow();
  });
});
