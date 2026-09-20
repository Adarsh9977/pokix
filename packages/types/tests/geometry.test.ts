import { describe, expect, it } from "vitest";
import {
  DIRECTIONS,
  DIRECTION_VECTORS,
  chebyshevDistance,
  manhattanDistance,
  positionsEqual,
  translate,
} from "../src/geometry";
import type { Direction } from "../src/geometry";

describe("directions", () => {
  it("exposes exactly the four cardinal directions", () => {
    expect([...DIRECTIONS]).toEqual(["NORTH", "SOUTH", "EAST", "WEST"]);
  });

  it("uses screen coordinates: north decreases y", () => {
    // The spec's movement test: (5,5) + MOVE_NORTH => (5,4).
    expect(DIRECTION_VECTORS.NORTH).toEqual({ dx: 0, dy: -1 });
    expect(DIRECTION_VECTORS.SOUTH).toEqual({ dx: 0, dy: 1 });
    expect(DIRECTION_VECTORS.EAST).toEqual({ dx: 1, dy: 0 });
    expect(DIRECTION_VECTORS.WEST).toEqual({ dx: -1, dy: 0 });
  });

  it("gives every direction a unit-length step", () => {
    for (const direction of DIRECTIONS) {
      const { dx, dy } = DIRECTION_VECTORS[direction];
      expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
    }
  });

  it("pairs every direction with an exact opposite", () => {
    const opposites: Record<Direction, Direction> = {
      NORTH: "SOUTH",
      SOUTH: "NORTH",
      EAST: "WEST",
      WEST: "EAST",
    };
    for (const direction of DIRECTIONS) {
      const a = DIRECTION_VECTORS[direction];
      const b = DIRECTION_VECTORS[opposites[direction]];
      expect({ dx: a.dx + b.dx, dy: a.dy + b.dy }).toEqual({ dx: 0, dy: 0 });
    }
  });
});

describe("translate", () => {
  it("moves one tile in the requested direction", () => {
    expect(translate({ x: 5, y: 5 }, "NORTH")).toEqual({ x: 5, y: 4 });
    expect(translate({ x: 5, y: 5 }, "SOUTH")).toEqual({ x: 5, y: 6 });
    expect(translate({ x: 5, y: 5 }, "EAST")).toEqual({ x: 6, y: 5 });
    expect(translate({ x: 5, y: 5 }, "WEST")).toEqual({ x: 4, y: 5 });
  });

  it("returns a new object and never mutates its input", () => {
    const origin = { x: 3, y: 7 };
    const moved = translate(origin, "EAST");
    expect(origin).toEqual({ x: 3, y: 7 });
    expect(moved).not.toBe(origin);
  });
});

describe("distances", () => {
  it("measures manhattan distance along the movement grid", () => {
    expect(manhattanDistance({ x: 4, y: 5 }, { x: 5, y: 5 })).toBe(1);
    expect(manhattanDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });

  it("measures chebyshev distance including diagonals", () => {
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(4);
  });

  it("is zero between a position and itself", () => {
    expect(manhattanDistance({ x: 9, y: 9 }, { x: 9, y: 9 })).toBe(0);
    expect(chebyshevDistance({ x: 9, y: 9 }, { x: 9, y: 9 })).toBe(0);
  });

  it("is symmetric", () => {
    const a = { x: 1, y: 12 };
    const b = { x: 17, y: 3 };
    expect(manhattanDistance(a, b)).toBe(manhattanDistance(b, a));
    expect(chebyshevDistance(a, b)).toBe(chebyshevDistance(b, a));
  });
});

describe("positionsEqual", () => {
  it("compares by value, not identity", () => {
    expect(positionsEqual({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(true);
    expect(positionsEqual({ x: 2, y: 2 }, { x: 2, y: 3 })).toBe(false);
  });
});
