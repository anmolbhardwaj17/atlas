import { Global, Module, type OnApplicationShutdown, type Provider, Inject } from "@nestjs/common";
import { loadEnv, type Env } from "@atlas/config";
import { createPool, type Db } from "@atlas/db";
import { ENV, PG_POOL } from "./tokens";

/**
 * App-wide singletons (docs/02 §3, docs/17 §6): the parsed env (fail-fast at boot)
 * and a single Postgres pool connected as the restricted, non-bypass `atlas_app`
 * role — the role RLS enforces against (docs/04 §10, docs/12 §4). Global so feature
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
      throw new Error("DATABASE_URL is required (atlas_app role) — see .env / docs/12 §4");
    }
    return createPool(env.DATABASE_URL);
  },
};

@Global()
@Module({
  providers: [envProvider, poolProvider],
  exports: [ENV, PG_POOL],
})
export class CoreModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
