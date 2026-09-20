import {
  DEFAULT_GAME_CONFIG,
  ArenaError,
  attack,
  defend,
} from "@jev-arena/types";
import type { AgentObservation, GameConfig } from "@jev-arena/types";
import { buildObservation, createInitialState } from "@jev-arena/game-core";
import { MatchOrchestrator } from "@jev-arena/agent-core";
import { describe, expect, it } from "vitest";
import { JevAgent } from "../src/agents/jev-agent";
import {
  QUESTION_IDS,
  buildDecisionQuestions,
  buildDecisionState,
  parseDecision,
} from "../src/agents/jev-decision";
import type {
  JevAskResult,
  JevChoiceAnswer,
  JevChoiceQuestion,
  JevGateway,
} from "../src/typesafe/gateway";

const open: GameConfig = {
  ...DEFAULT_GAME_CONFIG,
  arena: { ...DEFAULT_GAME_CONFIG.arena, obstacles: [] },
};

function look(
  a: { x: number; y: number },
  b: { x: number; y: number },
  self: Partial<{ hp: number; energy: number }> = {},
  config: GameConfig = open,
): AgentObservation {
  const base = createInitialState({
    ...config,
    startingPositions: { A: a, B: b },
  });
  const state = {
    ...base,
    players: { ...base.players, A: { ...base.players.A, ...self } },
  };
  return buildObservation(state, "A", config);
}

function answer(choice: string, confidence = 0.8): JevChoiceAnswer {
  return { choice, confidence, probabilities: { [choice]: confidence } };
}

/** A gateway that replies with whatever the test scripts. */
class ScriptedGateway implements JevGateway {
  readonly model = "jev-latest";
  calls: { state: unknown; questions: readonly JevChoiceQuestion[] }[] = [];

  constructor(
    private readonly answers: Record<string, JevChoiceAnswer>,
    private readonly error?: unknown,
  ) {}

  async listModels(): Promise<string[]> {
    return ["jev-latest"];
  }

  async ask(
    state: unknown,
    questions: readonly JevChoiceQuestion[],
  ): Promise<JevAskResult> {
    this.calls.push({ state, questions });
    if (this.error) throw this.error;
    return {
      answers: this.answers,
      model: "jev-1.13.0",
      usage: { inputTokens: 420, outputTokens: 60 },
      latencyMs: 640,
      requestId: "req_test",
    };
  }
}

describe("the state sent to the model", () => {
  const state = buildDecisionState(
    look({ x: 5, y: 5 }, { x: 7, y: 5 }, { hp: 80 }),
  );

  it("describes the agent, the enemy and the arena in named fields", () => {
    expect(state).toHaveProperty("you");
    expect(state).toHaveProperty("enemy");
    expect(state).toHaveProperty("arena");
  });

  it("precomputes the tactical facts so the model never does arithmetic", () => {
    expect(state.tactical).toEqual({
      distanceToEnemy: 2,
      yourAttackRange: 2,
      enemyIsWithinYourReach: true,
      youAreWithinEnemyReach: true,
    });
  });

  it("never leaks the enemy's energy, which the observation never had", () => {
    expect(JSON.stringify(state)).not.toContain("enemyEnergy");
    expect((state.enemy as Record<string, unknown>).energy).toBeUndefined();
  });
});

