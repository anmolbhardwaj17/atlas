import { defineConfig } from "vitest/config";

// NestJS uses TypeScript legacy decorators; ensure esbuild (vitest's transformer)
// parses them. Direct unit tests don't need decorator *metadata*, so this is enough.
export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
      },
    },
  },
  // Env-gated service integration tests hit a remote Postgres; allow generous timeouts
  // and run files sequentially (shared DB).
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
