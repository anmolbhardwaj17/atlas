/**
 * BitbucketConnector — the Bitbucket realization of the frozen Connector contract (docs/07b),
 * the same interface AWS/GitHub implement (P5/NFR-19). Read-only by construction (P2): every
 * call is a GET against api.bitbucket.org/2.0 with HTTP Basic (email + scoped API token from
 * the Secrets Broker). verify() probes account/workspace/repo reads and reports exactly which
 * are missing; the crawl walks projects → members → repos (each repo's environments + PRs).
 */
import type {
  Connection,
  Connector,
  ConnectorLogger,
  CrawlContext,
  EdgeUpsert,
  HealthResult,
  NodeUpsert,
  RawResource,
  ResourceRef,
  Scope,
  SecretAccessor,
  Signal,
  SyncRun,
  VerifyResult,
  WorkPlan,
} from "@atlas/connector-sdk";
import { parseBitbucketConfig, parseBitbucketCredentials } from "./config";
import { FetchBitbucketClient, BitbucketHttpError, type BitbucketClient } from "./bitbucket/client";
import {
  resolveWorkspace,
  listRepoSlugs,
  discoverProjects,
  discoverMembers,
  discoverRepo,
} from "./bitbucket/crawl";
import { MODULE_BY_KIND, type BitbucketModule } from "./modules";

const NOOP_LOGGER: ConnectorLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface BitbucketConnectorDeps {
  secrets: SecretAccessor;
  /** Builds a REST client from resolved credentials (overridable for tests). */
  clientFactory?: (creds: { email: string; apiToken: string }) => BitbucketClient;
  logger?: ConnectorLogger;
}

interface RunClient {
  client: BitbucketClient;
  workspace: string;
}

export class BitbucketConnector implements Connector {
  readonly provider = "bitbucket" as const;
  private readonly secrets: SecretAccessor;
  private readonly clientFactory: (creds: { email: string; apiToken: string }) => BitbucketClient;
  private readonly log: ConnectorLogger;

  /** One credential-backed client + resolved workspace per run. */
  private readonly runClients = new Map<string, Promise<RunClient>>();
  /** Hands a crawled payload from discover() to the immediately-following fetchDetail(). */
  private readonly pendingPayloads = new Map<string, unknown>();

  constructor(deps: BitbucketConnectorDeps) {
    this.secrets = deps.secrets;
    this.clientFactory = deps.clientFactory ?? ((creds) => new FetchBitbucketClient(creds));
    this.log = deps.logger ?? NOOP_LOGGER;
  }

  async verify(conn: Connection): Promise<VerifyResult> {
    return this.probe(conn);
  }
  async health(conn: Connection): Promise<HealthResult> {
    return this.probe(conn);
  }

  private async probe(conn: Connection): Promise<VerifyResult> {
    let client: BitbucketClient;
    try {
      client = await this.buildClient(conn);
    } catch (err) {
      return { status: "error", message: (err as Error).message };
    }

    // Account read — the auth gate. 401/403 here = bad credentials, not a missing scope.
    try {
      await client.request("/user");
    } catch (err) {
      if (err instanceof BitbucketHttpError && (err.status === 401 || err.status === 403)) {
        return {
          status: "error",
          message: "Bitbucket rejected the credentials — check the email and API token.",
        };
      }
      return {
        status: "error",
        message: `Bitbucket account probe failed: ${(err as Error).message}`,
      };
    }

    const missing: string[] = [];
    let workspace: string | undefined;
    try {
      const cfg = parseBitbucketConfig(conn.config);
      workspace = await resolveWorkspace(client, cfg.workspace);
    } catch {
      missing.push("read:workspace:bitbucket");
    }
    if (workspace) {
      try {
        await client.request(`/repositories/${workspace}`, { params: { pagelen: 1 } });
      } catch (err) {
        if (err instanceof BitbucketHttpError && (err.status === 401 || err.status === 403)) {
          missing.push("read:repository:bitbucket");
        }
      }
    }

    if (missing.length > 0) {
      return {
        status: "degraded",
        missingPermissions: missing,
        message: `Connected, but ${missing.length} read scope(s) are missing; add them to the API token for full indexing.`,
      };
    }
    return { status: "connected" };
  }

