/**
 * The only tests in this repository that touch the network or spend credits.
 *
 * They are skipped unless RUN_LIVE_JEV_TESTS=true, so `npm test` is always
 * free and always offline:
 *
 *     RUN_LIVE_JEV_TESTS=true npm test
 *     # or
 *     npm run test:live
 *
 * When they do run, a missing key or an exhausted account is reported as
 * exactly that, rather than as an opaque assertion failure.
 */

import { ArenaError, isActionType } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { loadDotEnv } from "../src/config/dotenv";
import {
  hasApiKey,
  liveTestsEnabled,
  loadTypeSafeConfig,
} from "../src/config/env";
import {
  PLAYGROUND_QUESTION,
  PLAYGROUND_STATE,
  runPlayground,
} from "../src/playground/playground";
import { renderPlaygroundReport } from "../src/playground/render";
import { createTypeSafeGateway } from "../src/typesafe/gateway";

loadDotEnv();

const enabled = liveTestsEnabled();

describe.runIf(enabled)("live TypeSafe API", () => {
  it("has a key to test with", () => {
    expect(
      hasApiKey(),
      "RUN_LIVE_JEV_TESTS=true but TYPESAFE_API_KEY is not set. Add it to .env.",
    ).toBe(true);
  });

  it("authenticates and lists at least one model", async () => {
    const gateway = createTypeSafeGateway(loadTypeSafeConfig());
    const models = await gateway.listModels();
    console.log(`  models available: ${models.join(", ")}`);
    expect(models.length).toBeGreaterThan(0);
  });

  it("returns a typed bounded decision, and reports why if it cannot", async () => {
    const gateway = createTypeSafeGateway(loadTypeSafeConfig());

    let result;
    try {
      result = await gateway.ask(PLAYGROUND_STATE, [PLAYGROUND_QUESTION]);
    } catch (error) {
      const arena = error instanceof ArenaError ? error : undefined;
      // Report accurately instead of failing with something opaque.
      throw new Error(
        [
          "The live Jev request failed.",
          `  Category: ${arena?.category ?? "UNKNOWN"}`,
          `  Message:  ${arena?.message ?? String(error)}`,
          arena?.providerMessage
            ? `  Provider: ${arena.providerMessage}`
            : undefined,
          arena?.providerRequestId
            ? `  Request:  ${arena.providerRequestId}`
            : undefined,
          `  Retryable: ${arena?.retryable ?? false}`,
        ]
          .filter(Boolean)
          .join("\n"),
        { cause: error },
      );
    }

    const answer = result.answers[PLAYGROUND_QUESTION.id]!;
    console.log(
      `  decision: ${answer.choice}  p=${(answer.probabilities[answer.choice] ?? 0).toFixed(3)}  ` +
        `confidence=${answer.confidence.toFixed(3)}  latency=${result.latencyMs}ms  model=${result.model}`,
    );

    expect(isActionType(answer.choice)).toBe(true);
    expect(answer.confidence).toBeGreaterThanOrEqual(0);
    expect(answer.confidence).toBeLessThanOrEqual(1);

    const total = Object.values(answer.probabilities).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBeCloseTo(1, 2);
    expect(Object.keys(answer.probabilities).sort()).toEqual([
      "ATTACK",
      "DEFEND",
      "DODGE",
      "MOVE",
    ]);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it("can run two decisions concurrently, as a real turn does", async () => {
    const gateway = createTypeSafeGateway(loadTypeSafeConfig());
    const startedAt = Date.now();
    const [a, b] = await Promise.all([
      gateway.ask(PLAYGROUND_STATE, [PLAYGROUND_QUESTION]),
      gateway.ask(PLAYGROUND_STATE, [PLAYGROUND_QUESTION]),
    ]);
    const wallClock = Date.now() - startedAt;
    console.log(
      `  two concurrent decisions in ${wallClock}ms (individually ${a.latencyMs}ms and ${b.latencyMs}ms)`,
    );
    expect(a.answers.action).toBeDefined();
    expect(b.answers.action).toBeDefined();
  });

  it("produces a playground report a developer can read", async () => {
    const report = await runPlayground(
      createTypeSafeGateway(loadTypeSafeConfig()),
    );
    console.log(`\n${renderPlaygroundReport(report)}\n`);
    expect(report.checks.every((check) => check.status !== "fail")).toBe(true);
  });
});

describe.runIf(!enabled)("live TypeSafe API", () => {
  it("is skipped unless explicitly enabled", () => {
    // This assertion is the guarantee that a normal `npm test` is free.
    expect(liveTestsEnabled()).toBe(false);
  });
});
