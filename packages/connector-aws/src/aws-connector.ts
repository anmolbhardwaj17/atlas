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
} from "./credentials";
import { isAccessDenied, type PermissionProbe, type ProbeInput } from "./permission-probe";

const NOOP_LOGGER: ConnectorLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface AwsConnectorDeps {
  /** Performs sts:AssumeRole (real STS impl in prod; fake in tests). */
  credentials: CredentialProvider;
  /** Resolves the External ID from the Secrets Broker by `secret_ref`. */
  secrets: SecretAccessor;
  /** Per-service read probes for permission detection (supplied by I1.3 discoverers). */
  probes?: PermissionProbe[];
  logger?: ConnectorLogger;
}

export class AwsConnector implements Connector {
  readonly provider = "aws" as const;
  private readonly creds: CredentialProvider;
  private readonly secrets: SecretAccessor;
  private readonly probes: PermissionProbe[];
  private readonly log: ConnectorLogger;

  constructor(deps: AwsConnectorDeps) {
    this.creds = deps.credentials;
    this.secrets = deps.secrets;
    this.probes = deps.probes ?? [];
    this.log = deps.logger ?? NOOP_LOGGER;
  }

  async verify(conn: Connection): Promise<VerifyResult> {
    return this.probeConnection(conn, "atlas-verify");
  }

  /** Periodic re-check (FR-1.9). Same probe; catches revoked roles / new perm gaps. */
  async health(conn: Connection): Promise<HealthResult> {
    return this.probeConnection(conn, "atlas-health");
  }

  private async probeConnection(conn: Connection, sessionPrefix: string): Promise<VerifyResult> {
    let cfg;
    try {
      cfg = parseAwsConfig(conn.config);
    } catch (err) {
      return { status: "error", message: (err as Error).message };
    }

    if (!conn.secretRef) {
      return { status: "error", message: "No External ID configured for this AWS connection." };
    }
    let externalId: string;
    try {
      const secret = await this.secrets.get(conn.secretRef);
      externalId = secret.externalId ?? "";
    } catch {
      return { status: "error", message: "Could not resolve the connection's External ID." };
    }
    if (!externalId) {
      return { status: "error", message: "The connection's External ID is missing or empty." };
    }

    let assumed: AssumedRole;
    try {
      assumed = await this.creds.assumeRole({
        roleArn: cfg.roleArn,
        externalId,
        sessionName: buildSessionName(sessionPrefix, conn.id),
      });
    } catch (err) {
      if (err instanceof AssumeRoleError) return { status: "error", message: err.message };
      return { status: "error", message: "AssumeRole failed." };
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

  // ── Crawl stages (I1.3) ─────────────────────────────────────────────────────
  async plan(_conn: Connection, _run: SyncRun): Promise<WorkPlan> {
    throw notImplemented("plan");
  }
  // eslint-disable-next-line require-yield
  async *discover(_scope: Scope, _ctx: CrawlContext): AsyncIterable<ResourceRef> {
    throw notImplemented("discover");
  }
  async fetchDetail(_ref: ResourceRef, _ctx: CrawlContext): Promise<RawResource> {
    throw notImplemented("fetchDetail");
  }
  normalize(_raw: RawResource): NodeUpsert {
    throw notImplemented("normalize");
  }
  extractSignals(_raw: RawResource): Signal[] {
    throw notImplemented("extractSignals");
  }
  observedEdges(_raw: RawResource): EdgeUpsert[] {
    throw notImplemented("observedEdges");
  }
}

function notImplemented(stage: string): Error {
  return new Error(`AwsConnector.${stage} is implemented in I1.3 (service discoverers).`);
}
