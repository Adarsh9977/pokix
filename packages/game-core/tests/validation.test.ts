import {
  DEFAULT_GAME_CONFIG,
  attack,
  defend,
  dodge,
  move,
} from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { validateAction } from "../src/actions";
import { facingOff, OPEN_ARENA, stateWith } from "./helpers";

function rejectionOf(...args: Parameters<typeof validateAction>) {
  const result = validateAction(...args);
  if (result.valid) throw new Error("expected the action to be rejected");
  return result.rejection;
}

describe("MOVE validation", () => {
  it("accepts a move into an empty in-bounds tile", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 15, y: 15 });
    expect(validateAction(state, "A", move("NORTH"), OPEN_ARENA).valid).toBe(
      true,
    );
  });

  it("rejects a move that would leave the arena", () => {
    const state = facingOff({ x: 0, y: 0 }, { x: 15, y: 15 });
    expect(rejectionOf(state, "A", move("WEST"), OPEN_ARENA).reason).toBe(
      "OUT_OF_BOUNDS",
    );
    expect(rejectionOf(state, "A", move("NORTH"), OPEN_ARENA).reason).toBe(
      "OUT_OF_BOUNDS",
    );
  });

  it("rejects a move into an obstacle", () => {
    const obstacle = DEFAULT_GAME_CONFIG.arena.obstacles[0]!;
    const state = facingOff(
      { x: obstacle.x, y: obstacle.y + 1 },
      { x: 1, y: 1 },
      DEFAULT_GAME_CONFIG,
    );
    expect(
      rejectionOf(state, "A", move("NORTH"), DEFAULT_GAME_CONFIG).reason,
    ).toBe("BLOCKED_TILE");
  });

  it("allows a move toward the opponent's current tile: they may vacate it", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    expect(validateAction(state, "A", move("EAST"), OPEN_ARENA).valid).toBe(
      true,
    );
  });
});

describe("ATTACK validation", () => {
  it("accepts an attack at exactly maximum range", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 7, y: 5 });
    expect(validateAction(state, "A", attack("B"), OPEN_ARENA).valid).toBe(
      true,
    );
  });

  it("rejects an attack beyond range", () => {
    const state = facingOff({ x: 2, y: 2 }, { x: 17, y: 17 });
    expect(rejectionOf(state, "A", attack("B"), OPEN_ARENA).reason).toBe(
      "OUT_OF_RANGE",
    );
  });

  it("rejects an attack the player cannot pay for", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, energy: 0 },
        B: { position: { x: 6, y: 5 } },
      },
    });
    expect(rejectionOf(state, "A", attack("B"), OPEN_ARENA).reason).toBe(
      "INSUFFICIENT_ENERGY",
    );
  });

  it("rejects attacking yourself", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    expect(rejectionOf(state, "A", attack("A"), OPEN_ARENA).reason).toBe(
      "SELF_TARGET",
    );
  });
});

describe("DEFEND validation", () => {
  it("is always available: it is the safe fallback", () => {
    const state = stateWith({
      players: { A: { energy: 0, hp: 1 }, B: {} },
    });
    expect(validateAction(state, "A", defend(), OPEN_ARENA).valid).toBe(true);
  });
});

describe("DODGE validation", () => {
  it("accepts a dodge into an empty in-bounds tile", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    expect(validateAction(state, "A", dodge("NORTH"), OPEN_ARENA).valid).toBe(
      true,
    );
  });

  it("rejects a dodge into a wall", () => {
    const state = facingOff({ x: 0, y: 5 }, { x: 6, y: 5 });
    expect(rejectionOf(state, "A", dodge("WEST"), OPEN_ARENA).reason).toBe(
      "OUT_OF_BOUNDS",
    );
  });

  it("rejects a dodge the player cannot pay for", () => {
    const state = stateWith({
      players: { A: { position: { x: 5, y: 5 }, energy: 1 }, B: {} },
    });
    expect(rejectionOf(state, "A", dodge("NORTH"), OPEN_ARENA).reason).toBe(
      "INSUFFICIENT_ENERGY",
    );
  });
});

describe("rejection reporting", () => {
  it("never returns a generic message", () => {
    const state = facingOff({ x: 2, y: 2 }, { x: 17, y: 17 });
    const rejection = rejectionOf(state, "A", attack("B"), OPEN_ARENA);
    expect(rejection.message).toMatch(/range/i);
    expect(rejection.message).not.toMatch(/something went wrong/i);
    expect(rejection.message.length).toBeGreaterThan(10);
  });

  it("rejects any action once the match has finished", () => {
    const running = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const finished = { ...running, status: "finished" as const };
    expect(rejectionOf(finished, "A", defend(), OPEN_ARENA).reason).toBe(
      "MATCH_FINISHED",
    );
  });
});
