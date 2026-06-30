import { defineConfig } from "vitest/config";

// The sync-runner integration tests make many sequential DB round-trips; allow
// generous timeouts so they pass against a remote Postgres (CI's local PG is fast).
export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
