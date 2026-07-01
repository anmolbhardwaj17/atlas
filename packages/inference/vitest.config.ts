import { defineConfig } from "vitest/config";

// The engine integration tests make many sequential DB round-trips; allow generous
// timeouts for a remote Postgres and run files sequentially (shared DB + global vocab).
export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
