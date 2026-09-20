/**
 * Grid geometry.
 *
 * The arena uses screen coordinates: `x` grows east, `y` grows south. NORTH
 * therefore decreases `y`, which is what the spec's movement test expects
 * ((5,5) + MOVE_NORTH => (5,4)).
 */

export interface Position {
  readonly x: number;
  readonly y: number;
}

export const DIRECTIONS = ["NORTH", "SOUTH", "EAST", "WEST"] as const;

export type Direction = (typeof DIRECTIONS)[number];

export interface Vector {
  readonly dx: number;
  readonly dy: number;
}

export const DIRECTION_VECTORS: Readonly<Record<Direction, Vector>> =
  Object.freeze({
    NORTH: Object.freeze({ dx: 0, dy: -1 }),
    SOUTH: Object.freeze({ dx: 0, dy: 1 }),
    EAST: Object.freeze({ dx: 1, dy: 0 }),
    WEST: Object.freeze({ dx: -1, dy: 0 }),
  });

export function isDirection(value: unknown): value is Direction {
  return (
    typeof value === "string" &&
    (DIRECTIONS as readonly string[]).includes(value)
  );
}

/** Returns a new position one tile away. Never mutates the input. */
export function translate(position: Position, direction: Direction): Position {
  const { dx, dy } = DIRECTION_VECTORS[direction];
  return { x: position.x + dx, y: position.y + dy };
}

/**
 * Distance along the movement grid. Movement is four-directional, so this is
 * the metric the game uses for attack range.
 */
export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Distance including diagonals. Kept for line-of-sight work later. */
export function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Stable string key for a position, for set/map lookups. */
export function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}