describe("the questions asked", () => {
  it("offers only legal actions, so an illegal one cannot be chosen", () => {
    const faraway = look({ x: 1, y: 1 }, { x: 18, y: 18 });
    const [action] = buildDecisionQuestions(faraway);
    expect(Object.keys(action!.criteria)).not.toContain("ATTACK");
    expect(Object.keys(action!.criteria)).toEqual([
      ...faraway.availableActions,
    ]);
  });

  it("describes every option, rather than relying on its name", () => {
    const [action] = buildDecisionQuestions(
      look({ x: 5, y: 5 }, { x: 6, y: 5 }),
    );
    for (const description of Object.values(action!.criteria)) {
      expect(String(description).length).toBeGreaterThan(30);
    }
  });

  it("asks the action and both direction questions in one request", () => {
    const questions = buildDecisionQuestions(
      look({ x: 5, y: 5 }, { x: 6, y: 5 }),
    );
    expect(questions.map((q) => q.id)).toEqual([
      QUESTION_IDS.action,
      QUESTION_IDS.moveDirection,
      QUESTION_IDS.dodgeDirection,
    ]);
  });

  it("states the speculative premise explicitly in each direction question", () => {
    const questions = buildDecisionQuestions(
      look({ x: 5, y: 5 }, { x: 6, y: 5 }),
    );
    const moveQuestion = JSON.stringify(questions[1]!.instructions);
    expect(moveQuestion).toMatch(/assume the agent moves/i);
  });

  it("skips a direction question when there is nothing to choose between", () => {
    // Out of energy: dodging is not on the table at all.
    const broke = look({ x: 5, y: 5 }, { x: 6, y: 5 }, { energy: 0 });
    const ids = buildDecisionQuestions(broke).map((q) => q.id);
    expect(ids).not.toContain(QUESTION_IDS.dodgeDirection);
  });

  it("never asks the model to calculate or validate anything", () => {
    const text = JSON.stringify(
      buildDecisionQuestions(look({ x: 5, y: 5 }, { x: 6, y: 5 })),
    ).toLowerCase();
    for (const forbidden of [
      "calculate",
      "compute",
      "is it legal",
      "how much damage",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("parsing the answers", () => {
  const observation = look({ x: 5, y: 5 }, { x: 6, y: 5 });

  it("builds an ATTACK against the one enemy, without asking who", () => {
    const parsed = parseDecision(observation, {
      [QUESTION_IDS.action]: answer("ATTACK", 0.91),
    });
    expect(parsed.action).toEqual(attack("B"));
    expect(parsed.confidence).toBe(0.91);
  });

  it("combines the action answer with the matching direction answer", () => {
    const parsed = parseDecision(observation, {
      [QUESTION_IDS.action]: answer("MOVE"),
      [QUESTION_IDS.moveDirection]: answer("NORTH"),
      [QUESTION_IDS.dodgeDirection]: answer("SOUTH"),
    });
    // The dodge answer is speculative and simply ignored.
    expect(parsed.action).toEqual({ type: "MOVE", direction: "NORTH" });
  });

  it("keeps the distribution over the action types", () => {
    const parsed = parseDecision(observation, {
      [QUESTION_IDS.action]: {
        choice: "ATTACK",
        confidence: 0.6,
        probabilities: { ATTACK: 0.6, DEFEND: 0.3, MOVE: 0.1, NONSENSE: 0.0 },
      },
    });
    expect(parsed.probabilities).toEqual({
      ATTACK: 0.6,
      DEFEND: 0.3,
      MOVE: 0.1,
    });
  });

  it("rejects an action that was never offered, instead of coercing it", () => {
    const faraway = look({ x: 1, y: 1 }, { x: 18, y: 18 });
    expect(() =>
      parseDecision(faraway, { [QUESTION_IDS.action]: answer("ATTACK") }),
    ).toThrow(/not among the options offered/i);
  });

  it("rejects an answer that is not an action at all", () => {
    expect(() =>
      parseDecision(observation, { [QUESTION_IDS.action]: answer("RETREAT") }),
    ).toThrow(/not one of the four arena actions/i);
  });

  it("rejects an illegal direction rather than silently substituting one", () => {
    const cornered = look({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(() =>
      parseDecision(cornered, {
        [QUESTION_IDS.action]: answer("MOVE"),
        [QUESTION_IDS.moveDirection]: answer("NORTH"),
      }),
    ).toThrow(/not among the legal options/i);
  });

  it("uses the only legal direction when no question was asked", () => {
    const observation = look({ x: 5, y: 5 }, { x: 6, y: 5 });
    const single = {
      ...observation,
      legalMoveDirections: ["EAST"] as const,
    };
    const parsed = parseDecision(single, {
      [QUESTION_IDS.action]: answer("MOVE"),
    });
    expect(parsed.action).toEqual({ type: "MOVE", direction: "EAST" });
  });

  it("classifies a missing action answer", () => {
    expect(() => parseDecision(observation, {})).toThrow(ArenaError);
  });
});

describe("JevAgent", () => {
  it("returns a model-origin decision carrying confidence and provenance", async () => {
    const gateway = new ScriptedGateway({
      [QUESTION_IDS.action]: answer("ATTACK", 0.88),
    });
    const decision = await new JevAgent(gateway).decide(
      look({ x: 5, y: 5 }, { x: 6, y: 5 }),
    );

    expect(decision.origin).toBe("model");
    expect(decision.action).toEqual(attack("B"));
    expect(decision.confidence).toBe(0.88);
    expect(decision.model).toBe("jev-1.13.0");
    expect(decision.providerRequestId).toBe("req_test");
    expect(decision.providerLatencyMs).toBe(640);
  });

  it("spends exactly one request per turn", async () => {
    const gateway = new ScriptedGateway({
      [QUESTION_IDS.action]: answer("DEFEND"),
    });
    await new JevAgent(gateway).decide(look({ x: 5, y: 5 }, { x: 6, y: 5 }));
    expect(gateway.calls).toHaveLength(1);
  });

  it("contains no game rules: it never invents an unoffered option", async () => {
    const faraway = look({ x: 1, y: 1 }, { x: 18, y: 18 });
    const gateway = new ScriptedGateway({
      [QUESTION_IDS.action]: answer("ATTACK"),
    });
    await expect(new JevAgent(gateway).decide(faraway)).rejects.toThrow(
      ArenaError,
    );
  });

  it("lets a provider failure through, classified, for the orchestrator to absorb", async () => {
    const gateway = new ScriptedGateway(
      {},
      new ArenaError("CREDIT_ERROR", "No credit remaining."),
    );
    await expect(
      new JevAgent(gateway).decide(look({ x: 5, y: 5 }, { x: 6, y: 5 })),
    ).rejects.toThrow(/no credit remaining/i);
  });
});

describe("JevAgent inside a real turn", () => {
  const config: GameConfig = {
    ...open,
    startingPositions: { A: { x: 5, y: 5 }, B: { x: 6, y: 5 } },
    maxTurns: 1,
  };

  it("plays a turn, and the trace carries the model and probability", async () => {
    const gateway = new ScriptedGateway({
      [QUESTION_IDS.action]: {
        choice: "ATTACK",
        confidence: 0.77,
        probabilities: { ATTACK: 0.83, DEFEND: 0.17 },
      },
    });

    const orchestrator = new MatchOrchestrator(
      { A: new JevAgent(gateway), B: new JevAgent(gateway) },
      { config },
    );
    const record = await orchestrator.playTurn();

    expect(record.decisions.A.origin).toBe("model");
    expect(record.traces.A.model).toBe("jev-1.13.0");
    expect(record.traces.A.confidence).toBe(0.77);
    expect(record.traces.A.probability).toBe(0.83);
    expect(record.resolution.next.players.B.hp).toBeLessThan(100);
  });

  it("degrades to the fallback, not a crash, when the provider fails", async () => {
    const broken = new ScriptedGateway(
      {},
      new ArenaError("QUOTA_ERROR", "Monthly allowance exhausted."),
    );
    const orchestrator = new MatchOrchestrator(
      { A: new JevAgent(broken), B: new JevAgent(broken) },
      { config },
    );
    const record = await orchestrator.playTurn();

    expect(record.decisions.A.origin).toBe("fallback");
    expect(record.decisions.A.action).toEqual(defend());
    expect(record.traces.A.errorCategory).toBe("QUOTA_ERROR");
    expect(record.resolution.next.status).toBe("finished");
  });
});
