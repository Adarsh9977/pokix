import {
  DEFAULT_GAME_CONFIG,
  ArenaError,
  attack,
  defend,
  dodge,
  move,
  type Action,
  type AgentDecision,
  type AgentObservation,
  type DecisionTrace,
  type GameConfig,
} from "@jev-arena/types";
import { createInitialState } from "@jev-arena/game-core";
import { describe, expect, it } from "vitest";
import type { Agent } from "../src/agent";
import { MatchOrchestrator, runAgentMatch } from "../src/orchestrator";
import { HeuristicAgent, MockAgent } from "../src/mock-agents";

const arena: GameConfig = {
  ...DEFAULT_GAME_CONFIG,
  arena: { ...DEFAULT_GAME_CONFIG.arena, obstacles: [] },
  startingPositions: { A: { x: 5, y: 5 }, B: { x: 7, y: 5 } },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Answers after a fixed delay. */
class SlowAgent implements Agent {
  readonly name: string;
  constructor(
    private readonly delayMs: number,
    private readonly action: Action = defend(),
    name?: string,
  ) {
    this.name = name ?? `Slow(${delayMs}ms)`;
  }
  async decide(_observation: AgentObservation): Promise<AgentDecision> {
    await sleep(this.delayMs);
    return { action: this.action, origin: "mock" };
  }
}

/** Never answers. */
class HangingAgent implements Agent {
  readonly name = "Hanging";
  async decide(_observation: AgentObservation): Promise<AgentDecision> {
    return new Promise<AgentDecision>(() => {});
  }
}

class ThrowingAgent implements Agent {
  readonly name = "Throwing";
  constructor(private readonly error: unknown) {}
  async decide(_observation: AgentObservation): Promise<AgentDecision> {
    throw this.error;
  }
}

/** Returns something that is not a valid Action. */
class MalformedAgent implements Agent {
  readonly name = "Malformed";
  constructor(private readonly payload: unknown) {}
  async decide(_observation: AgentObservation): Promise<AgentDecision> {
    return { action: this.payload, origin: "model" } as AgentDecision;
  }
}

describe("both agents decide from one snapshot", () => {
  it("hands both agents the same turn and state version", async () => {
    const seen: { turn: number; version: number }[] = [];
    const spy = (): Agent => ({
      name: "Spy",
      async decide(observation) {
        seen.push({
          turn: observation.turn,
          version: observation.stateVersion,
        });
        return { action: defend(), origin: "mock" };
      },
    });

    const orchestrator = new MatchOrchestrator(
      { A: spy(), B: spy() },
      { config: arena },
    );
    await orchestrator.playTurn();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
  });

  it("builds both observations before asking either agent", async () => {
    // If the loop asked A, applied it, then asked B, B would see a changed
    // world. Both observations must describe the same version.
    const record = await new MatchOrchestrator(
      { A: new MockAgent(move("EAST")), B: new MockAgent(move("WEST")) },
      { config: arena },
    ).playTurn();

    expect(record.observations.A.stateVersion).toBe(
      record.observations.B.stateVersion,
    );
    expect(record.observations.A.enemy.position).toEqual(
      record.observations.B.self.position,
    );
  });
});

describe("latency does not decide the turn (spec commit 5 acceptance)", () => {
  it("resolves identically no matter which agent answers first", async () => {
    // Artificially delay A. Then artificially delay B. Same result.
    const aSlow = await runAgentMatch(
      { A: new SlowAgent(60, attack("B")), B: new SlowAgent(5, dodge("EAST")) },
      { config: { ...arena, maxTurns: 1 } },
    );
    const bSlow = await runAgentMatch(
      { A: new SlowAgent(5, attack("B")), B: new SlowAgent(60, dodge("EAST")) },
      { config: { ...arena, maxTurns: 1 } },
    );

    expect(bSlow.finalState).toEqual(aSlow.finalState);
    expect(bSlow.turns[0]!.decisions).toEqual(aSlow.turns[0]!.decisions);
  });

  it("waits for the slower agent rather than resolving without it", async () => {
    const started = Date.now();
    const result = await runAgentMatch(
      { A: new SlowAgent(0), B: new SlowAgent(80) },
      { config: { ...arena, maxTurns: 1 } },
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
    expect(result.turns[0]!.decisions.B.origin).toBe("mock");
  });

  it("launches the two requests concurrently, not back to back", async () => {
    const started = Date.now();
    await runAgentMatch(
      { A: new SlowAgent(70), B: new SlowAgent(70) },
      { config: { ...arena, maxTurns: 1 } },
    );
    // Sequential would be ~140ms. Concurrent is ~70ms.
    expect(Date.now() - started).toBeLessThan(130);
  });
});

describe("timeouts", () => {
  it("falls back deterministically when an agent never answers", async () => {
    const result = await runAgentMatch(
      { A: new HangingAgent(), B: new MockAgent(defend()) },
      { config: { ...arena, maxTurns: 1 }, decisionTimeoutMs: 30 },
    );

    const turn = result.turns[0]!;
    expect(turn.decisions.A.origin).toBe("fallback");
    expect(turn.decisions.A.action).toEqual(defend());
    expect(turn.traces.A.errorCategory).toBe("TIMEOUT_ERROR");
    expect(turn.traces.A.error).toMatch(/did not answer within 30 ms/);
  });

  it("uses the configured fallback action, not a hard-coded one", async () => {
    const result = await runAgentMatch(
      { A: new HangingAgent(), B: new MockAgent(defend()) },
      {
        config: { ...arena, maxTurns: 1 },
        decisionTimeoutMs: 20,
        fallbackAction: move("NORTH"),
      },
    );
    expect(result.turns[0]!.decisions.A.action).toEqual(move("NORTH"));
  });

  it("never corrupts the state: a timed-out turn still resolves cleanly", async () => {
    const result = await runAgentMatch(
      { A: new HangingAgent(), B: new HangingAgent() },
      { config: { ...arena, maxTurns: 3 }, decisionTimeoutMs: 15 },
    );
    expect(result.finalState.status).toBe("finished");
    expect(result.turnCount).toBe(3);
    expect(result.finalState.players.A.hp).toBe(arena.player.maxHp);
  });

  it("does not time out when no timeout is configured", async () => {
    const result = await runAgentMatch(
      { A: new SlowAgent(40), B: new MockAgent(defend()) },
      { config: { ...arena, maxTurns: 1 } },
    );
    expect(result.turns[0]!.traces.A.errorCategory).toBeUndefined();
  });
});

describe("agent failures", () => {
  it("falls back and preserves the provider's category when an agent throws", async () => {
    const result = await runAgentMatch(
      {
        A: new ThrowingAgent(
          new ArenaError(
            "CREDIT_ERROR",
            "Your account has no remaining credit.",
          ),
        ),
        B: new MockAgent(defend()),
      },
      { config: { ...arena, maxTurns: 1 } },
    );

    const trace = result.turns[0]!.traces.A;
    expect(trace.errorCategory).toBe("CREDIT_ERROR");
    expect(trace.error).toBe("Your account has no remaining credit.");
    expect(result.turns[0]!.decisions.A.origin).toBe("fallback");
  });

  it("classifies an unrecognised throw rather than losing it", async () => {
    const result = await runAgentMatch(
      {
        A: new ThrowingAgent(new Error("socket hang up")),
        B: new MockAgent(defend()),
      },
      { config: { ...arena, maxTurns: 1 } },
    );
    expect(result.turns[0]!.traces.A.errorCategory).toBe("PROVIDER_ERROR");
    expect(result.turns[0]!.traces.A.error).toBe("socket hang up");
  });

  it("rejects a structurally malformed action", async () => {
    const result = await runAgentMatch(
      {
        A: new MalformedAgent({ type: "TELEPORT", to: { x: 0, y: 0 } }),
        B: new MockAgent(defend()),
      },
      { config: { ...arena, maxTurns: 1 } },
    );
    expect(result.turns[0]!.traces.A.errorCategory).toBe("INVALID_RESPONSE");
    expect(result.turns[0]!.decisions.A.action).toEqual(defend());
  });

  it("rejects a MOVE with a nonsense direction", async () => {
    const result = await runAgentMatch(
      {
        A: new MalformedAgent({ type: "MOVE", direction: "UPWARDS" }),
        B: new MockAgent(defend()),
      },
      { config: { ...arena, maxTurns: 1 } },
    );
    expect(result.turns[0]!.traces.A.errorCategory).toBe("INVALID_RESPONSE");
  });

  it("still lets a well-formed but illegal action through to the engine", async () => {
    // Attacking from out of range is not the orchestrator's business to
    // refuse. The engine rejects it, and says so.
    const faraway: GameConfig = {
      ...arena,
      startingPositions: { A: { x: 1, y: 1 }, B: { x: 18, y: 18 } },
      maxTurns: 1,
    };
    const result = await runAgentMatch(
      { A: new MockAgent(attack("B")), B: new MockAgent(defend()) },
      { config: faraway },
    );
    expect(result.turns[0]!.traces.A.errorCategory).toBeUndefined();
    expect(result.turns[0]!.resolution.players.A.rejection?.reason).toBe(
      "OUT_OF_RANGE",
    );
  });
});

describe("stale decision protection (spec 23)", () => {
  it("knows whether a decision is still about the current world", async () => {
    const orchestrator = new MatchOrchestrator(
      { A: new MockAgent(defend()), B: new MockAgent(defend()) },
      { config: arena },
    );
    expect(orchestrator.isStale({ stateVersion: 0 })).toBe(false);
    await orchestrator.playTurn();
    expect(orchestrator.isStale({ stateVersion: 0 })).toBe(true);
    expect(orchestrator.isStale({ stateVersion: 1 })).toBe(false);
  });

  it("discards a late answer instead of applying it to a newer state", async () => {
    // A times out on turn 1, the turn resolves without it, and only then does
    // A's original request settle. That answer is for a world that no longer
    // exists and must never be applied.
    const stale: DecisionTrace[] = [];
    let resolveLate: ((decision: AgentDecision) => void) | undefined;

    const lateAgent: Agent = {
      name: "Late",
      decide: () =>
        new Promise<AgentDecision>((resolve) => {
          resolveLate = resolve;
        }),
    };

    const orchestrator = new MatchOrchestrator(
      { A: lateAgent, B: new MockAgent(defend()) },
      {
        config: arena,
        decisionTimeoutMs: 20,
        onStaleDecision: (trace) => stale.push(trace),
      },
    );

    const first = await orchestrator.playTurn();
    expect(first.decisions.A.origin).toBe("fallback");
    expect(orchestrator.state.version).toBe(1);

    // The abandoned request finally answers, one turn too late.
    resolveLate?.({ action: attack("B"), origin: "model" });
    await sleep(5);

    expect(stale).toHaveLength(1);
    expect(stale[0]!.errorCategory).toBe("STALE_DECISION");
    expect(stale[0]!.stateVersion).toBe(0);
    // And it changed nothing.
    expect(orchestrator.state.version).toBe(1);
    expect(orchestrator.state.players.B.hp).toBe(arena.player.maxHp);
  });
});

describe("decision traces (spec 18)", () => {
  it("writes one trace per agent per turn, with the spec's fields", async () => {
    const traces: DecisionTrace[] = [];
    const result = await runAgentMatch(
      { A: new SlowAgent(10, attack("B")), B: new MockAgent(defend()) },
      {
        config: { ...arena, maxTurns: 1 },
        onTrace: (trace) => traces.push(trace),
      },
    );

    expect(traces).toHaveLength(2);
    const trace = result.turns[0]!.traces.A;
    expect(trace.turn).toBe(1);
    expect(trace.agentId).toBe("A");
    expect(trace.stateVersion).toBe(0);
    expect(trace.action).toEqual(attack("B"));
    expect(trace.origin).toBe("mock");
    expect(trace.requestCompletedAt).toBeGreaterThanOrEqual(
      trace.requestStartedAt,
    );
    expect(trace.latencyMs).toBe(
      trace.requestCompletedAt - trace.requestStartedAt,
    );
  });

  it("measures real latency", async () => {
    const result = await runAgentMatch(
      { A: new SlowAgent(50), B: new MockAgent(defend()) },
      { config: { ...arena, maxTurns: 1 } },
    );
    expect(result.turns[0]!.traces.A.latencyMs).toBeGreaterThanOrEqual(45);
    expect(result.turns[0]!.traces.B.latencyMs).toBeLessThan(45);
  });

  it("records no confidence for a mock agent", async () => {
    const result = await runAgentMatch(
      { A: new MockAgent(defend()), B: new MockAgent(defend()) },
      { config: { ...arena, maxTurns: 1 } },
    );
    expect(result.turns[0]!.traces.A.confidence).toBeUndefined();
  });

  it("uses an injectable clock, so latency is testable without waiting", async () => {
    let clock = 1_000;
    const result = await runAgentMatch(
      { A: new MockAgent(defend()), B: new MockAgent(defend()) },
      {
        config: { ...arena, maxTurns: 1 },
        now: () => (clock += 7),
      },
    );
    expect(result.turns[0]!.traces.A.latencyMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });
});

describe("match bookkeeping", () => {
  it("carries a match id and timing for the analytics layer", async () => {
    const result = await runAgentMatch(
      { A: new HeuristicAgent(), B: new HeuristicAgent() },
      { config: arena, matchId: "match-under-test" },
    );
    expect(result.matchId).toBe("match-under-test");
    expect(result.durationMs).toBe(result.completedAt - result.startedAt);
  });

  it("refuses to play a turn after the match has finished", async () => {
    const orchestrator = new MatchOrchestrator(
      { A: new MockAgent(defend()), B: new MockAgent(defend()) },
      { config: { ...arena, maxTurns: 1 } },
    );
    await orchestrator.playMatch();
    await expect(orchestrator.playTurn()).rejects.toThrow(/finished/i);
  });

  it("can resume from a supplied snapshot", async () => {
    const start = createInitialState(arena);
    const orchestrator = new MatchOrchestrator(
      { A: new MockAgent(defend()), B: new MockAgent(defend()) },
      { config: arena, initialState: start },
    );
    expect(orchestrator.state).toBe(start);
  });
});
