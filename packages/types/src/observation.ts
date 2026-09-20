/**
 * The observation layer: what an agent is allowed to know.
 *
 * Raw `GameState` is never handed to an agent, and never handed to Jev. This
 * type is the boundary. Today both agents see the same facts; the type exists
 * so that fog of war can later give A and B genuinely different views without
 * touching the engine or the agents.
 *
 * Everything here is either observed fact or arithmetic derived from observed
 * fact. Nothing inferred, nothing model-generated.
 */

import type { ActionType } from "./actions";
import type { Direction, Position } from "./geometry";
import type { PlayerId } from "./state";

export interface ObservedSelf {
  readonly id: PlayerId;
  readonly hp: number;
  readonly energy: number;
  readonly position: Position;
  readonly charge: number;
}

export interface ObservedEnemy {
  readonly id: PlayerId;
  readonly hp: number;
  readonly position: Position;
  /**
   * Visible on purpose. A charged opponent is a telegraphed threat, and
   * being able to read it is what turns DEFEND and DODGE into decisions
   * rather than guesses.
   */
  readonly charge: number;
}

export interface ObservedEnvironment {
  readonly width: number;
  readonly height: number;
  readonly obstacles: readonly Position[];
  readonly energyNodes: readonly Position[];
}

export interface ObservedEnergyNode {
  readonly position: Position;
  /** Manhattan distance from the observer. */
  readonly distance: number;
}

export interface AgentObservation {
  readonly turn: number;
  /**
   * The snapshot this observation was taken from. A decision made against it
   * is only valid while the authoritative state is still at this version.
   */
  readonly stateVersion: number;

  readonly self: ObservedSelf;
  readonly enemy: ObservedEnemy;

  /** Action types that have at least one legal concrete form right now. */
  readonly availableActions: readonly ActionType[];
  /** Directions a MOVE could legally take. */
  readonly legalMoveDirections: readonly Direction[];
  /** Directions a DODGE could legally take, energy included. */
  readonly legalDodgeDirections: readonly Direction[];

  /**
   * Derived facts, precomputed so a decision never depends on the agent doing
   * arithmetic. A System One model should be judging, not calculating.
   */
  readonly distanceToEnemy: number;
  readonly attackRange: number;
  readonly enemyInAttackRange: boolean;
  /** False when an obstacle sits between the two players. */
  readonly hasLineOfSightToEnemy: boolean;
  /**
   * The enemy is close enough to hit but cover is in the way. Worth its own
   * field because "move to get an angle" is a different decision from
   * "move to close distance".
   */
  readonly isBehindCover: boolean;

  readonly maxCharge: number;
  /** Extra damage each point of charge adds to a hit. */
  readonly chargeDamageBonus: number;
  /** Damage the enemy's next attack would do if it lands unmitigated. */
  readonly enemyPotentialDamage: number;

  readonly standingOnEnergyNode: boolean;
  /** Power nodes, nearest first. */
  readonly energyNodes: readonly ObservedEnergyNode[];

  readonly environment: ObservedEnvironment;
}
