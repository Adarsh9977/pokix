/**
 * Authoritative state construction and tile queries.
 *
 * Every state this module hands out is deeply frozen. Immutability is a
 * structural property here, not a convention: an accidental mutation throws in
 * strict mode instead of silently corrupting the match.
 */

import {
  PLAYER_IDS,
  positionsEqual,
  type EnvironmentState,
  type GameConfig,
  type GameState,
  type PlayerId,
  type PlayerState,
  type Position,
} from "@jev-arena/types";

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export function createInitialState(config: GameConfig): GameState {
  const players = {} as Record<PlayerId, PlayerState>;

  for (const id of PLAYER_IDS) {
    players[id] = {
      id,
      hp: config.player.startingHp,
      energy: config.player.startingEnergy,
      position: { ...config.startingPositions[id] },
      cooldowns: {},
    };
  }

  const environment: EnvironmentState = {
    width: config.arena.width,
    height: config.arena.height,
    obstacles: config.arena.obstacles.map((tile) => ({ ...tile })),
  };

  return deepFreeze({
    turn: 1,
    version: 0,
    status: "running",
    players,
    environment,
  } satisfies GameState);
}

export function isInsideArena(
  position: Position,
  environment: EnvironmentState,
): boolean {
  return (
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    position.x >= 0 &&
    position.y >= 0 &&
    position.x < environment.width &&
    position.y < environment.height
  );
}

export function isObstacle(
  position: Position,
  environment: EnvironmentState,
): boolean {
  return environment.obstacles.some((tile) => positionsEqual(tile, position));
}

/** In-bounds and not an obstacle. Says nothing about player occupancy. */
export function isPassable(
  position: Position,
  environment: EnvironmentState,
): boolean {
  return (
    isInsideArena(position, environment) && !isObstacle(position, environment)
  );
}

export function playerAt(
  state: GameState,
  position: Position,
): PlayerState | undefined {
  for (const id of PLAYER_IDS) {
    const player = state.players[id];
    if (positionsEqual(player.position, position)) return player;
  }
  return undefined;
}
