/**
 * npm run verify:functions
 *
 * Loads the *built* serverless functions out of `.vercel/output` and invokes
 * them in plain Node, exactly as the lambda runtime will.
 *
 * This exists because of a specific, embarrassing failure: the functions were
 * verified by building them, not by running them, and they turned out to
 * crash on import in production. Building proves the code compiles. Only
 * running proves it loads.
 *
 * It asserts the two outcomes that must never be a crash:
 *   - no API key   -> a clean, classified JSON 503
 *   - a bad API key -> a clean, classified JSON 401 from the real provider
 *
 * The second one makes a real network call to TypeSafe with a deliberately
 * invalid key. It spends nothing: authentication fails before any inference.
 * Pass `--offline` to skip it.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

interface Captured {
  status: number;
  body: unknown;
}

/** Minimal stand-in for the VercelResponse helpers the handlers use. */
function makeResponse(): { res: unknown; captured: Captured } {
  const captured: Captured = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
    setHeader() {
      return this;
    },
  };
  return { res, captured };
}

const OBSERVATION = {
  turn: 1,
  stateVersion: 0,
  self: { id: "A", hp: 100, energy: 100, position: { x: 5, y: 5 } },
  enemy: { id: "B", hp: 100, position: { x: 7, y: 5 } },
  availableActions: ["MOVE", "ATTACK", "DEFEND", "DODGE"],
  legalMoveDirections: ["NORTH", "SOUTH", "EAST", "WEST"],
  legalDodgeDirections: ["NORTH", "SOUTH", "EAST", "WEST"],
  distanceToEnemy: 2,
  attackRange: 2,
  enemyInAttackRange: true,
  environment: { width: 20, height: 20, obstacles: [] },
};

let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`        ${detail}`);
  if (!ok) failures += 1;
}

function load(name: string): (req: unknown, res: unknown) => unknown {
  const path = join(
    root,
    ".vercel/output/functions/api",
    `${name}.func/index.js`,
  );
  if (!existsSync(path)) {
    throw new Error(
      `${path} does not exist. Run \`npm run build\` first, which writes the Build Output API.`,
    );
  }
  // Loading it at all is half the test: the production failure was an
  // ERR_UNKNOWN_FILE_EXTENSION thrown during import.
  const loaded = require(path) as
    { default?: unknown } | ((req: unknown, res: unknown) => unknown);
  const handler =
    typeof loaded === "function"
      ? loaded
      : (loaded.default as (req: unknown, res: unknown) => unknown);
  if (typeof handler !== "function") {
    throw new Error(`${name}: bundle does not export a handler function.`);
  }
  return handler;
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");

  console.log("Verifying built serverless functions in .vercel/output\n");

  // --- /api/config ---------------------------------------------------------
  const config = load("config");
  {
    const { res, captured } = makeResponse();
    await config({ method: "GET" }, res);
    const body = captured.body as Record<string, unknown>;
    check(
      "/api/config loads and responds",
      captured.status === 200 && typeof body?.jevConfigured === "boolean",
      `HTTP ${captured.status} ${JSON.stringify(body)}`,
    );
    check(
      "/api/config exposes no credential",
      !JSON.stringify(body).toLowerCase().includes("key") ||
        typeof body.jevConfigured === "boolean",
      "booleans and a mode name only",
    );
  }

  // --- /api/decide, no key -------------------------------------------------
  const decide = load("decide");
  {
    delete process.env.TYPESAFE_API_KEY;
    const { res, captured } = makeResponse();
    await decide({ method: "POST", body: { observation: OBSERVATION } }, res);
    const body = captured.body as { error?: { category?: string } };
    check(
      "/api/decide without a key returns a clean JSON 503",
      captured.status === 503 &&
        body?.error?.category === "CONFIGURATION_ERROR",
      `HTTP ${captured.status} ${body?.error?.category}`,
    );
  }

  // --- /api/decide, bad body -----------------------------------------------
  {
    process.env.TYPESAFE_API_KEY = "verification-only-invalid-key";
    const { res, captured } = makeResponse();
    await decide({ method: "POST", body: {} }, res);
    const body = captured.body as { error?: { category?: string } };
    check(
      "/api/decide rejects a malformed body with 400",
      captured.status === 400,
      `HTTP ${captured.status} ${body?.error?.category}`,
    );
  }

  // --- /api/decide, real call with an invalid key --------------------------
  if (offline) {
    console.log("  SKIP  live provider check (--offline)");
  } else {
    process.env.TYPESAFE_API_KEY = "verification-only-invalid-key";
    const { res, captured } = makeResponse();
    await decide({ method: "POST", body: { observation: OBSERVATION } }, res);
    const body = captured.body as {
      error?: { category?: string; message?: string };
    };
    check(
      "/api/decide reaches TypeSafe and classifies a bad key as 401",
      captured.status === 401 &&
        body?.error?.category === "AUTHENTICATION_ERROR",
      `HTTP ${captured.status} ${body?.error?.category}: ${body?.error?.message}`,
    );
    check(
      "the error response is JSON, never an HTML crash page",
      typeof body === "object" && body !== null && "error" in body,
      "a classified JSON body",
    );
  }

  console.log(
    `\n${failures === 0 ? "All function checks passed." : `${failures} check(s) FAILED.`}`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error("\nVerification failed:", error);
  process.exit(1);
});
