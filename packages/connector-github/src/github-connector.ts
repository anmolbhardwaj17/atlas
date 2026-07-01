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
  logger?: ConnectorLogger;
}

export class GithubConnector implements Connector {
  readonly provider = "github" as const;
  private readonly auth: InstallationTokenProvider;
  private readonly secrets: SecretAccessor;
  private readonly log: ConnectorLogger;

  constructor(deps: GithubConnectorDeps) {
    this.auth = deps.auth;
    this.secrets = deps.secrets;
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

  // ── Crawl stages (I2.3 pure transforms, I2.4 live discover) ──────────────────
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
  return new Error(`GithubConnector.${stage} is implemented in I2.3/I2.4.`);
}
