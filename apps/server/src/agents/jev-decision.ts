/**
 * Turning a game observation into Jev questions, and Jev answers back into a
 * game action.
 *
 * Pure functions, no I/O, so the whole translation is testable without a
 * network. This is where the "narrow judgment" discipline lives:
 *
 * - The model is asked what the agent should *want*. It is never asked to
 *   compute damage, check range, validate legality or move anything. Code
 *   already knows all of that and does it deterministically.
 * - Only legal options are offered. An illegal action cannot be chosen
 *   because it is not in the option list.
 * - All three questions go in one request. Jev ingests the state once and
 *   answers them in parallel, so the two direction questions - which are
 *   speculative, and usually only one of them matters - cost a few tokens
 *   rather than two extra round trips.
 */

import {
  attack,
  defend,
  dodge,
  STRATEGY_PROFILES,
  isActionType,
  isDirection,
  move,
  type Action,
  type ActionType,
  type AgentObservation,
  type Direction,
  type StrategyProfile,
} from "@jev-arena/types";
import { ArenaError } from "@jev-arena/types";
import type { JevChoiceAnswer, JevChoiceQuestion } from "../typesafe/gateway";

export const QUESTION_IDS = {
  action: "action",
  moveDirection: "move_direction",
  dodgeDirection: "dodge_direction",
} as const;

/**
 * How each action is described to the model.
 *
 * Descriptions say when an option applies, so the options separate from each
 * other rather than relying on their names, which is what the Choice
 * documentation asks for.
 */
const ACTION_DESCRIPTIONS: Record<ActionType, string> = {
  MOVE: "Reposition one tile. Costs no energy. Use it to close distance on the enemy, to break away from them, or to get around an obstacle.",
  ATTACK:
    "Strike the enemy for solid damage. Costs energy. Only offered when the enemy is already within reach this turn.",
  DEFEND:
    "Brace. Costs nothing, deals nothing, and halves any damage taken this turn. The safe option when energy is low or an attack is expected.",
  DODGE:
    "Spend energy to evade one tile. If the move breaks the enemy's reach the incoming attack misses completely; if not, it only grazes.",
};

const DIRECTION_DESCRIPTIONS: Record<Direction, string> = {
  NORTH: "Upward on the map, decreasing y.",
  SOUTH: "Downward on the map, increasing y.",
  EAST: "Rightward on the map, increasing x.",
  WEST: "Leftward on the map, decreasing x.",
};

/** The shared profile definition, so local and Jev agents mean the same thing. */
export const NEUTRAL_PROFILE = STRATEGY_PROFILES.neutral;

/**
 * The state handed to the model.
 *
 * Named JSON fields rather than prose, because the docs recommend that when
 * context has several parts. Derived tactical facts are precomputed so the
 * model judges rather than calculates. Enemy energy is absent because the
 * observation never had it.
 */
export function buildDecisionState(
  observation: AgentObservation,
): Record<string, unknown> {
  return {
    turn: observation.turn,
    you: {
      id: observation.self.id,
      hp: observation.self.hp,
      energy: observation.self.energy,
      position: observation.self.position,
    },
    enemy: {
      id: observation.enemy.id,
      hp: observation.enemy.hp,
      position: observation.enemy.position,
    },
    tactical: {
      distanceToEnemy: observation.distanceToEnemy,
      yourAttackRange: observation.attackRange,
      enemyIsWithinYourReach:
        observation.enemyInAttackRange && observation.hasLineOfSightToEnemy,
      youAreWithinEnemyReach:
        observation.enemyInAttackRange && observation.hasLineOfSightToEnemy,
      // Stated separately because "they are close but I have no shot" calls
      // for a different answer than "they are too far away".
      clearLineOfFire: observation.hasLineOfSightToEnemy,
      enemyIsShieldedByCover: observation.isBehindCover,
    },
    power: {
      youAreStandingOnAPowerNode: observation.standingOnEnergyNode,
      energyRestoredByANode: "a large one-off top-up",
      nearestNodes: observation.energyNodes.slice(0, 2).map((node) => ({
        position: node.position,
        distance: node.distance,
      })),
    },
    arena: {
      width: observation.environment.width,
      height: observation.environment.height,
      blockedTiles: observation.environment.obstacles,
      powerNodes: observation.environment.energyNodes,
    },
  };
}

