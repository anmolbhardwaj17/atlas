import { describe, it, expect } from "vitest";
import { MODULE_BY_KIND } from "./index";
import { withContext } from "./context";

const repo = () => MODULE_BY_KIND.get("bitbucket.repository")!;
const pipe = () => MODULE_BY_KIND.get("bitbucket.pipeline")!;
const pr = () => MODULE_BY_KIND.get("bitbucket.pullrequest")!;
const user = () => MODULE_BY_KIND.get("bitbucket.user")!;
const project = () => MODULE_BY_KIND.get("bitbucket.project")!;

describe("repository module", () => {
  const payload = withContext(
    {
      slug: "mobile-app",
      name: "Mobile App",
      full_name: "acme/mobile-app",
      language: "typescript",
      is_private: true,
      mainbranch: { name: "main" },
      project: { key: "PLATFORM", name: "Platform" },
    },
    { workspace: "acme" },
  );

  it("normalizes to a bitbucket.repository node with a stable urn", () => {
    const node = repo().normalize(payload);
    expect(node.urn).toBe("bitbucket:acme:repository/mobile-app");
    expect(node.kind).toBe("bitbucket.repository");
    expect(node.displayName).toBe("Mobile App");
    expect(node.attributes.language).toBe("typescript");
  });

  it("emits project CONTAINS repo + a language signal", () => {
    const edges = repo().observedEdges(payload);
    expect(edges).toEqual([
      {
        type: "CONTAINS",
        fromUrn: "bitbucket:acme:project/platform",
        toUrn: "bitbucket:acme:repository/mobile-app",
        origin: "observed",
      },
    ]);
    const signals = repo().extractSignals(payload);
    expect(signals[0]).toMatchObject({ kind: "repo_language", data: { language: "typescript" } });
  });
});

describe("pipeline (environment) module", () => {
  const payload = withContext(
    { uuid: "{abc}", name: "Production", environment_type: { name: "Production" } },
    { workspace: "acme", repoSlug: "mobile-app" },
  );

  it("normalizes to a deploy-target node and emits repo CONTAINS pipeline", () => {
    const node = pipe().normalize(payload);
    expect(node.urn).toBe("bitbucket:acme:pipeline/mobile-app/production");
    expect(node.kind).toBe("bitbucket.pipeline");
    expect(pipe().observedEdges(payload)).toEqual([
      {
        type: "CONTAINS",
        fromUrn: "bitbucket:acme:repository/mobile-app",
        toUrn: "bitbucket:acme:pipeline/mobile-app/production",
        origin: "observed",
      },
    ]);
  });
});

describe("pull request module", () => {
  const payload = withContext(
    { id: 231, title: "offline mode", state: "OPEN", author: { nickname: "diego" } },
    { workspace: "acme", repoSlug: "mobile-app" },
  );

  it("normalizes + emits repo CONTAINS pr and pr OWNED_BY author", () => {
    const node = pr().normalize(payload);
    expect(node.urn).toBe("bitbucket:acme:pullrequest/mobile-app/231");
    expect(node.displayName).toBe("#231 — offline mode");
    const edges = pr().observedEdges(payload);
    expect(edges).toContainEqual({
      type: "OWNED_BY",
      fromUrn: "bitbucket:acme:pullrequest/mobile-app/231",
      toUrn: "bitbucket:acme:user/diego",
      origin: "observed",
    });
    expect(edges).toContainEqual({
      type: "CONTAINS",
      fromUrn: "bitbucket:acme:repository/mobile-app",
      toUrn: "bitbucket:acme:pullrequest/mobile-app/231",
      origin: "observed",
    });
  });

  it("captures merge + source commit SHAs for R12 image→commit provenance", () => {
    const withShas = withContext(
      {
        id: 231,
        title: "offline mode",
        merge_commit: { hash: "a1b2c3d4e5f6a7b8c9d0" },
        source: { branch: { name: "feat" }, commit: { hash: "f9e8d7c6b5a4" } },
      },
      { workspace: "acme", repoSlug: "mobile-app" },
    );
    const node = pr().normalize(withShas);
    expect(node.attributes.commitShas).toEqual(["a1b2c3d4e5f6a7b8c9d0", "f9e8d7c6b5a4"]);
  });

  it("omits commit SHAs cleanly when the payload has none", () => {
    expect(pr().normalize(payload).attributes.commitShas as string[]).toEqual([]);
  });
});

describe("project + user leaf modules", () => {
  it("normalize with no observed edges", () => {
    const p = withContext({ key: "PLATFORM", name: "Platform" }, { workspace: "acme" });
    expect(project().normalize(p).urn).toBe("bitbucket:acme:project/platform");
    expect(project().observedEdges(p)).toEqual([]);

    const u = withContext({ nickname: "diego", display_name: "Diego A" }, { workspace: "acme" });
    const node = user().normalize(u);
    expect(node.urn).toBe("bitbucket:acme:user/diego");
    expect(node.displayName).toBe("Diego A");
  });
});

describe("context guard", () => {
  it("throws when the workspace context is missing", () => {
    expect(() => repo().normalize({ slug: "x" })).toThrow(/workspace context/);
  });
});
