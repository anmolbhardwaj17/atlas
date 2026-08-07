import { describe, it, expect } from "vitest";
import type { Connection, CrawlContext, SecretAccessor, SyncRun } from "@atlas/connector-sdk";
import type { GithubClient } from "./client";
import { crawlRepo, listInstallationRepos, listTeamMembers } from "./crawl";
import { GithubConnector } from "../github-connector";
import type { InstallationTokenProvider } from "../auth";

const b64 = (s: string): string => Buffer.from(s).toString("base64");

/** In-memory GitHub API for acme/svc: repo, CODEOWNERS, package.json, one workflow, one PR. */
function fakeClient(): GithubClient {
  const contents: Record<string, string> = {
    ".github/CODEOWNERS": "*  @acme/payments\n",
    "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    ".github/workflows/deploy.yml":
      "jobs:\n  d:\n    steps:\n      - uses: aws-actions/configure-aws-credentials@v4\n",
  };
  const client = {
    async request(path: string) {
      const headers = new Headers();
      if (path === "/repos/acme/svc") {
        return {
          status: 200,
          headers,
          data: { default_branch: "main", visibility: "private", language: "TypeScript" },
        };
      }
      const cm = /\/repos\/acme\/svc\/contents\/(.+)$/.exec(path);
      if (cm) {
        const p = cm[1] as string;
        if (p === ".github/workflows") {
          return {
            status: 200,
            headers,
            data: [{ name: "deploy.yml", path: ".github/workflows/deploy.yml", type: "file" }],
          };
        }
        if (contents[p] != null)
          return { status: 200, headers, data: { content: b64(contents[p]), encoding: "base64" } };
        throw new Error(`GitHub 404 for ${path}`);
      }
      if (/\/pulls\/\d+\/files$/.test(path))
        return { status: 200, headers, data: [{ filename: "src/a.ts" }] };
      if (path === "/repos/acme/svc/pulls") {
        return {
          status: 200,
          headers,
          data: [{ number: 1, title: "x", user: { login: "octocat" }, state: "open" }],
        };
      }
      throw new Error(`GitHub 404 for ${path}`);
    },
    async *paginate(path: string) {
      if (path === "/installation/repositories") yield { name: "svc", owner: { login: "acme" } };
      if (path === "/orgs/acme/teams/payments/members") {
        yield { login: "ada" };
        yield { login: "grace" };
      }
    },
  };
  return client as unknown as GithubClient;
}

