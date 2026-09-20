import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) =>
  fileURLToPath(new URL(`./${path}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Workspace packages resolve to TypeScript source here, not to their
  // built output, so tests always exercise what you just edited and no
  // build step sits between saving a file and running the suite.
  // Node itself cannot load `.ts`, which is why the packages also publish a
  // bundled `dist` for the serverless runtime. See docs/ASSUMPTIONS.md A24.
  resolve: {
    alias: {
      "@jev-arena/types": src("packages/types"),
      "@jev-arena/game-core": src("packages/game-core"),
      "@jev-arena/agent-core": src("packages/agent-core"),
      "@jev-arena/server": src("apps/server"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "{packages,apps}/*/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Live API tests are opt-in and are skipped unless RUN_LIVE_JEV_TESTS=true.
    // Nothing in the default run may touch the network or spend API credits.
    passWithNoTests: false,
  },
});
