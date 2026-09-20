import { DEFAULT_GAME_CONFIG, defend, dodge, move } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { resolveTurn } from "../src/resolver";
import { facingOff, OPEN_ARENA, stateWith } from "./helpers";

describe("basic movement (spec 14: movement)", () => {
  it("given a player at (5,5), when MOVE NORTH, the player becomes (5,4)", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 15, y: 15 });
    const { next } = resolveTurn(
      state,
      { A: move("NORTH"), B: defend() },
      OPEN_ARENA,
    );
    expect(next.players.A.position).toEqual({ x: 5, y: 4 });
  });

  it("moves one tile in each of the four directions", () => {
    const cases = [
      ["NORTH", { x: 5, y: 4 }],
      ["SOUTH", { x: 5, y: 6 }],
      ["EAST", { x: 6, y: 5 }],
      ["WEST", { x: 4, y: 5 }],
    ] as const;

    for (const [direction, expected] of cases) {
      const state = facingOff({ x: 5, y: 5 }, { x: 15, y: 15 });
      const { next } = resolveTurn(
        state,
        { A: move(direction), B: defend() },
        OPEN_ARENA,
      );
      expect(next.players.A.position).toEqual(expected);
    }
  });

  it("never spends energy to move", () => {
    const state = stateWith({
      players: { A: { position: { x: 5, y: 5 }, energy: 50 }, B: {} },
    });
    const { players } = resolveTurn(
      state,
      { A: move("NORTH"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.A.energySpent).toBe(0);
  });
});

describe("arena boundaries (spec 14: arena boundaries)", () => {
  it("given a player at (0,0), when MOVE WEST, the position remains (0,0)", () => {
    const state = facingOff({ x: 0, y: 0 }, { x: 15, y: 15 });
    const { next, players } = resolveTurn(
      state,
      { A: move("WEST"), B: defend() },
      OPEN_ARENA,
    );
    expect(next.players.A.position).toEqual({ x: 0, y: 0 });
    expect(players.A.rejection?.reason).toBe("OUT_OF_BOUNDS");
    expect(players.A.applied).toEqual(defend());
  });

  it("keeps a player inside every edge of the arena", () => {
    const { width, height } = OPEN_ARENA.arena;
    const cases = [
      [{ x: 0, y: 5 }, "WEST"],
      [{ x: width - 1, y: 5 }, "EAST"],
      [{ x: 5, y: 0 }, "NORTH"],
      [{ x: 5, y: height - 1 }, "SOUTH"],
    ] as const;

    for (const [position, direction] of cases) {
      const state = facingOff(position, { x: 10, y: 18 });
      const { next } = resolveTurn(
        state,
        { A: move(direction), B: defend() },
        OPEN_ARENA,
      );
      expect(next.players.A.position).toEqual(position);
    }
  });

  it("cannot walk into an obstacle", () => {
    const obstacle = DEFAULT_GAME_CONFIG.arena.obstacles[0]!;
    const start = { x: obstacle.x, y: obstacle.y + 1 };
    const state = facingOff(start, { x: 1, y: 1 }, DEFAULT_GAME_CONFIG);
    const { next, players } = resolveTurn(
      state,
      { A: move("NORTH"), B: defend() },
      DEFAULT_GAME_CONFIG,
    );
    expect(next.players.A.position).toEqual(start);
    expect(players.A.rejection?.reason).toBe("BLOCKED_TILE");
  });
});

describe("movement conflicts resolve symmetrically", () => {
  it("neither player moves when both target the same tile", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 7, y: 5 });
    const { next, players } = resolveTurn(
      state,
      { A: move("EAST"), B: move("WEST") },
      OPEN_ARENA,
    );
    expect(next.players.A.position).toEqual({ x: 5, y: 5 });
    expect(next.players.B.position).toEqual({ x: 7, y: 5 });
    expect(players.A.movementBlocked).toBe(true);
    expect(players.B.movementBlocked).toBe(true);
  });

  it("neither player moves when they try to swap tiles", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { next } = resolveTurn(
      state,
      { A: move("EAST"), B: move("WEST") },
      OPEN_ARENA,
    );
    expect(next.players.A.position).toEqual({ x: 5, y: 5 });
    expect(next.players.B.position).toEqual({ x: 6, y: 5 });
  });

  it("blocks a player walking into a tile the opponent is holding", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { next, players } = resolveTurn(
      state,
      { A: move("EAST"), B: defend() },
      OPEN_ARENA,
    );
    expect(next.players.A.position).toEqual({ x: 5, y: 5 });
    expect(players.A.movementBlocked).toBe(true);
    expect(players.A.rejection).toBeUndefined();
  });

  it("allows a player into a tile the opponent is vacating", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { next } = resolveTurn(
      state,
      { A: move("EAST"), B: move("EAST") },
      OPEN_ARENA,
    );
    expect(next.players.A.position).toEqual({ x: 6, y: 5 });
    expect(next.players.B.position).toEqual({ x: 7, y: 5 });
  });

  it("moves a dodging player just like a moving one", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 15, y: 15 });
    const { next } = resolveTurn(
      state,
      { A: dodge("SOUTH"), B: defend() },
      OPEN_ARENA,
    );
    expect(next.players.A.position).toEqual({ x: 5, y: 6 });
  });
});
