/**
 * Builds the view of the world a single agent is allowed to have.
 *
 * Availability is answered by the real validator, not by a second copy of the
 * rules. If the engine would reject it, it is not offered.
 */

import {
  ACTION_TYPES,
  DIRECTIONS,
  attack,
  dodge,
  manhattanDistance,
  move,
  opponentOf,
  type ActionType,
  type AgentObservation,
  type Direction,
  type GameConfig,
  type GameState,
  type PlayerId,
} from "@jev-arena/types";
import { validateAction } from "./actions";
import { deepFreeze } from "./state";

export function buildObservation(
  state: GameState,
  playerId: PlayerId,
  config: GameConfig,
): AgentObservation {
  const self = state.players[playerId];
  const enemyId = opponentOf(playerId);
  const enemy = state.players[enemyId];

  const legal = (direction: Direction, kind: "move" | "dodge") =>
    validateAction(
      state,
      playerId,
      kind === "move" ? move(direction) : dodge(direction),
      config,
    ).valid;

  const legalMoveDirections = DIRECTIONS.filter((d) => legal(d, "move"));
  const legalDodgeDirections = DIRECTIONS.filter((d) => legal(d, "dodge"));
  const canAttack = validateAction(
    state,
    playerId,
    attack(enemyId),
    config,
  ).valid;

  const available = new Set<ActionType>(["DEFEND"]);
  if (legalMoveDirections.length > 0) available.add("MOVE");
  if (legalDodgeDirections.length > 0) available.add("DODGE");
  if (canAttack) available.add("ATTACK");

  // Ordered by ACTION_TYPES so the option list handed to a model is stable
  // from turn to turn.
  const availableActions = ACTION_TYPES.filter((type) => available.has(type));

  const distanceToEnemy = manhattanDistance(self.position, enemy.position);

  return deepFreeze({
    turn: state.turn,
    stateVersion: state.version,
    self: {
      id: self.id,
      hp: self.hp,
      energy: self.energy,
      position: { ...self.position },
    },
    enemy: {
      id: enemy.id,
      hp: enemy.hp,
      position: { ...enemy.position },
    },
    availableActions,
    legalMoveDirections,
    legalDodgeDirections,
    distanceToEnemy,
    attackRange: config.combat.attackRange,
    enemyInAttackRange: distanceToEnemy <= config.combat.attackRange,
    environment: {
      width: state.environment.width,
      height: state.environment.height,
      obstacles: state.environment.obstacles.map((tile) => ({ ...tile })),
    },
  } satisfies AgentObservation);
}
