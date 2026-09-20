import {
  DEFAULT_GAME_CONFIG,
  attack,
  defend,
  dodge,
  move,
  type GameConfig,
} from "@jev-arena/types";
import { buildObservation, createInitialState } from "@jev-arena/game-core";
import { describe, expect, it } from "vitest";
import { HeuristicAgent, MockAgent, ScriptedAgent } from "../src/mock-agents";

const config = DEFAULT_GAME_CONFIG;
const observationFor = (
  state = createInitialState(config),
  id: "A" | "B" = "A",
) => buildObservation(state, id, config);

describe("MockAgent", () => {
  it("always returns the action it was constructed with", async () => {
    const agent = new MockAgent(attack("B"));
    for (let i = 0; i < 3; i += 1) {
      const decision = await agent.decide(observationFor());
      expect(decision.action).toEqual(attack("B"));
    }
  });

  it("marks its decisions as mock, not model", async () => {
    const decision = await new MockAgent(defend()).decide(observationFor());
    expect(decision.origin).toBe("mock");
  });

  it("reports no confidence, rather than a fabricated 1.0", async () => {
    const decision = await new MockAgent(defend()).decide(observationFor());
    expect(decision.confidence).toBeUndefined();
    expect(decision.probabilities).toBeUndefined();
  });

  it("names itself after its action, for readable logs", () => {
    expect(new MockAgent(move("NORTH")).name).toBe("Mock(MOVE NORTH)");
    expect(new MockAgent(defend(), "Statue").name).toBe("Statue");
  });
});

describe("ScriptedAgent", () => {
  it("plays its script in order", async () => {
    const agent = new ScriptedAgent([
      move("EAST"),
      attack("B"),
      dodge("NORTH"),
    ]);
    const observation = observationFor();
    expect((await agent.decide(observation)).action).toEqual(move("EAST"));
    expect((await agent.decide(observation)).action).toEqual(attack("B"));
    expect((await agent.decide(observation)).action).toEqual(dodge("NORTH"));
  });

  it("falls back to DEFEND once the script runs out", async () => {
    const agent = new ScriptedAgent([move("EAST")]);
    const observation = observationFor();
    await agent.decide(observation);
    expect((await agent.decide(observation)).action).toEqual(defend());
  });

  it("loops when asked to", async () => {
    const agent = new ScriptedAgent([move("EAST"), move("WEST")], {
      loop: true,
    });
    const observation = observationFor();
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      seen.push((await agent.decide(observation)).action);
    }
    expect(seen).toEqual([
      move("EAST"),
      move("WEST"),
      move("EAST"),
      move("WEST"),
    ]);
  });

  it("replays identically after a reset", async () => {
    const agent = new ScriptedAgent([move("EAST"), attack("B")]);
    const observation = observationFor();
    const first = [
      (await agent.decide(observation)).action,
      (await agent.decide(observation)).action,
    ];
    agent.reset();
    const second = [
      (await agent.decide(observation)).action,
      (await agent.decide(observation)).action,
    ];
    expect(second).toEqual(first);
  });

  it("refuses an empty script instead of silently doing nothing", () => {
    expect(() => new ScriptedAgent([])).toThrow(/at least one action/i);
  });
});

describe("HeuristicAgent", () => {
  const agent = new HeuristicAgent();

  // An empty arena, so these tests exercise the policy rather than the
  // default obstacle layout. Obstacle avoidance gets its own test below.
  const open: GameConfig = {
    ...config,
    arena: { ...config.arena, obstacles: [] },
  };

  const look = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    self: Partial<{ hp: number; energy: number }> = {},
    cfg: GameConfig = open,
  ) => {
    const base = createInitialState({
      ...cfg,
      startingPositions: { A: a, B: b },
    });
    const state = {
      ...base,
      players: { ...base.players, A: { ...base.players.A, ...self } },
    };
    return buildObservation(state, "A", cfg);
  };

  it("attacks when the enemy is in range", async () => {
    const decision = await agent.decide(look({ x: 5, y: 5 }, { x: 6, y: 5 }));
    expect(decision.action).toEqual(attack("B"));
  });

  it("closes the larger axis gap when out of range", async () => {
    const decision = await agent.decide(look({ x: 2, y: 5 }, { x: 17, y: 6 }));
    expect(decision.action).toEqual(move("EAST"));
  });

  it("closes vertically when that is the larger gap", async () => {
    const decision = await agent.decide(look({ x: 5, y: 2 }, { x: 6, y: 17 }));
    expect(decision.action).toEqual(move("SOUTH"));
  });

  it("routes around an obstacle rather than walking into it", async () => {
    // (3,4) is an obstacle in the default layout, so SOUTH is not offered
    // even though it is the direction that closes the larger gap.
    const observation = look({ x: 3, y: 3 }, { x: 4, y: 17 }, {}, config);
    expect(observation.legalMoveDirections).not.toContain("SOUTH");
    const decision = await agent.decide(observation);
    expect(decision.action).toEqual(move("EAST"));
  });

  it("sidesteps for an angle when the enemy is in reach but behind cover", async () => {
    // (9,6) and (10,6) are pillars. Standing either side of one puts the
    // enemy in range with no shot, which is a different problem from being
    // out of range and needs a different answer.
    const observation = look({ x: 8, y: 6 }, { x: 10, y: 6 }, {}, config);
    expect(observation.enemyInAttackRange).toBe(true);
    expect(observation.hasLineOfSightToEnemy).toBe(false);
    expect(observation.isBehindCover).toBe(true);
    expect(observation.availableActions).not.toContain("ATTACK");

    const decision = await agent.decide(observation);
    // Perpendicular to the enemy: the movement most likely to clear cover.
    expect(decision.action.type).toBe("MOVE");
    if (decision.action.type === "MOVE") {
      expect(["NORTH", "SOUTH"]).toContain(decision.action.direction);
    }
  });

  it("breaks off to take a power node when it is running dry", async () => {
    const observation = look(
      { x: 9, y: 5 },
      { x: 18, y: 18 },
      { energy: 5 },
      config,
    );
    const decision = await agent.decide(observation);
    // The nearest node is (9,2), directly north.
    expect(decision.action).toEqual(move("NORTH"));
  });

  it("holds a node it is already standing on rather than stepping off", async () => {
    const observation = look(
      { x: 9, y: 2 },
      { x: 18, y: 18 },
      { energy: 5 },
      config,
    );
    expect(observation.standingOnEnergyNode).toBe(true);
    const decision = await agent.decide(observation);
    expect(decision.action).not.toEqual(move("NORTH"));
  });
});

