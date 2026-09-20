/**
 * npm run jev:playground
 *
 * One command that tells a developer whether their TypeSafe/Jev setup works,
 * and if it does not, exactly why.
 *
 * This is the only script that deliberately spends API credits, and it spends
 * about as little as it is possible to spend: one small request, plus two more
 * if concurrency is being checked.
 */

import {
  createTypeSafeGateway,
  hasApiKey,
  loadDotEnv,
  loadTypeSafeConfig,
  renderPlaygroundReport,
  runPlayground,
  ENV_VARS,
} from "@jev-arena/server";
import { ArenaError } from "@jev-arena/types";

const RULE = "━".repeat(46);

function fatal(category: string, message: string, hint?: string): never {
  console.error(RULE);
  console.error("            JEV PLAYGROUND");
  console.error(RULE);
  console.error("");
  console.error("  ✗  Configuration");
  console.error("");
  console.error("  Category");
  console.error(`      ${category}`);
  console.error("");
  console.error("  Problem");
  console.error(`      ${message}`);
  if (hint) {
    console.error("");
    console.error("  Fix");
    console.error(`      ${hint}`);
  }
  console.error("");
  console.error("  The game remains fully playable with AGENT_MODE=mock:");
  console.error("      npm run simulate");
  console.error("");
  console.error(RULE);
  process.exit(1);
}

async function main(): Promise<void> {
  loadDotEnv();

  const skipConcurrency = process.argv.includes("--minimal");
  const timeoutArg = process.argv.find((arg) => arg.startsWith("--timeout="));
  const timeoutMs = timeoutArg
    ? Number.parseInt(timeoutArg.split("=")[1] ?? "", 10)
    : undefined;

  if (!hasApiKey()) {
    fatal(
      "CONFIGURATION_ERROR",
      `${ENV_VARS.apiKey} is not set, so no request can be attempted.`,
      "cp .env.example .env   then paste your key from https://console.typesafe.ai",
    );
  }

  let gateway;
  try {
    gateway = createTypeSafeGateway(loadTypeSafeConfig(), {
      ...(timeoutMs === undefined || Number.isNaN(timeoutMs)
        ? {}
        : { timeoutMs }),
    });
  } catch (error) {
    const arena = error instanceof ArenaError ? error : undefined;
    fatal(
      arena?.category ?? "CONFIGURATION_ERROR",
      arena?.message ?? String(error),
    );
  }

  const report = await runPlayground(gateway, {
    checkConcurrency: !skipConcurrency,
  });

  console.log(renderPlaygroundReport(report));
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("The playground itself failed unexpectedly:", error);
  process.exitCode = 1;
});
