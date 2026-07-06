/**
 * AwsConnector — the AWS realization of the frozen Connector contract (docs/06 §3).
 *
 * I1.2 implements the lifecycle: `verify`/`health` AssumeRole the customer's read-only
 * role (External ID from the Secrets Broker), resolve the account id, then probe each
 * supported service to detect missing read permissions → `degraded` (docs/06 §2/§8).
 * The crawl stages (plan/discover/fetchDetail/normalize/extractSignals/observedEdges)
 * arrive in I1.3 and throw a clear "not implemented yet" until then.
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
import { parseAwsConfig } from "./config";
import {
  AssumeRoleError,
  buildSessionName,
  type AssumedRole,
  type CredentialProvider,
  type StaticCredentialResolver,
} from "./credentials";
import { isAccessDenied, type PermissionProbe, type ProbeInput } from "./permission-probe";
import { SERVICE_MODULES, MODULE_BY_KIND, type ServiceModule } from "./services";
import type { AwsRawPayload } from "./services/module";
import { DISCOVERER_BY_SERVICE } from "./discoverers";
import { collectAwsHealth, type HealthCollectResult } from "./health-collect";
import { collectCloudTrailEvents, type CloudTrailCollectResult } from "./cloudtrail-collect";
import { collectNodeMetrics, metricsSupported, type MetricSeries } from "./metrics-collect";

const NOOP_LOGGER: ConnectorLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface AwsConnectorDeps {
  /** Performs sts:AssumeRole (real STS impl in prod; fake in tests). Used in `role` auth mode. */
  credentials: CredentialProvider;
  /** Resolves + validates static IAM-user access keys (STS GetCallerIdentity). Used in `keys` mode. */
  staticCredentials?: StaticCredentialResolver;
  /** Resolves the connection secret (External ID, or the access keys) from the Secrets Broker. */
  secrets: SecretAccessor;
  /** Per-service read probes for permission detection (supplied by I1.3 discoverers). */
  probes?: PermissionProbe[];
  logger?: ConnectorLogger;
}

export class AwsConnector implements Connector {
  readonly provider = "aws" as const;
  private readonly creds: CredentialProvider;
  private readonly staticCreds: StaticCredentialResolver | undefined;
  private readonly secrets: SecretAccessor;
  private readonly probes: PermissionProbe[];
  private readonly log: ConnectorLogger;

  /** One AssumeRole per run (docs/06 §2); creds reused across the run's scopes. */
  private readonly runCreds = new Map<string, Promise<AssumedRole>>();
  /** Hands a discovered payload from discover() to the immediately-following fetchDetail(). */
  private readonly pendingPayloads = new Map<string, AwsRawPayload>();

  constructor(deps: AwsConnectorDeps) {
    this.creds = deps.credentials;
    this.staticCreds = deps.staticCredentials;
    this.secrets = deps.secrets;
    this.probes = deps.probes ?? [];
    this.log = deps.logger ?? NOOP_LOGGER;
  }

  /**
   * Resolve the run/verify credentials for a connection, branching on its auth mode (docs/06 §2):
   * - `role` — read the External ID secret + assume the configured role (temporary creds).
   * - `keys` — read the static access keys secret + validate them via STS GetCallerIdentity.
   * Both return the same {credentials, accountId} shape, so the crawl is identical downstream.
   */
  private async resolveCredentials(
    conn: Connection,
    secrets: SecretAccessor,
    sessionName: string,
    signal?: AbortSignal,
  ): Promise<AssumedRole> {
    const cfg = parseAwsConfig(conn.config);
    if (!conn.secretRef) {
      throw new AssumeRoleError(
        cfg.authMode === "keys"
          ? "No access keys are configured for this AWS connection."
          : "No External ID is configured for this AWS connection.",
      );
    }
    const secret = await secrets.get(conn.secretRef);

    if (cfg.authMode === "keys") {
      if (!this.staticCreds) {
        throw new AssumeRoleError("Static AWS access keys are not supported in this build.");
      }
      const accessKeyId = (secret.accessKeyId ?? "").trim();
      const secretAccessKey = secret.secretAccessKey ?? "";
      if (!accessKeyId || !secretAccessKey) {
        throw new AssumeRoleError("The connection's AWS access keys are missing or empty.");
      }
      return this.staticCreds.resolve({
        accessKeyId,
        secretAccessKey,
        ...(signal ? { signal } : {}),
      });
    }

    // role mode
    if (!cfg.roleArn)
      throw new AssumeRoleError("No role ARN is configured for this AWS connection.");
    const externalId = secret.externalId ?? "";
    if (!externalId) throw new AssumeRoleError("The connection's External ID is missing or empty.");
    return this.creds.assumeRole({
      roleArn: cfg.roleArn,
      externalId,
      sessionName,
      ...(signal ? { signal } : {}),
    });
  }

