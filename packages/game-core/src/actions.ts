/**
 * Action validation.
 *
 * This is the gate between "what an agent wanted" and "what the engine will
 * consider". Nothing reaches the resolver without passing through here, which
 * is what makes it safe for an action to have come from a model.
 *
 * Every rejection carries a specific reason and a human-readable message. The
 * spec forbids generic failures, and these strings surface in the HUD.
 */

import {
  describeAction,
  opponentOf,
  translate,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerId,
} from "@jev-arena/types";
import { energyCostOf, isWithinAttackRange } from "./rules";
import { isInsideArena, isObstacle } from "./state";

export const INVALID_ACTION_REASONS = [
  "MATCH_FINISHED",
  "OUT_OF_BOUNDS",
  "BLOCKED_TILE",
  "OUT_OF_RANGE",
  "INSUFFICIENT_ENERGY",
  "SELF_TARGET",
] as const;

export type InvalidActionReason = (typeof INVALID_ACTION_REASONS)[number];

export interface ActionRejection {
  readonly reason: InvalidActionReason;
  readonly message: string;
}

export type ActionValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly rejection: ActionRejection };

const VALID: ActionValidation = Object.freeze({ valid: true });

function reject(
  reason: InvalidActionReason,
  message: string,
): ActionValidation {
  return Object.freeze({
    valid: false,
    rejection: Object.freeze({ reason, message }),
  });
}

export function validateAction(
  state: GameState,
  playerId: PlayerId,
  action: Action,
  config: GameConfig,
): ActionValidation {
  if (state.status !== "running") {
    return reject(
      "MATCH_FINISHED",
      `Player ${playerId} tried to ${describeAction(action)} but the match has already finished.`,
    );
  }

  const player = state.players[playerId];
  const cost = energyCostOf(action, config.combat);
  if (cost > player.energy) {
    return reject(
      "INSUFFICIENT_ENERGY",
      `Player ${playerId} needs ${cost} energy to ${describeAction(action)} but only has ${player.energy}.`,
    );
  }

  switch (action.type) {
    case "DEFEND":
      // Always available. It is the fallback every other failure collapses to.
      return VALID;

    case "MOVE":
    case "DODGE": {
      const destination = translate(player.position, action.direction);
      if (!isInsideArena(destination, state.environment)) {
        return reject(
          "OUT_OF_BOUNDS",
          `Player ${playerId} cannot ${describeAction(action)}: (${destination.x},${destination.y}) is outside the ${state.environment.width}x${state.environment.height} arena.`,
        );
      }
      if (isObstacle(destination, state.environment)) {
        return reject(
          "BLOCKED_TILE",
          `Player ${playerId} cannot ${describeAction(action)}: (${destination.x},${destination.y}) is blocked by an obstacle.`,
        );
      }
      // Opponent occupancy is deliberately not checked here. They may be
      // vacating the tile this very turn; the resolver settles it.
      return VALID;
    }

    case "ATTACK": {
      if (action.target === playerId) {
        return reject(
          "SELF_TARGET",
          `Player ${playerId} cannot attack itself.`,
        );
      }
      const target = state.players[opponentOf(playerId)];
      if (
        !isWithinAttackRange(player.position, target.position, config.combat)
      ) {
        return reject(
          "OUT_OF_RANGE",
          `Player ${playerId} cannot attack ${action.target}: the target is out of range (max ${config.combat.attackRange}).`,
        );
      }
      return VALID;
    }

    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled action: ${JSON.stringify(exhaustive)}`);
    }
  }
}