export function buildDecisionQuestions(
  observation: AgentObservation,
  profile: StrategyProfile = NEUTRAL_PROFILE,
): JevChoiceQuestion[] {
  const questions: JevChoiceQuestion[] = [];

  const actionCriteria: Record<string, string> = {};
  for (const type of observation.availableActions) {
    actionCriteria[type] = ACTION_DESCRIPTIONS[type];
  }

  // Only mention cover when it is actually the thing in the way. Saying it
  // every turn would train the model to weight it when it does not matter.
  const coverNote = observation.isBehindCover
    ? " The enemy is close enough to hit but an obstacle blocks the shot, which is why ATTACK is not offered; moving to clear the obstruction is an option."
    : "";

  questions.push({
    id: QUESTION_IDS.action,
    instructions: {
      question:
        "You control the agent described in `you`. Which single action best serves it this turn?",
      approach: profile.directive,
      note: `Only legal actions are listed. Range, energy, cover and legality have already been checked, so any listed option can be taken.${coverNote}`,
    },
    criteria: actionCriteria,
  });

  // Speculative: only consulted if the action answer turns out to be MOVE.
  // Asked anyway, because asking here is far cheaper than a second round trip.
  if (observation.legalMoveDirections.length > 1) {
    questions.push({
      id: QUESTION_IDS.moveDirection,
      instructions: {
        question:
          "Assume the agent moves one tile this turn. Which direction serves it best?",
        note: "Only directions that are actually walkable are listed.",
      },
      criteria: describeDirections(observation.legalMoveDirections),
    });
  }

  if (observation.legalDodgeDirections.length > 1) {
    questions.push({
      id: QUESTION_IDS.dodgeDirection,
      instructions: {
        question:
          "Assume the agent dodges this turn. Which direction is the best evasion?",
        note: "A dodge that leaves the enemy's reach avoids an attack entirely. Only legal directions are listed.",
      },
      criteria: describeDirections(observation.legalDodgeDirections),
    });
  }

  return questions;
}

function describeDirections(
  directions: readonly Direction[],
): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const direction of directions) {
    criteria[direction] = DIRECTION_DESCRIPTIONS[direction];
  }
  return criteria;
}

export interface ParsedDecision {
  readonly action: Action;
  readonly confidence: number;
  readonly probabilities: Partial<Record<ActionType, number>>;
}

/**
 * Reads the answers we need and ignores the ones we do not.
 *
 * Rejects anything outside the offered option set rather than coercing it.
 * A model that answers off-menu is a real signal, and silently repairing it
 * would hide that.
 */
export function parseDecision(
  observation: AgentObservation,
  answers: Readonly<Record<string, JevChoiceAnswer>>,
): ParsedDecision {
  const actionAnswer = answers[QUESTION_IDS.action];
  if (!actionAnswer) {
    throw new ArenaError(
      "INVALID_RESPONSE",
      `Jev did not answer the "${QUESTION_IDS.action}" question.`,
    );
  }

  const chosen = actionAnswer.choice;
  if (!isActionType(chosen)) {
    throw new ArenaError(
      "INVALID_RESPONSE",
      `Jev chose "${chosen}", which is not one of the four arena actions.`,
    );
  }
  if (!observation.availableActions.includes(chosen)) {
    throw new ArenaError(
      "INVALID_RESPONSE",
      `Jev chose ${chosen}, which was not among the options offered (${observation.availableActions.join(", ")}).`,
    );
  }

  const probabilities: Partial<Record<ActionType, number>> = {};
  for (const [option, probability] of Object.entries(
    actionAnswer.probabilities,
  )) {
    if (isActionType(option)) probabilities[option] = probability;
  }

  return {
    action: buildAction(observation, chosen, answers),
    confidence: actionAnswer.confidence,
    probabilities,
  };
}

function buildAction(
  observation: AgentObservation,
  type: ActionType,
  answers: Readonly<Record<string, JevChoiceAnswer>>,
): Action {
  switch (type) {
    case "DEFEND":
      return defend();

    case "ATTACK":
      // The target is not a judgment: there is exactly one enemy, and code
      // knows who it is.
      return attack(observation.enemy.id);

    case "MOVE":
      return move(
        pickDirection(
          observation.legalMoveDirections,
          answers[QUESTION_IDS.moveDirection],
          "MOVE",
        ),
      );

    case "DODGE":
      return dodge(
        pickDirection(
          observation.legalDodgeDirections,
          answers[QUESTION_IDS.dodgeDirection],
          "DODGE",
        ),
      );

    default: {
      const exhaustive: never = type;
      throw new ArenaError(
        "INVALID_RESPONSE",
        `Unhandled action type ${String(exhaustive)}.`,
      );
    }
  }
}

function pickDirection(
  legal: readonly Direction[],
  answer: JevChoiceAnswer | undefined,
  actionType: string,
): Direction {
  if (legal.length === 0) {
    throw new ArenaError(
      "INVALID_RESPONSE",
      `Jev chose ${actionType} but no direction is legal. This option should not have been offered.`,
    );
  }

  // Only one way to go: no question was asked, and none was needed.
  if (legal.length === 1 || answer === undefined) return legal[0]!;

  const chosen = answer.choice;
  if (!isDirection(chosen) || !legal.includes(chosen)) {
    throw new ArenaError(
      "INVALID_RESPONSE",
      `Jev chose direction "${chosen}" for ${actionType}, which was not among the legal options (${legal.join(", ")}).`,
    );
  }
  return chosen;
}