describe("strategy profiles", () => {
  const open: GameConfig = {
    ...config,
    arena: { ...config.arena, obstacles: [] },
  };

  const see = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    self: Partial<{ hp: number; energy: number }> = {},
  ) => {
    const base = createInitialState({
      ...open,
      startingPositions: { A: a, B: b },
    });
    const state = {
      ...base,
      players: { ...base.players, A: { ...base.players.A, ...self } },
    };
    return buildObservation(state, "A", open);
  };

  it("names itself after its profile", () => {
    expect(new HeuristicAgent({ profile: "aggressive" }).name).toBe(
      "Local (Aggressive)",
    );
  });

  it("makes an aggressive agent keep fighting where a defensive one runs", async () => {
    // Same wound, same position, opposite conclusions. This is the whole
    // point of profiles: two identical policies always draw.
    const wounded = see({ x: 5, y: 5 }, { x: 6, y: 5 }, { hp: 35 });

    const aggressive = await new HeuristicAgent({
      profile: "aggressive",
    }).decide(wounded);
    const defensive = await new HeuristicAgent({ profile: "defensive" }).decide(
      wounded,
    );

    expect(aggressive.action.type).toBe("ATTACK");
    expect(defensive.action.type).toBe("DODGE");
  });

  it("makes a defensive agent look for energy an aggressive one ignores", async () => {
    const lowEnergy = see({ x: 9, y: 5 }, { x: 18, y: 18 }, { energy: 30 });

    const aggressive = await new HeuristicAgent({
      profile: "aggressive",
    }).decide(lowEnergy);
    const defensive = await new HeuristicAgent({ profile: "defensive" }).decide(
      lowEnergy,
    );

    // 30% energy is above the aggressive threshold and below the defensive
    // one, so they head in opposite directions from the same state.
    expect(aggressive.action).toEqual(move("SOUTH"));
    expect(defensive.action).toEqual(move("NORTH"));
  });

  it("keeps every profile deterministic", async () => {
    for (const id of [
      "neutral",
      "aggressive",
      "defensive",
      "tactical",
    ] as const) {
      const agent = new HeuristicAgent({ profile: id });
      const observation = see({ x: 5, y: 5 }, { x: 9, y: 9 });
      const first = await agent.decide(observation);
      for (let i = 0; i < 5; i += 1) {
        expect((await agent.decide(observation)).action).toEqual(first.action);
      }
    }
  });
});

describe("HeuristicAgent, continued", () => {
  const agent = new HeuristicAgent();
  const open: GameConfig = {
    ...config,
    arena: { ...config.arena, obstacles: [] },
  };
  const look = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    self: Partial<{ hp: number; energy: number }> = {},
    cfg: GameConfig = open,
  ) => {
    const base = createInitialState({
      ...cfg,
      startingPositions: { A: a, B: b },
    });
    const state = {
      ...base,
      players: { ...base.players, A: { ...base.players.A, ...self } },
    };
    return buildObservation(state, "A", cfg);
  };

  it("dodges away when badly hurt and threatened", async () => {
    const decision = await agent.decide(
      look({ x: 5, y: 5 }, { x: 6, y: 5 }, { hp: 10 }),
    );
    expect(decision.action).toEqual(dodge("WEST"));
  });

  it("stops attacking once it cannot pay for an attack", async () => {
    const observation = look({ x: 5, y: 5 }, { x: 6, y: 5 }, { energy: 0 });
    expect(observation.availableActions).not.toContain("ATTACK");
    const decision = await agent.decide(observation);
    expect(decision.action.type).toBe("MOVE");
  });

  it("braces when nothing at all is available", async () => {
    const observation = {
      ...look({ x: 5, y: 5 }, { x: 6, y: 5 }),
      availableActions: ["DEFEND"] as const,
      legalMoveDirections: [],
      legalDodgeDirections: [],
    };
    const decision = await agent.decide(observation);
    expect(decision.action).toEqual(defend());
  });

  it("is deterministic and stateless: the same observation always decides the same", async () => {
    const observation = observationFor();
    const first = await agent.decide(observation);
    for (let i = 0; i < 10; i += 1) {
      expect((await agent.decide(observation)).action).toEqual(first.action);
    }
  });

  it("only ever picks a direction it was told is legal", async () => {
    const observation = look({ x: 0, y: 0 }, { x: 19, y: 19 }, {}, config);
    const decision = await agent.decide(observation);
    if (decision.action.type === "MOVE") {
      expect(observation.legalMoveDirections).toContain(
        decision.action.direction,
      );
    }
  });
});
