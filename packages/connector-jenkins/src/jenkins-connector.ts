/**
 * JenkinsConnector — the Jenkins realization of the frozen Connector contract (docs/07c), the
 * same interface AWS/GitHub/Bitbucket implement (P5/NFR-19). Read-only by construction (P2):
 * every call is a GET against the Jenkins server with HTTP Basic (username + API token from the
 * Secrets Broker). verify() probes the tree API (the Job/Read gate); the crawl walks every job,
 * emitting `jenkins.job` nodes + `jenkins.deploy` signals that R1 turns into DEPLOYS_TO edges —
 * the observed bridge from CI to running infrastructure (docs/07c §1).
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
import { parseJenkinsConfig, parseJenkinsCredentials } from "./config";
import { FetchJenkinsClient, JenkinsHttpError, type JenkinsClient } from "./client";
import { discoverJobs } from "./crawl";
import { jobNode, jobSignals } from "./job";

const NOOP_LOGGER: ConnectorLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface JenkinsConnectorDeps {
  secrets: SecretAccessor;
  clientFactory?: (opts: { baseUrl: string; username: string; apiToken: string }) => JenkinsClient;
  logger?: ConnectorLogger;
}

interface RunClient {
  client: JenkinsClient;
  baseUrl: string;
}

export class JenkinsConnector implements Connector {
  readonly provider = "jenkins" as const;
  private readonly secrets: SecretAccessor;
  private readonly clientFactory: (opts: {
    baseUrl: string;
    username: string;
    apiToken: string;
  }) => JenkinsClient;
  private readonly log: ConnectorLogger;

  private readonly runClients = new Map<string, Promise<RunClient>>();
  private readonly pendingPayloads = new Map<string, unknown>();

  constructor(deps: JenkinsConnectorDeps) {
    this.secrets = deps.secrets;
    this.clientFactory = deps.clientFactory ?? ((o) => new FetchJenkinsClient(o));
    this.log = deps.logger ?? NOOP_LOGGER;
  }

  async verify(conn: Connection): Promise<VerifyResult> {
    return this.probe(conn);
  }
  async health(conn: Connection): Promise<HealthResult> {
    return this.probe(conn);
  }

  private async probe(conn: Connection): Promise<VerifyResult> {
    let run: RunClient;
    try {
      run = await this.buildRunClient(conn);
    } catch (err) {
      return { status: "error", message: (err as Error).message };
    }
    try {
      // The tree API is the Job/Read gate; a bad token → 401/403.
      await run.client.json("/api/json?tree=jobs[name]{0,1}");
      return { status: "connected" };
    } catch (err) {
      if (err instanceof JenkinsHttpError && (err.status === 401 || err.status === 403)) {
        return {
          status: "error",
          message: "Jenkins rejected the credentials — check the username and API token.",
        };
      }
      return { status: "error", message: `Jenkins probe failed: ${(err as Error).message}` };
    }
  }

  // ── Crawl stages ────────────────────────────────────────────────────────────

  async plan(conn: Connection, run: SyncRun): Promise<WorkPlan> {
    const { baseUrl } = await this.clientForRun(conn, run.id);
    // One scope — the crawl walks the full job tree in a single pass.
    return { scopes: [{ key: `jobs:${baseUrl}`, params: { baseUrl } }] };
  }

  async *discover(scope: Scope, ctx: CrawlContext): AsyncIterable<ResourceRef> {
    const { client, baseUrl } = await this.clientForRun(ctx.connection, ctx.run.id);
    for await (const item of discoverJobs(client, baseUrl, scope.key, ctx.signal)) {
      this.pendingPayloads.set(payloadKey(ctx.run.id, item.ref.externalId), item.payload);
      yield item.ref;
    }
  }

  async fetchDetail(ref: ResourceRef, ctx: CrawlContext): Promise<RawResource> {
    const key = payloadKey(ctx.run.id, ref.externalId);
    const payload = this.pendingPayloads.get(key);
    if (payload === undefined) {
      throw new Error(`JenkinsConnector.fetchDetail: no cached payload for ${ref.externalId}`);
    }
    this.pendingPayloads.delete(key);
    return { ref, payload, fetchedAt: new Date().toISOString() };
  }

  normalize(raw: RawResource): NodeUpsert {
    return jobNode(raw.payload);
  }
  extractSignals(raw: RawResource): Signal[] {
    return jobSignals(raw.payload);
  }
  observedEdges(_raw: RawResource): EdgeUpsert[] {
    // Jenkins observes no same-source edges in v1; the code↔infra links are cross-source and are
    // produced by inference (R1 from jenkins.deploy signals), per docs/07c §5.
    return [];
  }

  private async buildRunClient(conn: Connection): Promise<RunClient> {
    if (!conn.secretRef) throw new Error("No Jenkins API token configured for this connection.");
    const { baseUrl } = parseJenkinsConfig(conn.config);
    const secret = await this.secrets.get(conn.secretRef);
    const { username, apiToken } = parseJenkinsCredentials(secret);
    return { client: this.clientFactory({ baseUrl, username, apiToken }), baseUrl };
  }

  private async clientForRun(conn: Connection, runId: string): Promise<RunClient> {
    const existing = this.runClients.get(runId);
    if (existing) return existing;
    const promise = this.buildRunClient(conn);
    this.runClients.set(runId, promise);
    return promise;
  }
}

function payloadKey(runId: string, externalId: string): string {
  return `${runId}::${externalId}`;
}
