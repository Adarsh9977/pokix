/**
 * Produces a Vercel deployment with the Build Output API.
 *
 * Why not just let Vercel detect `api/` and trace the imports?
 *
 * Because that tracing is the thing that kept breaking. Vercel does not
 * bundle a function's dependencies; it walks the import graph and copies the
 * files it believes are needed. With npm workspaces those dependencies are
 * symlinks into the repo, and getting the right files into the lambda
 * depends on resolution details we cannot see, cannot test locally, and only
 * find out about from a 500 in production.
 *
 * So we do not ask it to. Each function is bundled here into a single
 * self-contained JavaScript file with no imports left to resolve except Node
 * builtins. The output layout is the documented Build Output API contract:
 *
 *   .vercel/output/
 *     config.json
 *     static/                     <- the web app, served as files
 *     functions/api/decide.func/
 *       .vc-config.json
 *       index.js                  <- everything inlined, zero dependencies
 *
 * Nothing is traced, so nothing can be missed. And because the result is
 * plain Node, it can be executed and asserted against locally, which is what
 * `npm run verify:functions` does.
 */

import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, ".vercel", "output");

/** Every file under `api/` that should become a function. */
const FUNCTIONS = ["decide", "config"] as const;

/**
 * Node version for the lambda. Kept in step with the repo's `engines`, and
 * ahead of it where Vercel has retired a release line.
 */
const RUNTIME = "nodejs22.x";

async function buildFunction(name: string): Promise<void> {
  const funcDir = join(outputDir, "functions", "api", `${name}.func`);
  await mkdir(funcDir, { recursive: true });

  await build({
    entryPoints: [join(root, "apps/server/src/api", `${name}.ts`)],
    outfile: join(funcDir, "index.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    // Everything is inlined, including the TypeSafe SDK. The only thing left
    // unresolved is `@vercel/node`, which is types-only and erased.
    external: ["@vercel/node"],
    // Resolve workspace packages to TypeScript source directly, so the
    // bundle never depends on a separate package build having run first.
    alias: {
      "@jev-arena/server": join(root, "apps/server/src/index.ts"),
      "@jev-arena/agent-core": join(root, "packages/agent-core/src/index.ts"),
      "@jev-arena/game-core": join(root, "packages/game-core/src/index.ts"),
      "@jev-arena/types": join(root, "packages/types/src/index.ts"),
    },
    minify: false,
    sourcemap: false,
    logLevel: "warning",
  });

  await writeFile(
    join(funcDir, ".vc-config.json"),
    `${JSON.stringify(
      {
        runtime: RUNTIME,
        handler: "index.js",
        launcherType: "Nodejs",
        // Gives the handler req.body parsing and res.status().json(),
        // which is the @vercel/node signature the handlers are written to.
        shouldAddHelpers: true,
        maxDuration: 30,
      },
      null,
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  // The web app is built by `npm run build` before this script runs.
  await cp(join(root, "apps/web/dist"), join(outputDir, "static"), {
    recursive: true,
  });

  for (const name of FUNCTIONS) await buildFunction(name);

  await writeFile(
    join(outputDir, "config.json"),
    `${JSON.stringify(
      {
        version: 3,
        routes: [
          // Real files and functions win first.
          { handle: "filesystem" },
          // An unmatched /api path is a 404, never the SPA shell. Returning
          // HTML to a fetch() is what turned the last failure into a
          // confusing "non-JSON response" instead of a clear 404.
          { src: "/api/(.*)", status: 404 },
          // Everything else is the single-page app.
          { src: "/(.*)", dest: "/index.html" },
        ],
      },
      null,
      2,
    )}\n`,
  );

  console.log("Build Output API written to .vercel/output");
  console.log(`  static     apps/web/dist`);
  console.log(`  functions  ${FUNCTIONS.map((f) => `api/${f}`).join(", ")}`);
  console.log(`  runtime    ${RUNTIME}`);
}

main().catch((error: unknown) => {
  console.error("Vercel build failed:", error);
  process.exit(1);
});
