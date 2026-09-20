/**
 * Game configuration: every tunable rule constant in one place.
 *
 * The spec fixes the arena at 20x20 and the action set at four actions, but
 * leaves the balance numbers open. They live here so they can be tuned, tested
 * and varied per experiment without touching the engine. See
 * docs/ASSUMPTIONS.md (A8) for the reasoning behind each value.
 *
 * There is no seed and no RNG. The first version of the game is fully
 * deterministic, as required.
 */

import type { Position } from "./geometry";
import type { PlayerId } from "./state";

export interface ArenaConfig {
  readonly width: number;
  readonly height: number;
  /** Impassable tiles. Mirror-symmetric, so neither side gets better cover. */
  readonly obstacles: readonly Position[];
}

export interface PlayerConfig {
  readonly maxHp: number;
  readonly startingHp: number;
  readonly maxEnergy: number;
  readonly startingEnergy: number;
}

export interface CombatConfig {
  /** Maximum manhattan distance at which an ATTACK can connect. */
  readonly attackRange: number;
  /** Damage of an unmitigated hit. */
  readonly attackDamage: number;
  readonly attackEnergyCost: number;
  readonly dodgeEnergyCost: number;
  readonly moveEnergyCost: number;
  /** Energy returned at the end of every turn, capped at `maxEnergy`. */
  readonly energyRegenPerTurn: number;
  /** Fraction of damage removed by DEFEND. */
  readonly defendDamageReduction: number;
  /**
   * Fraction of damage removed by a DODGE that failed to break range.
   * A dodge that does break range removes the hit entirely.
   */
  readonly grazedDodgeDamageReduction: number;
}

export interface GameConfig {
  readonly arena: ArenaConfig;
  readonly player: PlayerConfig;
  readonly combat: CombatConfig;
  readonly startingPositions: Readonly<Record<PlayerId, Position>>;
  /** Hard cap on turns. On expiry the higher HP wins; equal HP is a draw. */
  readonly maxTurns: number;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * Obstacle layout.
 *
 * Two pillar clusters north and south of the centre line, plus four corner
 * blocks. The horizontal corridor the players start on is left open so a match
 * can reach contact without pathfinding, while the pillars give a reason to
 * move off that line. The set is symmetric about x = (width - 1) / 2.
 */
const OBSTACLES: readonly Position[] = [
  { x: 9, y: 6 },
  { x: 10, y: 6 },
  { x: 9, y: 7 },
  { x: 10, y: 7 },
  { x: 9, y: 12 },
  { x: 10, y: 12 },
  { x: 9, y: 13 },
  { x: 10, y: 13 },
  { x: 5, y: 3 },
  { x: 14, y: 3 },
  { x: 5, y: 16 },
  { x: 14, y: 16 },
];

export const DEFAULT_GAME_CONFIG: GameConfig = deepFreeze({
  arena: {
    width: 20,
    height: 20,
    obstacles: OBSTACLES,
  },
  player: {
    maxHp: 100,
    startingHp: 100,
    maxEnergy: 100,
    startingEnergy: 100,
  },
  combat: {
    attackRange: 2,
    attackDamage: 12,
    attackEnergyCost: 15,
    dodgeEnergyCost: 20,
    moveEnergyCost: 0,
    energyRegenPerTurn: 8,
    defendDamageReduction: 0.5,
    grazedDodgeDamageReduction: 0.25,
  },
  startingPositions: {
    A: { x: 6, y: 10 },
    B: { x: 13, y: 10 },
  },
  maxTurns: 60,
} satisfies GameConfig);
