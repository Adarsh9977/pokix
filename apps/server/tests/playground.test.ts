import { ArenaError } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import {
  PLAYGROUND_QUESTION,
  PLAYGROUND_STATE,
  runPlayground,
} from "../src/playground/playground";
import { renderPlaygroundReport } from "../src/playground/render";
import { FakeGateway } from "./fake-gateway";

const statusOf = (
  report: Awaited<ReturnType<typeof runPlayground>>,
  name: string,
) => report.checks.find((check) => check.name === name)?.status;

describe("the request the playground sends", () => {
  it("uses the scenario from the spec verbatim", () => {
    expect(PLAYGROUND_STATE).toEqual({
      agent: { hp: 80, energy: 40, position: { x: 4, y: 5 } },
      enemy: { hp: 60, position: { x: 5, y: 5 } },
      availableActions: ["ATTACK", "MOVE", "DEFEND", "DODGE"],
    });
  });

  it("asks one bounded choice over exactly the four arena actions", () => {
    expect(Object.keys(PLAYGROUND_QUESTION.criteria).sort()).toEqual([
      "ATTACK",
      "DEFEND",
      "DODGE",
      "MOVE",
    ]);
  });

  it("describes every option, rather than relying on the names", () => {
    for (const description of Object.values(PLAYGROUND_QUESTION.criteria)) {
      expect(description).toBeTruthy();
      expect(String(description).length).toBeGreaterThan(20);
    }
  });

  it("does not ask the model to calculate anything", () => {
    const text = JSON.stringify(PLAYGROUND_QUESTION).toLowerCase();
    for (const forbidden of ["calculate", "compute", "how much damage"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("sends the state and question through to the gateway unchanged", async () => {
    const gateway = new FakeGateway();
    await runPlayground(gateway);
    expect(gateway.askCalls[0]!.state).toEqual(PLAYGROUND_STATE);
    expect(gateway.askCalls[0]!.questions).toEqual([PLAYGROUND_QUESTION]);
  });
});

describe("a working setup", () => {
  it("passes every check and reports the decision", async () => {
    const report = await runPlayground(new FakeGateway());

    expect(report.ok).toBe(true);
    expect(statusOf(report, "Configuration")).toBe("pass");
    expect(statusOf(report, "Authentication")).toBe("pass");
    expect(statusOf(report, "Jev request")).toBe("pass");
    expect(statusOf(report, "Typed decision")).toBe("pass");
    expect(report.decision?.action).toBe("ATTACK");
  });

  it("reports the probability of the selected option, not just confidence", async () => {
    const report = await runPlayground(new FakeGateway());
    expect(report.decision?.probability).toBe(0.91);
    expect(report.decision?.confidence).toBe(0.82);
  });

  it("authenticates with a model list rather than by spending tokens", async () => {
    const gateway = new FakeGateway();
    await runPlayground(gateway);
    expect(gateway.listModelsCalls).toBe(1);
  });

  it("records latency, model and token usage", async () => {
    const report = await runPlayground(
      new FakeGateway({ latencyMs: 512, model: "jev-1.13.0" }),
    );
    expect(report.latencyMs).toBe(512);
    expect(report.model).toBe("jev-1.13.0");
    expect(report.usage?.inputTokens).toBe(312);
  });

  it("flags a decision that is not one of our action types", async () => {
    const report = await runPlayground(
      new FakeGateway({ answer: { choice: "RETREAT" } }),
    );
    expect(report.ok).toBe(false);
    expect(statusOf(report, "Typed decision")).toBe("fail");
    expect(report.decision?.isKnownActionType).toBe(false);
  });
});

describe("credit reporting is evidence-based", () => {
  it("reports what actually happened, and admits what it cannot know", async () => {
    const report = await runPlayground(new FakeGateway({ inputTokens: 300 }));
    expect(report.credits.status).toBe("accepted");
    expect(report.credits.detail).toContain("300 input tokens");
    // The spec forbids inventing a balance. Say so out loud.
    expect(report.credits.detail).toMatch(/does not publish a balance/i);
  });

  it("never claims credits are available when nothing was sent", async () => {
    const report = await runPlayground(
      new FakeGateway({
        listModelsError: new ArenaError(
          "NETWORK_ERROR",
          "getaddrinfo ENOTFOUND",
        ),
      }),
    );
    expect(report.credits.status).toBe("unknown");
    expect(report.credits.detail).toMatch(/nothing can be established/i);
  });

  it("reports a billing refusal as such, with the provider's own words", async () => {
    const report = await runPlayground(
      new FakeGateway({
        askError: new ArenaError(
          "CREDIT_ERROR",
          "TypeSafe refused the request for billing reasons (HTTP 402).",
          { providerMessage: "Your account has no remaining credit." },
        ),
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.credits.status).toBe("blocked");
    expect(report.credits.detail).toBe("Your account has no remaining credit.");
    expect(report.failure?.category).toBe("CREDIT_ERROR");
  });
});

describe("failure classification", () => {
  it("stops at authentication and skips the rest", async () => {
    const report = await runPlayground(
      new FakeGateway({
        listModelsError: new ArenaError(
          "AUTHENTICATION_ERROR",
          "TypeSafe rejected the API key (HTTP 401). Check TYPESAFE_API_KEY.",
        ),
      }),
    );

    expect(report.ok).toBe(false);
    expect(statusOf(report, "Authentication")).toBe("fail");
    expect(statusOf(report, "Jev request")).toBe("skipped");
    expect(statusOf(report, "Typed decision")).toBe("skipped");
    expect(report.decision).toBeUndefined();
  });

  it("reports retryability so a developer knows whether to try again", async () => {
    const rate = await runPlayground(
      new FakeGateway({
        askError: new ArenaError("RATE_LIMIT_ERROR", "Slow down.", {
          retryable: true,
        }),
      }),
    );
    expect(rate.failure?.retryable).toBe(true);

    const auth = await runPlayground(
      new FakeGateway({
        askError: new ArenaError("AUTHENTICATION_ERROR", "Bad key."),
      }),
    );
    expect(auth.failure?.retryable).toBe(false);
  });

  it("classifies a non-ArenaError rather than losing it", async () => {
    const report = await runPlayground(
      new FakeGateway({ askError: new Error("socket hang up") }),
    );
    expect(report.failure?.category).toBe("PROVIDER_ERROR");
    expect(report.failure?.message).toBe("socket hang up");
  });
});

describe("concurrency check", () => {
  it("is off by default, so the minimum number of credits is spent", async () => {
    const gateway = new FakeGateway();
    const report = await runPlayground(gateway);
    expect(gateway.askCalls).toHaveLength(1);
    expect(report.concurrency).toBeUndefined();
  });

  it("fires the two requests at the same time, not one after the other", async () => {
    const gateway = new FakeGateway();
    const report = await runPlayground(gateway, { checkConcurrency: true });
    expect(gateway.askCalls).toHaveLength(3);
    expect(gateway.maxConcurrent).toBe(2);
    expect(report.concurrency?.bothSucceeded).toBe(true);
    expect(report.concurrency?.agreed).toBe(true);
  });
});

describe("rendered output", () => {
  it("shows the decision, probability, latency and distribution", async () => {
    const output = renderPlaygroundReport(
      await runPlayground(new FakeGateway({ latencyMs: 742 })),
    );
    expect(output).toContain("JEV PLAYGROUND");
    expect(output).toContain("ATTACK");
    expect(output).toContain("0.910");
    expect(output).toContain("742 ms");
    expect(output).toContain("Distribution");
  });

  it("explains a failure and points at the mock fallback", async () => {
    const output = renderPlaygroundReport(
      await runPlayground(
        new FakeGateway({
          askError: new ArenaError("CREDIT_ERROR", "Out of credit.", {
            providerMessage: "Your account has no remaining credit.",
            providerRequestId: "req_abc123",
          }),
        }),
      ),
    );
    expect(output).toContain("CREDIT_ERROR");
    expect(output).toContain("Your account has no remaining credit.");
    expect(output).toContain("req_abc123");
    expect(output).toContain("AGENT_MODE=mock");
    expect(output).not.toMatch(/something went wrong/i);
  });

  it("never prints anything that looks like a credential", async () => {
    const output = renderPlaygroundReport(
      await runPlayground(new FakeGateway()),
    );
    expect(output).not.toMatch(/TYPESAFE_API_KEY\s*[:=]\s*\S/);
    expect(output).not.toMatch(/\bsk-[A-Za-z0-9]/);
    expect(output).not.toMatch(/Bearer\s+\S/);
  });
});
