/**
 * The in-memory match driver.
 *
 * Synchronous and pure: it takes a function that chooses both actions and
 * plays the match to completion. No agents, no async, no I/O. The asynchronous
 * agent-driven orchestrator is built on top of the same resolver later, which
 * is what lets a recorded match be replayed by this function alone.
 */

import {
  DEFAULT_GAME_CONFIG,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerId,
} from "@jev-arena/types";
import { resolveTurn, type TurnResolution } from "./resolver";
import { createInitialState } from "./state";

export type ActionSelector = (state: GameState) => Record<PlayerId, Action>;

export interface MatchOutcome {
  readonly initialState: GameState;
  readonly finalState: GameState;
  readonly turns: readonly TurnResolution[];
  readonly turnCount: number;
  /** `null` for a draw. */
  readonly winner: PlayerId | null;
}

/**
 * Plays a match to completion.
 *
 * @param from Optional starting snapshot, for resuming or for replay.
 */
export function runMatch(
  selectActions: ActionSelector,
  config: GameConfig = DEFAULT_GAME_CONFIG,
  from?: GameState,
): MatchOutcome {
  const initialState = from ?? createInitialState(config);

  const turns: TurnResolution[] = [];
  let state = initialState;

  // The turn cap in the config guarantees termination; this is a belt-and-
  // braces guard against a misconfigured maxTurns hanging a server.
  const hardLimit = Math.max(1, config.maxTurns) + 1;

  while (state.status === "running") {
    if (turns.length >= hardLimit) {
      throw new Error(
        `Match exceeded the hard turn limit of ${hardLimit}. Check GameConfig.maxTurns.`,
      );
    }
    const resolution = resolveTurn(state, selectActions(state), config);
    turns.push(resolution);
    state = resolution.next;
  }

  return Object.freeze({
    initialState,
    finalState: state,
    turns: Object.freeze(turns),
    turnCount: turns.length,
    winner: state.winner ?? null,
  });
}
