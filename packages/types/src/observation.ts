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
}

export interface ObservedEnemy {
  readonly id: PlayerId;
  readonly hp: number;
  readonly position: Position;
}

export interface ObservedEnvironment {
  readonly width: number;
  readonly height: number;
  readonly obstacles: readonly Position[];
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

  readonly environment: ObservedEnvironment;
}
