import {
  attack,
  defend,
  move,
  opponentOf,
  type Action,
  type GameState,
  type PlayerId,
} from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { manhattanDistance } from "@jev-arena/types";
import { runMatch, type ActionSelector } from "../src/simulation";
import { OPEN_ARENA } from "./helpers";

/** Walks toward the opponent, then attacks whenever it can. */
const chase: ActionSelector = (state: GameState) => {
  const pick = (id: PlayerId): Action => {
    const self = state.players[id];
    const enemy = state.players[opponentOf(id)];
    const distance = manhattanDistance(self.position, enemy.position);
    if (
      distance <= OPEN_ARENA.combat.attackRange &&
      self.energy >= OPEN_ARENA.combat.attackEnergyCost
    ) {
      return attack(opponentOf(id));
    }
    if (self.energy < OPEN_ARENA.combat.attackEnergyCost) return defend();
    if (enemy.position.x > self.position.x) return move("EAST");
    if (enemy.position.x < self.position.x) return move("WEST");
    if (enemy.position.y > self.position.y) return move("SOUTH");
    if (enemy.position.y < self.position.y) return move("NORTH");
    return defend();
  };
  return { A: pick("A"), B: pick("B") };
};

const alwaysDefend: ActionSelector = () => ({ A: defend(), B: defend() });

describe("runMatch (spec commit 3: a complete match runs in memory)", () => {
  it("plays a full match to a finish with no I/O", () => {
    const outcome = runMatch(chase, OPEN_ARENA);
    expect(outcome.finalState.status).toBe("finished");
    expect(outcome.turns.length).toBeGreaterThan(0);
    expect(outcome.turnCount).toBe(outcome.turns.length);
  });

  it("produces a strictly increasing, gapless turn sequence", () => {
    const outcome = runMatch(chase, OPEN_ARENA);
    outcome.turns.forEach((resolution, index) => {
      expect(resolution.previous.turn).toBe(index + 1);
      expect(resolution.previous.version).toBe(index);
      expect(resolution.next.version).toBe(index + 1);
    });
  });

  it("chains every turn: each resolution starts where the last one ended", () => {
    const outcome = runMatch(chase, OPEN_ARENA);
    let cursor = outcome.initialState;
    for (const resolution of outcome.turns) {
      expect(resolution.previous).toBe(cursor);
      cursor = resolution.next;
    }
    expect(cursor).toBe(outcome.finalState);
  });

  it("is fully deterministic: the same selector replays identically", () => {
    const first = runMatch(chase, OPEN_ARENA);
    const second = runMatch(chase, OPEN_ARENA);
    expect(second.finalState).toEqual(first.finalState);
    expect(second.turnCount).toBe(first.turnCount);
    expect(second.winner).toBe(first.winner);
  });

  it("ends a passive match at the turn limit, as a draw", () => {
    const outcome = runMatch(alwaysDefend, OPEN_ARENA);
    expect(outcome.turnCount).toBe(OPEN_ARENA.maxTurns);
    expect(outcome.finalState.status).toBe("finished");
    expect(outcome.winner).toBeNull();
  });

  it("agrees with the final state about who won", () => {
    const outcome = runMatch(chase, OPEN_ARENA);
    expect(outcome.winner).toBe(outcome.finalState.winner ?? null);
  });

  it("never exceeds the configured turn limit", () => {
    const outcome = runMatch(chase, OPEN_ARENA);
    expect(outcome.turnCount).toBeLessThanOrEqual(OPEN_ARENA.maxTurns);
  });
});
