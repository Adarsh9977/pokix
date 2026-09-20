import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "{packages,apps}/*/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Live API tests are opt-in and are skipped unless RUN_LIVE_JEV_TESTS=true.
    // Nothing in the default run may touch the network or spend API credits.
    passWithNoTests: false,
  },
});
