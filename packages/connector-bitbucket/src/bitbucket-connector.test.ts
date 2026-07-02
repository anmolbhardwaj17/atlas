import { describe, it, expect } from "vitest";
import type {
  Connection,
  CrawlContext,
  ResourceRef,
  SecretAccessor,
  SyncRun,
} from "@atlas/connector-sdk";
import { BitbucketConnector } from "./bitbucket-connector";
import { BitbucketHttpError, type BitbucketClient } from "./bitbucket/client";

/** A canned Bitbucket client — paths (sans query) map to a request body or a paginated list. */
class FakeClient implements BitbucketClient {
  constructor(
    private readonly reqs: Record<string, unknown>,
    private readonly pages: Record<string, unknown[]>,
    private readonly throwOn: Record<string, number> = {},
  ) {}
  async request<T>(path: string): Promise<{ status: number; data: T; headers: Headers }> {
    const key = path.split("?")[0]!;
    if (this.throwOn[key]) throw new BitbucketHttpError(this.throwOn[key]!, key);
    return { status: 200, data: (this.reqs[key] ?? {}) as T, headers: new Headers() };
  }
  async *paginate<T>(path: string, opts?: { params?: Record<string, unknown> }): AsyncIterable<T> {
    const state = opts?.params?.state ? `?state=${String(opts.params.state)}` : "";
    const key = path.split("?")[0]! + state;
    if (this.throwOn[key]) throw new BitbucketHttpError(this.throwOn[key]!, key);
    for (const v of this.pages[key] ?? []) yield v as T;
  }
}

const secrets: SecretAccessor = {
  get: async () => ({ email: "anmol.bhardwaj@siemba.io", apiToken: "tok" }),
};

const conn: Connection = {
  id: "c1",
  orgId: "o1",
  provider: "bitbucket",
  displayName: "Siemba",
  config: { workspace: "acme" },
  secretRef: "ref",
};
const run: SyncRun = { id: "run1", orgId: "o1", connectionId: "c1", type: "full", checkpoint: {} };

function connector(client: BitbucketClient): BitbucketConnector {
  return new BitbucketConnector({ secrets, clientFactory: () => client });
}

describe("BitbucketConnector.verify", () => {
  it("connected when account + repo reads succeed", async () => {
    const c = new FakeClient({ "/user": { username: "anmol" }, "/repositories/acme": {} }, {});
    const res = await connector(c).verify(conn);
    expect(res.status).toBe("connected");
  });

  it("error when credentials are rejected (401 on /user)", async () => {
    const c = new FakeClient({}, {}, { "/user": 401 });
    const res = await connector(c).verify(conn);
    expect(res.status).toBe("error");
  });

  it("degraded + missing scope when repo read is forbidden", async () => {
    const c = new FakeClient({ "/user": {} }, {}, { "/repositories/acme": 403 });
    const res = await connector(c).verify(conn);
    expect(res.status).toBe("degraded");
    expect(res.missingPermissions).toContain("read:repository:bitbucket");
  });
});

describe("BitbucketConnector crawl", () => {
  const client = new FakeClient(
    {
      "/repositories/acme/mobile-app": {
        slug: "mobile-app",
        name: "Mobile App",
        project: { key: "PLATFORM" },
      },
    },
    {
      "/repositories/acme": [{ slug: "mobile-app" }],
      "/workspaces/acme/projects": [{ key: "PLATFORM", name: "Platform" }],
      "/workspaces/acme/members": [{ user: { nickname: "diego", display_name: "Diego A" } }],
      "/repositories/acme/mobile-app/environments/": [
        { uuid: "{e1}", name: "Production", environment_type: { name: "Production" } },
      ],
      "/repositories/acme/mobile-app/pullrequests?state=OPEN": [
        { id: 231, title: "offline mode", author: { nickname: "diego" } },
      ],
    },
  );

  it("plans projects→members→repos, then discovers + normalizes the full graph", async () => {
    const bb = connector(client);
    const ctx: CrawlContext = { connection: conn, run, secrets, log: console as never };

    const plan = await bb.plan(conn, run);
    expect(plan.scopes.map((s) => s.key)).toEqual([
      "projects:acme",
      "members:acme",
      "repo:acme/mobile-app",
    ]);

    const nodes: string[] = [];
    const edges: string[] = [];
    for (const scope of plan.scopes) {
      const refs: ResourceRef[] = [];
      for await (const ref of bb.discover(scope, ctx)) refs.push(ref);
      for (const ref of refs) {
        const raw = await bb.fetchDetail(ref, ctx);
        nodes.push(bb.normalize(raw).urn);
        for (const e of bb.observedEdges(raw)) edges.push(`${e.type} ${e.fromUrn} -> ${e.toUrn}`);
      }
    }

    expect(nodes).toEqual([
      "bitbucket:acme:project/platform",
      "bitbucket:acme:user/diego",
      "bitbucket:acme:repository/mobile-app",
      "bitbucket:acme:pipeline/mobile-app/production",
      "bitbucket:acme:pullrequest/mobile-app/231",
    ]);
    expect(edges).toContain(
      "CONTAINS bitbucket:acme:project/platform -> bitbucket:acme:repository/mobile-app",
    );
    expect(edges).toContain(
      "CONTAINS bitbucket:acme:repository/mobile-app -> bitbucket:acme:pipeline/mobile-app/production",
    );
    expect(edges).toContain(
      "OWNED_BY bitbucket:acme:pullrequest/mobile-app/231 -> bitbucket:acme:user/diego",
    );
  });
});
