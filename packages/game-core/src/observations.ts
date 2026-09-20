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
import { hasLineOfSight, isOnEnergyNode } from "./rules";
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
  const lineOfSight = hasLineOfSight(
    self.position,
    enemy.position,
    state.environment,
  );

  // Sorted by how far away they are, so "the nearest node" is just the first
  // entry and the agent never has to compare distances itself.
  const energyNodes = [...state.environment.energyNodes]
    .map((tile) => ({
      position: { ...tile },
      distance: manhattanDistance(self.position, tile),
    }))
    .sort((a, b) =>
      a.distance === b.distance
        ? a.position.x - b.position.x || a.position.y - b.position.y
        : a.distance - b.distance,
    );

  return deepFreeze({
    turn: state.turn,
    stateVersion: state.version,
    self: {
      id: self.id,
      hp: self.hp,
      energy: self.energy,
      position: { ...self.position },
      charge: self.charge,
    },
    enemy: {
      id: enemy.id,
      hp: enemy.hp,
      position: { ...enemy.position },
      charge: enemy.charge,
    },
    availableActions,
    legalMoveDirections,
    legalDodgeDirections,
    distanceToEnemy,
    attackRange: config.combat.attackRange,
    enemyInAttackRange: distanceToEnemy <= config.combat.attackRange,
    hasLineOfSightToEnemy: lineOfSight,
    maxCharge: config.combat.maxCharge,
    chargeDamageBonus: config.combat.chargeDamageBonus,
    enemyPotentialDamage:
      config.combat.attackDamage +
      enemy.charge * config.combat.chargeDamageBonus,
    /** True when the enemy is close enough but cover is in the way. */
    isBehindCover: distanceToEnemy <= config.combat.attackRange && !lineOfSight,
    standingOnEnergyNode: isOnEnergyNode(self.position, state.environment),
    energyNodes,
    environment: {
      width: state.environment.width,
      height: state.environment.height,
      obstacles: state.environment.obstacles.map((tile) => ({ ...tile })),
      energyNodes: state.environment.energyNodes.map((tile) => ({ ...tile })),
    },
  } satisfies AgentObservation);
}
