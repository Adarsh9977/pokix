import {
  DEFAULT_GAME_CONFIG,
  attack,
  defend,
  dodge,
  type AgentDecision,
  type AgentObservation,
  type GameConfig,
} from "@jev-arena/types";
import { createInitialState } from "@jev-arena/game-core";
import { describe, expect, it } from "vitest";
import type { Agent } from "../src/agent";
import { runAgentMatch } from "../src/orchestrator";
import { HeuristicAgent, MockAgent } from "../src/mock-agents";

const adjacent: GameConfig = {
  ...DEFAULT_GAME_CONFIG,
  arena: { ...DEFAULT_GAME_CONFIG.arena, obstacles: [] },
  startingPositions: { A: { x: 5, y: 5 }, B: { x: 7, y: 5 } },
};

/** Records every observation it is handed, then answers with a fixed action. */
class RecordingAgent implements Agent {
  readonly name = "Recorder";
  readonly seen: AgentObservation[] = [];

  constructor(private readonly inner: Agent) {}

  async decide(observation: AgentObservation): Promise<AgentDecision> {
    this.seen.push(observation);
    return this.inner.decide(observation);
  }
}

/**
 * Refuses to answer until its partner has also been asked.
 *
 * If the loop ever asked A and awaited it before asking B, this deadlocks.
 * That is the point: the test would time out instead of quietly passing.
 */
function barrierPair(
  inner: Record<"A" | "B", Agent>,
): Record<"A" | "B", Agent> {
  let arrived = 0;
  let release: () => void;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  const wrap = (agent: Agent): Agent => ({
    name: `Barrier(${agent.name})`,
    async decide(observation) {
      arrived += 1;
      if (arrived === 2) release();
      await bothArrived;
      return agent.decide(observation);
    },
  });

  return { A: wrap(inner.A), B: wrap(inner.B) };
}

describe("MockAgent vs MockAgent (spec 15)", () => {
  it("resolves A attacking into B dodging", async () => {
    const result = await runAgentMatch(
      { A: new MockAgent(attack("B")), B: new MockAgent(dodge("EAST")) },
      { config: adjacent },
    );

    const first = result.turns[0]!;
    expect(first.decisions.A.action).toEqual(attack("B"));
    expect(first.decisions.B.action).toEqual(dodge("EAST"));
    // B dodged from distance 2 to distance 3, out of range 2.
    expect(first.resolution.players.A.attackOutcome).toBe("EVADED");
  });

  it("plays a complete match between two mock agents", async () => {
    const result = await runAgentMatch(
      { A: new MockAgent(defend()), B: new MockAgent(defend()) },
      { config: adjacent },
    );
    expect(result.finalState.status).toBe("finished");
    expect(result.turnCount).toBe(adjacent.maxTurns);
    expect(result.winner).toBeNull();
  });

  it("plays a complete match between two heuristic agents, with a result", async () => {
    const result = await runAgentMatch(
      { A: new HeuristicAgent(), B: new HeuristicAgent() },
      { config: DEFAULT_GAME_CONFIG },
    );
    expect(result.finalState.status).toBe("finished");
    expect(result.turnCount).toBeGreaterThan(1);
  });
});

describe("both agents decide from the same snapshot", () => {
  it("hands both agents the same turn and state version", async () => {
    const a = new RecordingAgent(new HeuristicAgent());
    const b = new RecordingAgent(new HeuristicAgent());
    const result = await runAgentMatch({ A: a, B: b }, { config: adjacent });

    expect(a.seen.length).toBe(result.turnCount);
    expect(b.seen.length).toBe(result.turnCount);
    a.seen.forEach((observation, index) => {
      const other = b.seen[index]!;
      expect(observation.turn).toBe(other.turn);
      expect(observation.stateVersion).toBe(other.stateVersion);
    });
  });

  it("shows each agent the opposite side of the same world", async () => {
    const a = new RecordingAgent(new MockAgent(defend()));
    const b = new RecordingAgent(new MockAgent(defend()));
    await runAgentMatch({ A: a, B: b }, { config: adjacent });

    const first = a.seen[0]!;
    const mirror = b.seen[0]!;
    expect(first.self.position).toEqual(mirror.enemy.position);
    expect(first.enemy.position).toEqual(mirror.self.position);
  });

  it("asks both agents concurrently, not one after the other", async () => {
    // barrierPair deadlocks if the loop awaits A before asking B.
    const agents = barrierPair({
      A: new MockAgent(defend()),
      B: new MockAgent(defend()),
    });
    const state = createInitialState(adjacent);
    const result = await runAgentMatch(agents, {
      config: { ...adjacent, maxTurns: 1 },
      initialState: state,
    });
    expect(result.turnCount).toBe(1);
  }, 1000);
});

describe("match bookkeeping", () => {
  it("records an observation, a decision and a resolution for every turn", async () => {
    const result = await runAgentMatch(
      { A: new HeuristicAgent(), B: new HeuristicAgent() },
      { config: adjacent },
    );
    for (const record of result.turns) {
      expect(record.observations.A.turn).toBe(record.turn);
      expect(record.observations.B.stateVersion).toBe(record.stateVersion);
      expect(record.resolution.previous.turn).toBe(record.turn);
      expect(record.resolution.players.A.submitted).toEqual(
        record.decisions.A.action,
      );
    }
  });

  it("notifies onTurn once per resolved turn, in order", async () => {
    const seen: number[] = [];
    const result = await runAgentMatch(
      { A: new HeuristicAgent(), B: new HeuristicAgent() },
      { config: adjacent, onTurn: (record) => seen.push(record.turn) },
    );
    expect(seen).toEqual(
      Array.from({ length: result.turnCount }, (_, i) => i + 1),
    );
  });

  it("has no first-mover advantage: identical agents in a mirrored arena draw", async () => {
    // The strongest available evidence that the game is neutral. A and B are
    // the same policy, start mirror-symmetrically, and act simultaneously,
    // so any asymmetry in the engine or the loop would show up as a winner.
    const result = await runAgentMatch(
      { A: new HeuristicAgent(), B: new HeuristicAgent() },
      { config: DEFAULT_GAME_CONFIG },
    );
    expect(result.winner).toBeNull();
    expect(result.finalState.players.A.hp).toBe(result.finalState.players.B.hp);
    expect(result.finalState.players.A.energy).toBe(
      result.finalState.players.B.energy,
    );
  });

  it("is reproducible: deterministic agents replay the same match", async () => {
    const play = () =>
      runAgentMatch(
        { A: new HeuristicAgent(), B: new HeuristicAgent() },
        { config: DEFAULT_GAME_CONFIG },
      );
    const first = await play();
    const second = await play();
    expect(second.finalState).toEqual(first.finalState);
    expect(second.turnCount).toBe(first.turnCount);
  });
});
