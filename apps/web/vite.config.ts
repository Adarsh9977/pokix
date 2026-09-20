import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = (path: string) =>
  fileURLToPath(new URL(`../../${path}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // The browser bundle is built from TypeScript source, so Vite tree-shakes
  // the engine properly and `npm run dev` needs no prior package build.
  // `@jev-arena/server` is deliberately absent: it must never reach the
  // browser, and there is a test asserting so.
  resolve: {
    alias: {
      "@jev-arena/types": src("packages/types"),
      "@jev-arena/game-core": src("packages/game-core"),
      "@jev-arena/agent-core": src("packages/agent-core"),
    },
  },
  server: {
    port: 5173,
    // `vercel dev` serves the serverless functions on 3000. Without this,
    // Jev mode in local development would have nowhere to send /api/decide.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
