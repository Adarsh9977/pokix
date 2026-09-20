import { DEFAULT_GAME_CONFIG, PLAYER_IDS } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { buildObservation } from "../src/observations";
import { createInitialState } from "../src/state";
import { facingOff, OPEN_ARENA, stateWith } from "./helpers";

describe("self and enemy state", () => {
  const state = stateWith({
    players: {
      A: { position: { x: 5, y: 5 }, hp: 80, energy: 40 },
      B: { position: { x: 6, y: 5 }, hp: 60, energy: 90 },
    },
  });
  const observation = buildObservation(state, "A", OPEN_ARENA);

  it("reports the observer's own hp, energy and position", () => {
    expect(observation.self).toEqual({
      id: "A",
      hp: 80,
      energy: 40,
      position: { x: 5, y: 5 },
    });
  });

  it("reports the enemy's hp and position but never their energy", () => {
    expect(observation.enemy).toEqual({
      id: "B",
      hp: 60,
      position: { x: 6, y: 5 },
    });
    expect(observation.enemy).not.toHaveProperty("energy");
  });

  it("carries the turn and the state version it was taken from", () => {
    expect(observation.turn).toBe(state.turn);
    expect(observation.stateVersion).toBe(state.version);
  });

  it("precomputes distance so the agent never has to do arithmetic", () => {
    expect(observation.distanceToEnemy).toBe(1);
    expect(observation.attackRange).toBe(OPEN_ARENA.combat.attackRange);
    expect(observation.enemyInAttackRange).toBe(true);
  });

  it("is deeply frozen and detached from the state it was built from", () => {
    expect(Object.isFrozen(observation)).toBe(true);
    expect(observation.self.position).not.toBe(state.players.A.position);
  });
});

describe("available actions", () => {
  it("offers everything when in range, funded and unobstructed", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const observation = buildObservation(state, "A", OPEN_ARENA);
    expect([...observation.availableActions]).toEqual([
      "MOVE",
      "ATTACK",
      "DEFEND",
      "DODGE",
    ]);
  });

  it("withholds ATTACK when the enemy is out of range", () => {
    const state = facingOff({ x: 2, y: 2 }, { x: 17, y: 17 });
    const observation = buildObservation(state, "A", OPEN_ARENA);
    expect(observation.availableActions).not.toContain("ATTACK");
    expect(observation.enemyInAttackRange).toBe(false);
  });

  it("withholds ATTACK and DODGE when energy is exhausted", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, energy: 0 },
        B: { position: { x: 6, y: 5 } },
      },
    });
    const observation = buildObservation(state, "A", OPEN_ARENA);
    expect(observation.availableActions).not.toContain("ATTACK");
    expect(observation.availableActions).not.toContain("DODGE");
    expect(observation.availableActions).toContain("MOVE");
  });

  it("always offers DEFEND, even to a cornered, broke, dying player", () => {
    const state = stateWith({
      players: { A: { position: { x: 0, y: 0 }, energy: 0, hp: 1 }, B: {} },
    });
    const observation = buildObservation(state, "A", OPEN_ARENA);
    expect(observation.availableActions).toContain("DEFEND");
  });

  it("only offers legal directions, and never offers a direction into a wall", () => {
    const state = facingOff({ x: 0, y: 0 }, { x: 15, y: 15 });
    const observation = buildObservation(state, "A", OPEN_ARENA);
    expect([...observation.legalMoveDirections]).toEqual(["SOUTH", "EAST"]);
    expect([...observation.legalDodgeDirections]).toEqual(["SOUTH", "EAST"]);
  });

  it("never offers a direction into an obstacle", () => {
    const obstacle = DEFAULT_GAME_CONFIG.arena.obstacles[0]!;
    const state = facingOff(
      { x: obstacle.x, y: obstacle.y + 1 },
      { x: 1, y: 1 },
      DEFAULT_GAME_CONFIG,
    );
    const observation = buildObservation(state, "A", DEFAULT_GAME_CONFIG);
    expect(observation.legalMoveDirections).not.toContain("NORTH");
  });

  it("offers no DODGE directions when the player cannot pay for one", () => {
    const state = stateWith({
      players: { A: { position: { x: 5, y: 5 }, energy: 1 }, B: {} },
    });
    const observation = buildObservation(state, "A", OPEN_ARENA);
    expect(observation.legalDodgeDirections).toEqual([]);
    expect(observation.legalMoveDirections.length).toBe(4);
  });
});

describe("fairness", () => {
  const state = createInitialState(DEFAULT_GAME_CONFIG);

  it("gives both agents structurally identical information", () => {
    const a = buildObservation(state, "A", DEFAULT_GAME_CONFIG);
    const b = buildObservation(state, "B", DEFAULT_GAME_CONFIG);
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect(a.availableActions).toEqual(b.availableActions);
    expect(a.distanceToEnemy).toBe(b.distanceToEnemy);
  });

  it("points each agent at the other", () => {
    for (const id of PLAYER_IDS) {
      const observation = buildObservation(state, id, DEFAULT_GAME_CONFIG);
      expect(observation.self.id).toBe(id);
      expect(observation.enemy.id).not.toBe(id);
    }
  });

  it("is pure: the same state always yields the same observation", () => {
    expect(buildObservation(state, "A", DEFAULT_GAME_CONFIG)).toEqual(
      buildObservation(state, "A", DEFAULT_GAME_CONFIG),
    );
  });
});
