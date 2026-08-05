import {
  Global,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
  Inject,
} from "@nestjs/common";
import { loadEnv, type Env } from "@atlas/config";
import { assertRestrictedRole, createPool, type Db } from "@atlas/db";
import { ENV, PG_POOL } from "./tokens";
import { AuditService } from "./audit.service";
import { AnalyticsService } from "./analytics.service";
import { EmailService } from "./email.service";
import { ImageUploadService } from "./image-upload.service";
import { RateLimitService } from "./rate-limit.service";
import { LeaderLockService } from "./leader-lock.service";

/**
 * App-wide singletons (docs/02 §3, docs/17 §6): the parsed env (fail-fast at boot)
 * and a single Postgres pool connected as the restricted, non-bypass `atlas_app`
 * role - the role RLS enforces against (docs/04 §10, docs/12 §4). Global so feature
 * modules inject ENV/PG_POOL without re-importing.
 */
const envProvider: Provider = {
  provide: ENV,
  useFactory: (): Env => loadEnv(),
};

const poolProvider: Provider = {
  provide: PG_POOL,
  inject: [ENV],
  useFactory: (env: Env): Db => {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required (atlas_app role) - see .env / docs/12 §4");
    }
    return createPool(env.DATABASE_URL, env.PG_POOL_MAX, env.PG_STATEMENT_TIMEOUT_MS);
  },
};

@Global()
@Module({
  providers: [
    envProvider,
    poolProvider,
    AuditService,
    AnalyticsService,
    EmailService,
    ImageUploadService,
    RateLimitService,
    LeaderLockService,
  ],
  exports: [
    ENV,
    PG_POOL,
    AuditService,
    AnalyticsService,
    EmailService,
    ImageUploadService,
    RateLimitService,
    LeaderLockService,
  ],
})
export class CoreModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CoreModule.name);

  constructor(@Inject(PG_POOL) private readonly pool: Db) {}

  /** Fail-closed at boot if the DB pool can bypass RLS (superuser/BYPASSRLS) — that would silently
   *  disable all tenant isolation (R8). Refuse to start rather than serve cross-tenant data. */
  async onApplicationBootstrap(): Promise<void> {
    await assertRestrictedRole(this.pool);
    this.logger.log("DB role check passed: connected as a restricted, RLS-enforced role.");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
