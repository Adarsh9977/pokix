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
  /**
   * Power nodes. Standing on one at the end of a turn restores energy.
   *
   * They exist to give the map a second objective. Without them the only
   * reason to move is the enemy, so both agents walk to the middle and
   * slug it out. A node is a reason to break off, and a place worth
   * denying to the other side.
   */
  readonly energyNodes: readonly Position[];
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
  /** Energy restored by ending a turn on a power node. */
  readonly energyNodeRestore: number;
  /** Maximum stored attack power. */
  readonly maxCharge: number;
  /** Charge gained on any turn the player does not attack. */
  readonly chargeGainPerTurn: number;
  /** Extra damage per point of charge spent. */
  readonly chargeDamageBonus: number;
  /**
   * Whether an obstacle between two players blocks an attack.
   *
   * This is what makes the pillars matter. With it off, cover is decoration
   * and position is only ever about distance.
   */
  readonly requiresLineOfSight: boolean;
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
 * Designed for line of sight rather than for decoration. Two central pillar
 * clusters break the middle into approach lanes, and four flanking blocks
 * give something to round a corner on. The corridor the players start on is
 * left open, so a match reaches contact without needing pathfinding.
 *
 * The set is symmetric about x = (width - 1) / 2, so neither side has better
 * cover than the other.
 */
const OBSTACLES: readonly Position[] = [
  // Central pillars, north and south of the start corridor.
  { x: 9, y: 6 },
  { x: 10, y: 6 },
  { x: 9, y: 7 },
  { x: 10, y: 7 },
  { x: 9, y: 12 },
  { x: 10, y: 12 },
  { x: 9, y: 13 },
  { x: 10, y: 13 },
  // Mid-field cover, near enough to the corridor to be worth using.
  { x: 6, y: 8 },
  { x: 13, y: 8 },
  { x: 6, y: 11 },
  { x: 13, y: 11 },
  // Corner blocks.
  { x: 3, y: 4 },
  { x: 16, y: 4 },
  { x: 3, y: 15 },
  { x: 16, y: 15 },
];

/**
 * Power nodes: contested, and deliberately off the direct path.
 *
 * Both sit on the centre line of the map, north and south, so each is an
 * equal detour for both players. Taking one costs tempo, which is the point.
 */
const ENERGY_NODES: readonly Position[] = [
  { x: 9, y: 2 },
  { x: 10, y: 2 },
  { x: 9, y: 17 },
  { x: 10, y: 17 },
];

export const DEFAULT_GAME_CONFIG: GameConfig = deepFreeze({
  arena: {
    width: 20,
    height: 20,
    obstacles: OBSTACLES,
    energyNodes: ENERGY_NODES,
  },
  player: {
    maxHp: 100,
    startingHp: 100,
    maxEnergy: 100,
    startingEnergy: 100,
  },
  combat: {
    attackRange: 2,
    // Roughly six clean hits to a kill. Enough room for the fight to turn,
    // short enough that a match is worth watching to the end.
    attackDamage: 16,
    attackEnergyCost: 14,
    dodgeEnergyCost: 20,
    moveEnergyCost: 0,
    // Deliberately less than the cost of attacking: roughly one attack every
    // other turn on regen alone. Sustained aggression runs an agent dry,
    // which is what makes a power node worth the detour.
    energyRegenPerTurn: 7,
    energyNodeRestore: 25,
    // Three turns of patience roughly doubles a hit: 16 becomes 34. Enough
    // to be worth waiting for, and enough that ignoring a fully charged
    // opponent is a mistake you can see coming.
    maxCharge: 3,
    chargeGainPerTurn: 1,
    chargeDamageBonus: 6,
    requiresLineOfSight: true,
    defendDamageReduction: 0.5,
    grazedDodgeDamageReduction: 0.25,
  },
  startingPositions: {
    A: { x: 6, y: 10 },
    B: { x: 13, y: 10 },
  },
  maxTurns: 40,
} satisfies GameConfig);
