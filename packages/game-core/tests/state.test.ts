import { DEFAULT_GAME_CONFIG, PLAYER_IDS } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { createInitialState, isObstacle, isPassable } from "../src/state";

const config = DEFAULT_GAME_CONFIG;

describe("createInitialState", () => {
  const state = createInitialState(config);

  it("starts at turn 1, version 0, running, with no winner", () => {
    expect(state.turn).toBe(1);
    expect(state.version).toBe(0);
    expect(state.status).toBe("running");
    expect(state.winner).toBeUndefined();
  });

  it("gives both players full resources at their configured start tiles", () => {
    for (const id of PLAYER_IDS) {
      const player = state.players[id];
      expect(player.id).toBe(id);
      expect(player.hp).toBe(config.player.startingHp);
      expect(player.energy).toBe(config.player.startingEnergy);
      expect(player.position).toEqual(config.startingPositions[id]);
      expect(player.cooldowns).toEqual({});
    }
  });

  it("copies the arena into the environment", () => {
    expect(state.environment.width).toBe(config.arena.width);
    expect(state.environment.height).toBe(config.arena.height);
    expect(state.environment.obstacles).toEqual(config.arena.obstacles);
  });

  it("is deeply frozen, so the authoritative snapshot cannot be edited", () => {
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.players)).toBe(true);
    expect(Object.isFrozen(state.players.A)).toBe(true);
    expect(Object.isFrozen(state.players.A.position)).toBe(true);
    expect(Object.isFrozen(state.environment)).toBe(true);
  });

  it("is pure: two calls produce identical states", () => {
    expect(createInitialState(config)).toEqual(createInitialState(config));
  });
});

describe("tile queries", () => {
  const state = createInitialState(config);
  const first = config.arena.obstacles[0]!;

  it("identifies obstacle tiles", () => {
    expect(isObstacle(first, state.environment)).toBe(true);
    expect(isObstacle({ x: 0, y: 0 }, state.environment)).toBe(false);
  });

  it("treats obstacles and out-of-bounds tiles as impassable", () => {
    expect(isPassable(first, state.environment)).toBe(false);
    expect(isPassable({ x: -1, y: 0 }, state.environment)).toBe(false);
    expect(isPassable({ x: 0, y: -1 }, state.environment)).toBe(false);
    expect(isPassable({ x: config.arena.width, y: 0 }, state.environment)).toBe(
      false,
    );
    expect(
      isPassable({ x: 0, y: config.arena.height }, state.environment),
    ).toBe(false);
  });

  it("treats every other in-bounds tile as passable", () => {
    expect(isPassable({ x: 0, y: 0 }, state.environment)).toBe(true);
    expect(
      isPassable(
        { x: config.arena.width - 1, y: config.arena.height - 1 },
        state.environment,
      ),
    ).toBe(true);
  });
});