  // ── Crawl stages ────────────────────────────────────────────────────────────

  async plan(conn: Connection, run: SyncRun): Promise<WorkPlan> {
    const { client, workspace } = await this.clientForRun(conn, run.id);
    const slugs = await listRepoSlugs(client, workspace);
    const scopes: Scope[] = [
      { key: `projects:${workspace}`, params: { workspace } },
      { key: `members:${workspace}`, params: { workspace } },
      ...slugs.map((slug) => ({
        key: `repo:${workspace}/${slug}`,
        params: { workspace, repoSlug: slug },
      })),
    ];
    return { scopes };
  }

  async *discover(scope: Scope, ctx: CrawlContext): AsyncIterable<ResourceRef> {
    const { client } = await this.clientForRun(ctx.connection, ctx.run.id);
    const workspace = typeof scope.params?.workspace === "string" ? scope.params.workspace : "";
    if (!workspace) return;

    let source: AsyncIterable<{ ref: ResourceRef; payload: unknown }>;
    if (scope.key.startsWith("projects:")) {
      source = discoverProjects(client, workspace, scope.key);
    } else if (scope.key.startsWith("members:")) {
      source = discoverMembers(client, workspace, scope.key);
    } else if (scope.key.startsWith("repo:")) {
      const repoSlug = typeof scope.params?.repoSlug === "string" ? scope.params.repoSlug : "";
      if (!repoSlug) return;
      source = discoverRepo(client, workspace, repoSlug, scope.key);
    } else {
      return;
    }

    for await (const item of source) {
      this.pendingPayloads.set(payloadKey(ctx.run.id, item.ref.externalId), item.payload);
      yield item.ref;
    }
  }

  async fetchDetail(ref: ResourceRef, ctx: CrawlContext): Promise<RawResource> {
    const key = payloadKey(ctx.run.id, ref.externalId);
    const payload = this.pendingPayloads.get(key);
    if (payload === undefined) {
      throw new Error(`BitbucketConnector.fetchDetail: no cached payload for ${ref.externalId}`);
    }
    this.pendingPayloads.delete(key);
    return { ref, payload, fetchedAt: new Date().toISOString() };
  }

  normalize(raw: RawResource): NodeUpsert {
    return this.moduleFor(raw).normalize(raw.payload);
  }
  extractSignals(raw: RawResource): Signal[] {
    return this.moduleFor(raw).extractSignals(raw.payload);
  }
  observedEdges(raw: RawResource): EdgeUpsert[] {
    return this.moduleFor(raw).observedEdges(raw.payload);
  }

  private moduleFor(raw: RawResource): BitbucketModule {
    const module = MODULE_BY_KIND.get(raw.ref.kind);
    if (!module) throw new Error(`No Bitbucket module for kind "${raw.ref.kind}".`);
    return module;
  }

  /** Resolve credentials + build a client (verify path — no workspace resolution). */
  private async buildClient(conn: Connection): Promise<BitbucketClient> {
    if (!conn.secretRef) throw new Error("No Bitbucket API token configured for this connection.");
    const secret = await this.secrets.get(conn.secretRef);
    const creds = parseBitbucketCredentials(secret);
    return this.clientFactory(creds);
  }

  /** Resolve (and cache) the run's client + workspace. */
  private async clientForRun(conn: Connection, runId: string): Promise<RunClient> {
    const existing = this.runClients.get(runId);
    if (existing) return existing;
    const promise = (async (): Promise<RunClient> => {
      const client = await this.buildClient(conn);
      const cfg = parseBitbucketConfig(conn.config);
      const workspace = await resolveWorkspace(client, cfg.workspace);
      return { client, workspace };
    })();
    this.runClients.set(runId, promise);
    return promise;
  }
}

function payloadKey(runId: string, externalId: string): string {
  return `${runId}::${externalId}`;
}
