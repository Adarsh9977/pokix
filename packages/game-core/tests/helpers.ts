import {
  DEFAULT_GAME_CONFIG,
  PLAYER_IDS,
  type GameConfig,
  type GameState,
  type PlayerId,
  type PlayerState,
  type Position,
} from "@jev-arena/types";
import { createInitialState } from "../src/state";

export interface PlayerOverride {
  hp?: number;
  energy?: number;
  position?: Position;
  charge?: number;
  cooldowns?: Record<string, number>;
}

export interface StateOverride {
  turn?: number;
  version?: number;
  players?: Partial<Record<PlayerId, PlayerOverride>>;
}

/** A 20x20 arena with no obstacles, for tests that only care about combat. */
export const OPEN_ARENA: GameConfig = {
  ...DEFAULT_GAME_CONFIG,
  arena: { ...DEFAULT_GAME_CONFIG.arena, obstacles: [] },
};

export function withCombat(
  overrides: Partial<GameConfig["combat"]>,
  base: GameConfig = OPEN_ARENA,
): GameConfig {
  return { ...base, combat: { ...base.combat, ...overrides } };
}

/** Builds a running state, starting from the configured initial state. */
export function stateWith(
  overrides: StateOverride = {},
  config: GameConfig = OPEN_ARENA,
): GameState {
  const base = createInitialState(config);
  const players = {} as Record<PlayerId, PlayerState>;

  for (const id of PLAYER_IDS) {
    const player = base.players[id];
    const override = overrides.players?.[id] ?? {};
    players[id] = {
      id,
      hp: override.hp ?? player.hp,
      energy: override.energy ?? player.energy,
      position: override.position ?? player.position,
      charge: override.charge ?? player.charge,
      cooldowns: override.cooldowns ?? player.cooldowns,
    };
  }

  return {
    ...base,
    turn: overrides.turn ?? base.turn,
    version: overrides.version ?? base.version,
    players,
  };
}

/** Places the two players at the given tiles and leaves everything else full. */
export function facingOff(
  a: Position,
  b: Position,
  config: GameConfig = OPEN_ARENA,
): GameState {
  return stateWith(
    { players: { A: { position: a }, B: { position: b } } },
    config,
  );
}
