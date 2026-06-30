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
});
