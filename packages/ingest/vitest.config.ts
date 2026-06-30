import { defineConfig } from "vitest/config";

// The sync-runner integration tests make many sequential DB round-trips; allow
// generous timeouts so they pass against a remote Postgres (CI's local PG is fast).
export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration files share one Postgres + global vocab (node_kinds); run them
    // sequentially so teardown of one can't race another.
    fileParallelism: false,
  },
});
