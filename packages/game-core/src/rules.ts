/**
 * The rule primitives. Small, total, side-effect-free functions that the
 * validator and the resolver both build on, so a rule is never stated twice.
 */

import {
  manhattanDistance,
  positionsEqual,
  type Action,
  type CombatConfig,
  type EnvironmentState,
  type Position,
} from "@jev-arena/types";

/** How a defender mitigated a hit that connected. */
export type Mitigation = "NONE" | "DEFEND" | "DODGE_GRAZE";

export function energyCostOf(action: Action, combat: CombatConfig): number {
  switch (action.type) {
    case "MOVE":
      return combat.moveEnergyCost;
    case "ATTACK":
      return combat.attackEnergyCost;
    case "DEFEND":
      return 0;
    case "DODGE":
      return combat.dodgeEnergyCost;
    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function isWithinAttackRange(
  attacker: Position,
  defender: Position,
  combat: CombatConfig,
): boolean {
  return manhattanDistance(attacker, defender) <= combat.attackRange;
}

/**
 * Is there an unobstructed line between two tiles?
 *
 * A supercover walk: step along the line from `from` to `to` and treat the
 * shot as blocked if any tile strictly between them is an obstacle. Endpoints
 * are excluded, so standing next to a pillar never blocks your own shot.
 *
 * Deterministic and symmetric - `hasLineOfSight(a, b)` always equals
 * `hasLineOfSight(b, a)` - which matters because both players' attacks are
 * resolved from the same snapshot and neither may get a better angle than
 * the other by accident.
 */
export function hasLineOfSight(
  from: Position,
  to: Position,
  environment: EnvironmentState,
): boolean {
  if (positionsEqual(from, to)) return true;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    // Round half away from zero on both axes so the walk is symmetric: the
    // same pair of tiles picks the same intermediate tiles in either
    // direction.
    const x = Math.round(from.x + dx * t);
    const y = Math.round(from.y + dy * t);
    if (environment.obstacles.some((tile) => tile.x === x && tile.y === y)) {
      return false;
    }
  }

  return true;
}

/** Can this attack actually connect, accounting for cover? */
export function canAttackConnect(
  attacker: Position,
  defender: Position,
  combat: CombatConfig,
  environment: EnvironmentState,
): boolean {
  if (!isWithinAttackRange(attacker, defender, combat)) return false;
  if (!combat.requiresLineOfSight) return true;
  return hasLineOfSight(attacker, defender, environment);
}

export function isOnEnergyNode(
  position: Position,
  environment: EnvironmentState,
): boolean {
  return environment.energyNodes.some((tile) => positionsEqual(tile, position));
}

/**
 * Damage after mitigation, always a non-negative integer so the authoritative
 * state never accumulates floating-point drift.
 */
export function mitigatedDamage(
  mitigation: Mitigation,
  combat: CombatConfig,
  charge = 0,
): number {
  const reduction =
    mitigation === "DEFEND"
      ? combat.defendDamageReduction
      : mitigation === "DODGE_GRAZE"
        ? combat.grazedDodgeDamageReduction
        : 0;
  const raw =
    combat.attackDamage +
    Math.max(0, Math.min(charge, combat.maxCharge)) * combat.chargeDamageBonus;
  return Math.max(0, Math.round(raw * (1 - reduction)));
}

/** Charge after a turn: spent entirely by attacking, otherwise topped up. */
export function nextCharge(
  current: number,
  attacked: boolean,
  combat: CombatConfig,
): number {
  if (attacked) return 0;
  return Math.min(combat.maxCharge, current + combat.chargeGainPerTurn);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
