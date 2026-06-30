/** DI tokens for app-wide singletons (parsed env + the atlas_app Postgres pool). */
export const ENV = Symbol("ATLAS_ENV");
export const PG_POOL = Symbol("ATLAS_PG_POOL");
