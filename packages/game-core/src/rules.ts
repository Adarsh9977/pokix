/**
 * The rule primitives. Small, total, side-effect-free functions that the
 * validator and the resolver both build on, so a rule is never stated twice.
 */

import {
  manhattanDistance,
  type Action,
  type CombatConfig,
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
 * Damage after mitigation, always a non-negative integer so the authoritative
 * state never accumulates floating-point drift.
 */
export function mitigatedDamage(
  mitigation: Mitigation,
  combat: CombatConfig,
): number {
  const reduction =
    mitigation === "DEFEND"
      ? combat.defendDamageReduction
      : mitigation === "DODGE_GRAZE"
        ? combat.grazedDodgeDamageReduction
        : 0;
  return Math.max(0, Math.round(combat.attackDamage * (1 - reduction)));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