describe("crawlRepo", () => {
  it("yields the repo + workflow + edge-target nodes + PR (and author)", async () => {
    const out: Array<{ kind: string; externalId: string }> = [];
    for await (const d of crawlRepo(fakeClient(), "acme", "svc", "repo:acme/svc")) {
      out.push({ kind: d.ref.kind, externalId: d.ref.externalId });
    }
    expect(out).toContainEqual({ kind: "github.repository", externalId: "repo" });
    expect(out).toContainEqual({
      kind: "github.workflow",
      externalId: "wf:.github/workflows/deploy.yml",
    });
    expect(out).toContainEqual({ kind: "github.team", externalId: "team:acme/payments" });
    expect(out).toContainEqual({ kind: "external.package", externalId: "pkg:npm:react" });
    expect(out).toContainEqual({ kind: "github.pull_request", externalId: "pr:1" });
    expect(out).toContainEqual({ kind: "github.user", externalId: "user:octocat" });
  });

  it("listInstallationRepos returns installed repos", async () => {
    expect(await listInstallationRepos(fakeClient())).toEqual([{ owner: "acme", repo: "svc" }]);
  });

  // US-10: a CODEOWNERS team is a label until it resolves to people. These prove the members reach
  // the graph as real user nodes AND ride on the team payload (which is what emits HAS_MEMBER).
  it("resolves a CODEOWNERS team to its members (US-10)", async () => {
    const out: Array<{ kind: string; externalId: string; payload: unknown }> = [];
    for await (const d of crawlRepo(fakeClient(), "acme", "svc", "repo:acme/svc")) {
      out.push({ kind: d.ref.kind, externalId: d.ref.externalId, payload: d.payload });
    }
    // Each member becomes a user node, so the HAS_MEMBER edges resolve inside this scope.
    expect(out).toContainEqual(
      expect.objectContaining({ kind: "github.user", externalId: "user:ada" }),
    );
    expect(out).toContainEqual(
      expect.objectContaining({ kind: "github.user", externalId: "user:grace" }),
    );
    const team = out.find((d) => d.externalId === "team:acme/payments");
    expect((team?.payload as { members?: string[] })?.members).toEqual(["ada", "grace"]);
  });

  it("degrades to no members when members:read is declined, without failing the scope", async () => {
    // An org-level permission a customer can decline while granting everything else. A 403 must not
    // cost us the repo/PR/workflow data — a missing edge beats a wrong one, and beats no data (P3).
    const client = fakeClient();
    const denied = {
      ...client,
      async *paginate(path: string) {
        if (path.includes("/members")) throw new Error("GitHub 403: Resource not accessible");
        yield* client.paginate(path);
      },
    } as unknown as GithubClient;

    expect(await listTeamMembers(denied, "acme", "payments")).toEqual([]);

    const out: Array<{ kind: string; externalId: string; payload: unknown }> = [];
    for await (const d of crawlRepo(denied, "acme", "svc", "repo:acme/svc")) {
      out.push({ kind: d.ref.kind, externalId: d.ref.externalId, payload: d.payload });
    }
    // The repo still crawled, and the team is still a node — just without membership.
    expect(out).toContainEqual(expect.objectContaining({ kind: "github.repository" }));
    const team = out.find((d) => d.externalId === "team:acme/payments");
    expect((team?.payload as { members?: string[] })?.members).toEqual([]);
  });
});

describe("GithubConnector plan/discover/fetchDetail", () => {
  const auth: InstallationTokenProvider = {
    getInstallationToken: async () => ({
      token: "ghs_x",
      expiresAt: null,
      permissions: {},
      repositorySelection: "all",
    }),
  };
  const secrets: SecretAccessor = { get: async () => ({ privateKey: "PEM" }) };
  const connector = new GithubConnector({ auth, secrets, clientFactory: () => fakeClient() });
  const conn: Connection = {
    id: "c1",
    orgId: "o1",
    provider: "github",
    displayName: "acme",
    config: { appId: "1", installationId: "2" },
    secretRef: "ref",
  };
  const run: SyncRun = { id: "r1", orgId: "o1", connectionId: "c1", type: "full", checkpoint: {} };
  const ctx: CrawlContext = {
    connection: conn,
    run,
    secrets,
    log: { debug() {}, info() {}, warn() {}, error() {} },
  };

  it("plans one scope per installed repo", async () => {
    const { scopes } = await connector.plan(conn, run);
    expect(scopes).toEqual([{ key: "repo:acme/svc", params: { owner: "acme", repo: "svc" } }]);
  });

  it("discovers + fetchDetail + normalize round-trips a repo node", async () => {
    const scope = { key: "repo:acme/svc", params: { owner: "acme", repo: "svc" } };
    const refs = [];
    for await (const ref of connector.discover(scope, ctx)) refs.push(ref);
    const repoRef = refs.find((r) => r.kind === "github.repository");
    if (!repoRef) throw new Error("expected a repository ref");

    const raw = await connector.fetchDetail(repoRef, ctx);
    expect(connector.normalize(raw).urn).toBe("github:acme/svc");
    // The repo's observed edges include OWNED_BY (team) + DEPENDS_ON_PKG (react).
    const edges = connector.observedEdges(raw);
    expect(edges.map((e) => e.type).sort()).toEqual(["DEPENDS_ON_PKG", "OWNED_BY"]);
  });
});
