/**
 * GithubConnector — the GitHub realization of the frozen Connector contract (docs/07 §3),
 * the same interface AWS implements (P5/NFR-19).
 *
 * I2.2 implements the lifecycle: `verify`/`health` mint an installation access token for
 * the App installation (private key from the Secrets Broker) and compare the granted
 * permissions to what the crawl needs → `connected` / `degraded` / `error` (docs/07 §2).
 * The crawl stages arrive in I2.3 (pure transforms) and I2.4 (live discover/fetchDetail).
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
import { parseGithubConfig } from "./config";
import { InstallationAuthError, type InstallationTokenProvider } from "./auth";
import { missingPermissions } from "./permissions";
import { MODULE_BY_KIND, type GithubModule } from "./modules";
import { FetchGithubClient, type GithubClient } from "./github/client";
import { listInstallationRepos, crawlRepo } from "./github/crawl";

const NOOP_LOGGER: ConnectorLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface GithubConnectorDeps {
  /** Mints installation access tokens (real impl in prod; fake in tests). */
  auth: InstallationTokenProvider;
  /** Resolves the App private key from the Secrets Broker by `secret_ref`. */
  secrets: SecretAccessor;
  /** Builds a REST client from an installation token (overridable for tests). */
  clientFactory?: (token: string) => GithubClient;
  logger?: ConnectorLogger;
}

export class GithubConnector implements Connector {
  readonly provider = "github" as const;
  private readonly auth: InstallationTokenProvider;
  private readonly secrets: SecretAccessor;
  private readonly clientFactory: (token: string) => GithubClient;
  private readonly log: ConnectorLogger;

  /** One installation token + client per run (mirrors AWS's one-AssumeRole-per-run). */
  private readonly runClients = new Map<string, Promise<GithubClient>>();
  /** Hands a crawled payload from discover() to the immediately-following fetchDetail(). */
  private readonly pendingPayloads = new Map<string, unknown>();

  constructor(deps: GithubConnectorDeps) {
    this.auth = deps.auth;
    this.secrets = deps.secrets;
    this.clientFactory = deps.clientFactory ?? ((token) => new FetchGithubClient({ token }));
    this.log = deps.logger ?? NOOP_LOGGER;
  }

  async verify(conn: Connection): Promise<VerifyResult> {
    return this.probeConnection(conn);
  }
  async health(conn: Connection): Promise<HealthResult> {
    return this.probeConnection(conn);
  }

  private async probeConnection(conn: Connection): Promise<VerifyResult> {
    let cfg;
    try {
      cfg = parseGithubConfig(conn.config);
    } catch (err) {
      return { status: "error", message: (err as Error).message };
    }
    if (!conn.secretRef) {
      return {
        status: "error",
        message: "No GitHub App private key configured for this connection.",
      };
    }
    let privateKey: string;
    try {
      const secret = await this.secrets.get(conn.secretRef);
      privateKey = secret.privateKey ?? "";
    } catch {
      return { status: "error", message: "Could not resolve the GitHub App private key." };
    }
    if (!privateKey) {
      return { status: "error", message: "The GitHub App private key is missing or empty." };
    }

    let token;
    try {
      token = await this.auth.getInstallationToken({
        appId: cfg.appId,
        installationId: cfg.installationId,
        privateKey,
      });
    } catch (err) {
      if (err instanceof InstallationAuthError) return { status: "error", message: err.message };
      return { status: "error", message: "Failed to mint a GitHub installation token." };
    }

    const missing = missingPermissions(token.permissions);
    if (missing.length > 0) {
      return {
        status: "degraded",
        missingPermissions: missing,
        message: `Connected, but ${missing.length} read permission(s) are missing; grant them to the App installation for full indexing.`,
      };
    }
    return { status: "connected" };
  }

  // ── Crawl stages ────────────────────────────────────────────────────────────

  /** One scope per installed repo (bounded, resumable — docs/07 §4). */
  async plan(conn: Connection, run: SyncRun): Promise<WorkPlan> {
    const client = await this.clientForRun(conn, run.id);
    const repos = await listInstallationRepos(client);
    return {
      scopes: repos.map((r) => ({
        key: `repo:${r.owner}/${r.repo}`,
        params: { owner: r.owner, repo: r.repo },
      })),
    };
  }

  async *discover(scope: Scope, ctx: CrawlContext): AsyncIterable<ResourceRef> {
    const owner = typeof scope.params?.owner === "string" ? scope.params.owner : undefined;
    const repo = typeof scope.params?.repo === "string" ? scope.params.repo : undefined;
    if (!owner || !repo) return;
    const client = await this.clientForRun(ctx.connection, ctx.run.id);
    for await (const item of crawlRepo(client, owner, repo, scope.key)) {
      this.pendingPayloads.set(payloadKey(ctx.run.id, item.ref.externalId), item.payload);
      yield item.ref;
    }
  }

  async fetchDetail(ref: ResourceRef, ctx: CrawlContext): Promise<RawResource> {
    const key = payloadKey(ctx.run.id, ref.externalId);
    const payload = this.pendingPayloads.get(key);
    if (payload === undefined) {
      throw new Error(`GithubConnector.fetchDetail: no cached payload for ${ref.externalId}`);
    }
    this.pendingPayloads.delete(key);
    return { ref, payload, fetchedAt: new Date().toISOString() };
  }

  /** Resolve (and cache) the run's installation-token-backed REST client. */
  private async clientForRun(conn: Connection, runId: string): Promise<GithubClient> {
    const existing = this.runClients.get(runId);
    if (existing) return existing;
    const promise = (async (): Promise<GithubClient> => {
      const cfg = parseGithubConfig(conn.config);
      if (!conn.secretRef)
        throw new Error("No GitHub App private key configured for this connection.");
      const secret = await this.secrets.get(conn.secretRef);
      const privateKey = secret.privateKey ?? "";
      if (!privateKey) throw new Error("The GitHub App private key is missing or empty.");
      const token = await this.auth.getInstallationToken({
        appId: cfg.appId,
        installationId: cfg.installationId,
        privateKey,
      });
      return this.clientFactory(token.token);
    })();
    this.runClients.set(runId, promise);
    return promise;
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

  private moduleFor(raw: RawResource): GithubModule {
    const module = MODULE_BY_KIND.get(raw.ref.kind);
    if (!module) throw new Error(`No GitHub module for kind "${raw.ref.kind}".`);
    return module;
  }
}

function payloadKey(runId: string, externalId: string): string {
  return `${runId}::${externalId}`;
}
