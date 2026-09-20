/**
 * Simultaneous turn resolution.
 *
 * Both actions are resolved against one frozen snapshot, in fixed phases:
 *
 *   validate -> pay energy -> move -> deal damage -> regenerate -> check win
 *
 * Damage for both players is computed from the same post-movement positions
 * *before* either HP total is written, so swapping A and B in the input cannot
 * change the output and a dying player still lands their blow. Nothing here
 * reads a clock, a random number, or anything outside its arguments.
 */

import {
  PLAYER_IDS,
  defend,
  opponentOf,
  positionsEqual,
  translate,
  type Action,
  type GameConfig,
  type GameState,
  type MatchStatus,
  type PlayerId,
  type PlayerState,
  type Position,
} from "@jev-arena/types";
import type { ActionRejection } from "./actions";
import { validateAction } from "./actions";
import {
  clamp,
  energyCostOf,
  isWithinAttackRange,
  mitigatedDamage,
  type Mitigation,
} from "./rules";
import { deepFreeze } from "./state";

/** What happened to an attack that was actually attempted. */
export type AttackOutcome =
  /** Connected, unmitigated. */
  | "HIT"
  /** Connected against a braced defender. */
  | "DEFENDED"
  /** Connected, but the defender dodged and only clipped them. */
  | "GRAZED"
  /** The defender dodged out of range. */
  | "EVADED"
  /** The defender walked out of range. */
  | "MISSED";

/**
 * What an invalid action collapses to.
 *
 * DEFEND is the only action that is always legal, costs nothing, and cannot
 * move a player somewhere they did not ask to be. Section 22 picks the same
 * action as the timeout fallback, so the two failure modes behave alike.
 */
export const INVALID_ACTION_FALLBACK: Action = defend();

export interface ResolvedPlayerTurn {
  readonly id: PlayerId;
  /** Exactly what the agent asked for. */
  readonly submitted: Action;
  /** What the engine actually ran. Differs from `submitted` only on rejection. */
  readonly applied: Action;
  /** Why `applied` differs from `submitted`, if it does. */
  readonly rejection?: ActionRejection;
  readonly moved: boolean;
  /** A legal move that the opponent's body got in the way of. */
  readonly movementBlocked: boolean;
  readonly energySpent: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly attackOutcome?: AttackOutcome;
}

export interface TurnResolution {
  /** The exact snapshot this turn was resolved against. */
  readonly previous: GameState;
  readonly next: GameState;
  readonly players: Record<PlayerId, ResolvedPlayerTurn>;
}

