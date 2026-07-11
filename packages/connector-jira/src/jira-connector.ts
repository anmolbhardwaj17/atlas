/**
 * JiraConnector — the Jira realization of the frozen Connector contract, the same interface AWS/
 * GitHub/Bitbucket implement (P5/NFR-19). Read-only by construction (P2): every call is a GET against
 * `<site>.atlassian.net/rest/api/3` with HTTP Basic (Atlassian email + scoped API token from the
 * Secrets Broker). verify() probes the auth + a project read; the crawl walks projects → issues
 * (story/description/subtasks/comments) → `jira.*` nodes. The intent capture; PR↔issue linking and the
 * coverage judge are later inference/AI over these nodes.
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
import { parseJiraConfig, parseJiraCredentials } from "./config";
import { FetchJiraClient, JiraHttpError, type JiraClient } from "./jira/client";
import { resolveProjectKeys, discoverProjects, discoverIssues } from "./jira/crawl";
import { MODULE_BY_KIND, type JiraModule } from "./modules";

const NOOP_LOGGER: ConnectorLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface JiraConnectorDeps {
  secrets: SecretAccessor;
  /** Builds a REST client from resolved credentials + site (overridable for tests). */
  clientFactory?: (opts: { site: string; email: string; apiToken: string }) => JiraClient;
  logger?: ConnectorLogger;
}

export class JiraConnector implements Connector {
  readonly provider = "jira" as const;
  private readonly secrets: SecretAccessor;
  private readonly clientFactory: (opts: {
    site: string;
    email: string;
    apiToken: string;
  }) => JiraClient;
  private readonly log: ConnectorLogger;

  private readonly runClients = new Map<string, Promise<JiraClient>>();
  private readonly pendingPayloads = new Map<string, unknown>();

  constructor(deps: JiraConnectorDeps) {
    this.secrets = deps.secrets;
    this.clientFactory = deps.clientFactory ?? ((o) => new FetchJiraClient(o));
    this.log = deps.logger ?? NOOP_LOGGER;
  }

  async verify(conn: Connection): Promise<VerifyResult> {
    return this.probe(conn);
  }
  async health(conn: Connection): Promise<HealthResult> {
    return this.probe(conn);
  }

  private async probe(conn: Connection): Promise<VerifyResult> {
    let client: JiraClient;
    try {
      client = await this.buildClient(conn);
    } catch (err) {
      return { status: "error", message: (err as Error).message };
    }

    // Auth gate — /myself. 401/403 = bad credentials, not a missing scope.
    try {
      await client.request("/myself");
    } catch (err) {
      if (err instanceof JiraHttpError && (err.status === 401 || err.status === 403)) {
        return {
          status: "error",
          message: "Jira rejected the credentials — check the email, API token, and site.",
        };
      }
      return { status: "error", message: `Jira account probe failed: ${(err as Error).message}` };
    }

    const missing: string[] = [];
    try {
      await client.request("/project/search", { params: { maxResults: 1 } });
    } catch (err) {
      if (err instanceof JiraHttpError && (err.status === 401 || err.status === 403)) {
        missing.push("read:jira-work");
      }
    }
    if (missing.length > 0) {
      return {
        status: "degraded",
        missingPermissions: missing,
        message: "Connected, but the token can't read projects; grant the read:jira-work scope.",
      };
    }
    return { status: "connected" };
  }

  // ── Crawl stages ────────────────────────────────────────────────────────────

  async plan(conn: Connection, run: SyncRun): Promise<WorkPlan> {
    const client = await this.clientForRun(conn, run.id);
    const cfg = parseJiraConfig(conn.config);
    const keys = await resolveProjectKeys(client, cfg.projectKeys);
    const scopes: Scope[] = [
      { key: `projects:${cfg.site}`, params: { site: cfg.site, keys: keys.join(",") } },
      ...keys.map((key) => ({
        key: `issues:${key}`,
        params: { site: cfg.site, projectKey: key },
      })),
    ];
    return { scopes };
  }

  async *discover(scope: Scope, ctx: CrawlContext): AsyncIterable<ResourceRef> {
    const client = await this.clientForRun(ctx.connection, ctx.run.id);
    const site = typeof scope.params?.site === "string" ? scope.params.site : "";
    if (!site) return;

    let source: AsyncIterable<{ ref: ResourceRef; payload: unknown }>;
    if (scope.key.startsWith("projects:")) {
      const keys =
        typeof scope.params?.keys === "string" ? scope.params.keys.split(",").filter(Boolean) : [];
      source = discoverProjects(client, site, keys, scope.key);
    } else if (scope.key.startsWith("issues:")) {
      const projectKey =
        typeof scope.params?.projectKey === "string" ? scope.params.projectKey : "";
      if (!projectKey) return;
      source = discoverIssues(client, site, projectKey, scope.key);
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
      throw new Error(`JiraConnector.fetchDetail: no cached payload for ${ref.externalId}`);
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

  private moduleFor(raw: RawResource): JiraModule {
    const module = MODULE_BY_KIND.get(raw.ref.kind);
    if (!module) throw new Error(`No Jira module for kind "${raw.ref.kind}".`);
    return module;
  }

  private async buildClient(conn: Connection): Promise<JiraClient> {
    if (!conn.secretRef) throw new Error("No Jira API token configured for this connection.");
    const cfg = parseJiraConfig(conn.config);
    const secret = await this.secrets.get(conn.secretRef);
    const creds = parseJiraCredentials(secret);
    return this.clientFactory({ site: cfg.site, email: creds.email, apiToken: creds.apiToken });
  }

  private async clientForRun(conn: Connection, runId: string): Promise<JiraClient> {
    const existing = this.runClients.get(runId);
    if (existing) return existing;
    const promise = this.buildClient(conn);
    this.runClients.set(runId, promise);
    return promise;
  }
}

function payloadKey(runId: string, externalId: string): string {
  return `${runId}::${externalId}`;
}