  async verify(conn: Connection): Promise<VerifyResult> {
    return this.probeConnection(conn, "atlas-verify");
  }

  /** Periodic re-check (FR-1.9). Same probe; catches revoked roles / new perm gaps. */
  async health(conn: Connection): Promise<HealthResult> {
    return this.probeConnection(conn, "atlas-health");
  }

  /**
   * Runtime health pass (operational-intelligence Phase B): resolve this connection's
   * credentials and collect point-in-time health observations (ELB target health, ECS
   * running counts, RDS status, firing CloudWatch alarms) for its configured regions.
   * Read-only, cheap - callers poll this far more often than a full crawl.
   */
  async collectHealth(
    conn: Connection,
    secrets: SecretAccessor,
    signal?: AbortSignal,
  ): Promise<HealthCollectResult> {
    const cfg = parseAwsConfig(conn.config);
    const assumed = await this.resolveCredentials(
      conn,
      secrets,
      buildSessionName("atlas-health", conn.id),
      signal,
    );
    return collectAwsHealth({
      credentials: assumed.credentials,
      accountId: assumed.accountId,
      regions: cfg.regions,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Change-timeline pass (operational-intelligence Phase C): CloudTrail write events in
   * the lookback window, mapped conservatively onto crawled nodes. Read-only, no setup.
   */
  async collectChanges(
    conn: Connection,
    secrets: SecretAccessor,
    since: Date,
    signal?: AbortSignal,
  ): Promise<CloudTrailCollectResult> {
    const cfg = parseAwsConfig(conn.config);
    const assumed = await this.resolveCredentials(
      conn,
      secrets,
      buildSessionName("atlas-changes", conn.id),
      signal,
    );
    return collectCloudTrailEvents({
      credentials: assumed.credentials,
      accountId: assumed.accountId,
      regions: cfg.regions,
      since,
      ...(signal ? { signal } : {}),
    });
  }

  /** On-demand CloudWatch metrics for one node (read-only; nothing persisted). */
  async collectMetrics(
    conn: Connection,
    secrets: SecretAccessor,
    node: { kind: string; region: string | null; attributes: Record<string, unknown> },
    hours: number,
    signal?: AbortSignal,
  ): Promise<MetricSeries[] | null> {
    if (!metricsSupported(node.kind) || !node.region) return null;
    const assumed = await this.resolveCredentials(
      conn,
      secrets,
      buildSessionName("atlas-metrics", conn.id),
      signal,
    );
    return collectNodeMetrics({
      credentials: assumed.credentials,
      region: node.region,
      kind: node.kind,
      attributes: node.attributes,
      hours,
      ...(signal ? { signal } : {}),
    });
  }

  private async probeConnection(conn: Connection, sessionPrefix: string): Promise<VerifyResult> {
    let cfg;
    try {
      cfg = parseAwsConfig(conn.config);
    } catch (err) {
      return { status: "error", message: (err as Error).message };
    }

    let assumed: AssumedRole;
    try {
      assumed = await this.resolveCredentials(
        conn,
        this.secrets,
        buildSessionName(sessionPrefix, conn.id),
      );
    } catch (err) {
      if (err instanceof AssumeRoleError) return { status: "error", message: err.message };
      return { status: "error", message: "Could not authenticate to AWS." };
    }

    // Permission detection: probe each supported service; AccessDenied → missing perm.
    const missing: string[] = [];
    const probeRegion = cfg.regions[0];
    for (const probe of this.probes) {
      const input: ProbeInput =
        probe.scope === "global" || !probeRegion
          ? { credentials: assumed.credentials, accountId: assumed.accountId }
          : { credentials: assumed.credentials, accountId: assumed.accountId, region: probeRegion };
      try {
        await probe.probe(input);
      } catch (err) {
        if (isAccessDenied(err)) {
          missing.push(probe.iamAction);
        } else {
          // Transient/other error during verify isn't a permission verdict — log, don't fail.
          this.log.warn("aws verify probe error (non-access-denied)", {
            service: probe.service,
            error: (err as Error).message,
          });
        }
      }
    }

    if (missing.length > 0) {
      return {
        status: "degraded",
        missingPermissions: missing,
        message: `Connected, but ${missing.length} read permission(s) are missing; those resource types will not be indexed until granted.`,
      };
    }
    return { status: "connected" };
  }

  // ── Crawl stages ────────────────────────────────────────────────────────────

  /**
   * Deterministic work plan (docs/06 §5.1): one scope per (region × region-scoped
   * service) plus one per global service. Each scope is independently queued &
   * resumable (P7); a throttled scope degrades only itself (BR-SYNC-2).
   */
  async plan(conn: Connection, _run: SyncRun): Promise<WorkPlan> {
    const cfg = parseAwsConfig(conn.config);
    const scopes: Scope[] = [];
    for (const m of SERVICE_MODULES) {
      if (m.scope === "global") {
        scopes.push({
          key: `global/${m.service}`,
          params: { service: m.service, region: "global" },
        });
      } else {
        for (const region of cfg.regions) {
          scopes.push({ key: `${region}/${m.service}`, params: { service: m.service, region } });
        }
      }
    }
    return { scopes };
  }

  /**
   * Stream resource refs for a scope via the service's discoverer (AWS SDK describe with
   * pagination + adaptive retry). The fetched payload is stashed for the runner's
   * immediately-following fetchDetail (discover+detail collapsed, docs/06 §5.2).
   */
  async *discover(scope: Scope, ctx: CrawlContext): AsyncIterable<ResourceRef> {
    const service = typeof scope.params?.service === "string" ? scope.params.service : undefined;
    const region = typeof scope.params?.region === "string" ? scope.params.region : "us-east-1";
    if (!service) return;
    const discoverer = DISCOVERER_BY_SERVICE.get(service);
    if (!discoverer) return;

    const assumed = await this.assumeForRun(ctx);
    for await (const item of discoverer.crawl({
      credentials: assumed.credentials,
      account: assumed.accountId,
      region,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })) {
      this.pendingPayloads.set(payloadKey(ctx.run.id, item.ref.externalId), item.payload);
      yield item.ref;
    }
  }

  async fetchDetail(ref: ResourceRef, ctx: CrawlContext): Promise<RawResource> {
    const key = payloadKey(ctx.run.id, ref.externalId);
    const payload = this.pendingPayloads.get(key);
    if (!payload) {
      throw new Error(`AwsConnector.fetchDetail: no cached payload for ${ref.externalId}`);
    }
    this.pendingPayloads.delete(key);
    return { ref, payload, fetchedAt: new Date().toISOString() };
  }

  /** Resolve (and cache) the run's credentials once per run (docs/06 §2), for either auth mode. */
  private async assumeForRun(ctx: CrawlContext): Promise<AssumedRole> {
    const existing = this.runCreds.get(ctx.run.id);
    if (existing) return existing;
    const promise = this.resolveCredentials(
      ctx.connection,
      ctx.secrets,
      buildSessionName("atlas-sync", ctx.run.id),
      ctx.signal,
    );
    this.runCreds.set(ctx.run.id, promise);
    return promise;
  }

  normalize(raw: RawResource): NodeUpsert {
    return this.moduleFor(raw).normalize(raw.payload as AwsRawPayload);
  }
  extractSignals(raw: RawResource): Signal[] {
    return this.moduleFor(raw).extractSignals(raw.payload as AwsRawPayload);
  }
  observedEdges(raw: RawResource): EdgeUpsert[] {
    return this.moduleFor(raw).observedEdges(raw.payload as AwsRawPayload);
  }

  private moduleFor(raw: RawResource): ServiceModule {
    const module = MODULE_BY_KIND.get(raw.ref.kind);
    if (!module) throw new Error(`No AWS service module for kind "${raw.ref.kind}".`);
    return module;
  }
}

function payloadKey(runId: string, externalId: string): string {
  return `${runId}::${externalId}`;
}