export function resolveTurn(
  state: GameState,
  submitted: Record<PlayerId, Action>,
  config: GameConfig,
): TurnResolution {
  if (state.status !== "running") {
    throw new Error(
      `Cannot resolve turn ${state.turn}: the match has already finished.`,
    );
  }

  // --- Phase 1: validate -------------------------------------------------
  const applied = {} as Record<PlayerId, Action>;
  const rejections: Partial<Record<PlayerId, ActionRejection>> = {};

  for (const id of PLAYER_IDS) {
    const result = validateAction(state, id, submitted[id], config);
    if (result.valid) {
      applied[id] = submitted[id];
    } else {
      applied[id] = INVALID_ACTION_FALLBACK;
      rejections[id] = result.rejection;
    }
  }

  // --- Phase 2: pay energy ----------------------------------------------
  const energySpent = {} as Record<PlayerId, number>;
  for (const id of PLAYER_IDS) {
    energySpent[id] = energyCostOf(applied[id], config.combat);
  }

  // --- Phase 3: movement -------------------------------------------------
  const current = {} as Record<PlayerId, Position>;
  const intended = {} as Record<PlayerId, Position>;
  for (const id of PLAYER_IDS) {
    const action = applied[id];
    current[id] = state.players[id].position;
    intended[id] =
      action.type === "MOVE" || action.type === "DODGE"
        ? translate(current[id], action.direction)
        : current[id];
  }

  const final = { A: intended.A, B: intended.B } as Record<PlayerId, Position>;
  const movementBlocked = { A: false, B: false } as Record<PlayerId, boolean>;
  const wantsToMove = (id: PlayerId) =>
    !positionsEqual(intended[id], current[id]);

  if (positionsEqual(intended.A, intended.B)) {
    // Contested tile, including walking into someone standing still.
    // Nobody wins it. Symmetric by construction.
    for (const id of PLAYER_IDS) {
      if (wantsToMove(id)) movementBlocked[id] = true;
      final[id] = current[id];
    }
  } else if (
    positionsEqual(intended.A, current.B) &&
    positionsEqual(intended.B, current.A)
  ) {
    // Attempted swap: players would pass through each other.
    for (const id of PLAYER_IDS) {
      movementBlocked[id] = true;
      final[id] = current[id];
    }
  } else {
    for (const id of PLAYER_IDS) {
      const other = opponentOf(id);
      const otherStaysPut = !wantsToMove(other);
      if (
        wantsToMove(id) &&
        otherStaysPut &&
        positionsEqual(intended[id], current[other])
      ) {
        movementBlocked[id] = true;
        final[id] = current[id];
      }
    }
  }

  // --- Phase 4: damage ---------------------------------------------------
  // Computed for both players from the same post-movement geometry, before a
  // single HP value is written.
  const damageDealt = { A: 0, B: 0 } as Record<PlayerId, number>;
  const damageTaken = { A: 0, B: 0 } as Record<PlayerId, number>;
  const attackOutcomes: Partial<Record<PlayerId, AttackOutcome>> = {};

  for (const id of PLAYER_IDS) {
    const action = applied[id];
    if (action.type !== "ATTACK") continue;

    const defenderId = action.target;
    const defenderAction = applied[defenderId];

    if (!isWithinAttackRange(final[id], final[defenderId], config.combat)) {
      attackOutcomes[id] =
        defenderAction.type === "DODGE" ? "EVADED" : "MISSED";
      continue;
    }

    const mitigation: Mitigation =
      defenderAction.type === "DEFEND"
        ? "DEFEND"
        : defenderAction.type === "DODGE"
          ? "DODGE_GRAZE"
          : "NONE";

    // Report the damage that was actually absorbed, so a killing blow is not
    // inflated by overkill in the analytics.
    const absorbed = Math.min(
      mitigatedDamage(mitigation, config.combat),
      state.players[defenderId].hp,
    );

    damageDealt[id] += absorbed;
    damageTaken[defenderId] += absorbed;
    attackOutcomes[id] =
      mitigation === "DEFEND"
        ? "DEFENDED"
        : mitigation === "DODGE_GRAZE"
          ? "GRAZED"
          : "HIT";
  }

  // --- Phase 5: write the new state --------------------------------------
  const players = {} as Record<PlayerId, PlayerState>;
  for (const id of PLAYER_IDS) {
    const before = state.players[id];
    players[id] = {
      id,
      hp: clamp(before.hp - damageTaken[id], 0, config.player.maxHp),
      energy: clamp(
        before.energy - energySpent[id] + config.combat.energyRegenPerTurn,
        0,
        config.player.maxEnergy,
      ),
      position: { ...final[id] },
      cooldowns: before.cooldowns,
    };
  }

  // --- Phase 6: win condition -------------------------------------------
  const nextTurn = state.turn + 1;
  const downed = { A: players.A.hp <= 0, B: players.B.hp <= 0 };

  let status: MatchStatus = "running";
  let winner: PlayerId | null | undefined;

  if (downed.A || downed.B) {
    status = "finished";
    winner = downed.A && downed.B ? null : downed.A ? "B" : "A";
  } else if (nextTurn > config.maxTurns) {
    status = "finished";
    winner =
      players.A.hp === players.B.hp
        ? null
        : players.A.hp > players.B.hp
          ? "A"
          : "B";
  }

  const next = deepFreeze({
    turn: nextTurn,
    version: state.version + 1,
    status,
    players,
    environment: state.environment,
    ...(winner === undefined ? {} : { winner }),
  } satisfies GameState);

  const resolvedPlayers = {} as Record<PlayerId, ResolvedPlayerTurn>;
  for (const id of PLAYER_IDS) {
    const rejection = rejections[id];
    const attackOutcome = attackOutcomes[id];
    resolvedPlayers[id] = {
      id,
      submitted: submitted[id],
      applied: applied[id],
      moved: !positionsEqual(final[id], current[id]),
      movementBlocked: movementBlocked[id],
      energySpent: energySpent[id],
      damageDealt: damageDealt[id],
      damageTaken: damageTaken[id],
      ...(rejection === undefined ? {} : { rejection }),
      ...(attackOutcome === undefined ? {} : { attackOutcome }),
    };
  }

  return deepFreeze({ previous: state, next, players: resolvedPlayers });
}
