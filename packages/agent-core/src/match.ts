/**
 * The asynchronous, agent-driven match loop.
 *
 * One rule governs this file: both agents are asked at the same time, from
 * the same snapshot, and the turn does not resolve until both have answered.
 * Whoever answers first gains nothing.
 *
 *     STATE N
 *        |
 *        +---------> Agent A  \
 *        |                     |  Promise.all
 *        +---------> Agent B  /
 *                       |
 *                  WAIT FOR BOTH
 *                       |
 *                  VALIDATE + RESOLVE
 *                       |
 *                    STATE N+1
 *
 * Timeouts, stale-decision rejection and decision tracing are layered on in
 * the orchestrator commit; this is the minimum that makes agents playable.
 */

import {
  DEFAULT_GAME_CONFIG,
  PLAYER_IDS,
  type Action,
  type AgentDecision,
  type AgentObservation,
  type GameConfig,
  type GameState,
  type PlayerId,
} from "@jev-arena/types";
import {
  buildObservation,
  createInitialState,
  resolveTurn,
  type TurnResolution,
} from "@jev-arena/game-core";
import type { Agent } from "./agent";

export interface AgentTurnRecord {
  readonly turn: number;
  readonly stateVersion: number;
  readonly observations: Record<PlayerId, AgentObservation>;
  readonly decisions: Record<PlayerId, AgentDecision>;
  readonly resolution: TurnResolution;
}

export interface AgentMatchResult {
  readonly initialState: GameState;
  readonly finalState: GameState;
  readonly turns: readonly AgentTurnRecord[];
  readonly turnCount: number;
  /** `null` for a draw. */
  readonly winner: PlayerId | null;
}

export interface RunAgentMatchOptions {
  readonly config?: GameConfig;
  readonly initialState?: GameState;
  /** Called after each turn resolves. For CLI output and live streaming. */
  readonly onTurn?: (record: AgentTurnRecord) => void;
}

/** Asks both agents concurrently from one snapshot and waits for both. */
export async function decideBoth(
  agents: Record<PlayerId, Agent>,
  observations: Record<PlayerId, AgentObservation>,
): Promise<Record<PlayerId, AgentDecision>> {
  const [a, b] = await Promise.all([
    agents.A.decide(observations.A),
    agents.B.decide(observations.B),
  ]);
  return { A: a, B: b };
}

export async function runAgentMatch(
  agents: Record<PlayerId, Agent>,
  options: RunAgentMatchOptions = {},
): Promise<AgentMatchResult> {
  const config = options.config ?? DEFAULT_GAME_CONFIG;
  const initialState = options.initialState ?? createInitialState(config);

  const turns: AgentTurnRecord[] = [];
  let state = initialState;

  const hardLimit = Math.max(1, config.maxTurns) + 1;

  while (state.status === "running") {
    if (turns.length >= hardLimit) {
      throw new Error(
        `Match exceeded the hard turn limit of ${hardLimit}. Check GameConfig.maxTurns.`,
      );
    }

    // One snapshot, one observation each. Both derived before either agent is
    // asked, so neither can see a world the other did not.
    const observations = {} as Record<PlayerId, AgentObservation>;
    for (const id of PLAYER_IDS) {
      observations[id] = buildObservation(state, id, config);
    }

    const decisions = await decideBoth(agents, observations);

    const actions = {} as Record<PlayerId, Action>;
    for (const id of PLAYER_IDS) actions[id] = decisions[id].action;

    const resolution = resolveTurn(state, actions, config);

    const record: AgentTurnRecord = Object.freeze({
      turn: state.turn,
      stateVersion: state.version,
      observations,
      decisions,
      resolution,
    });
    turns.push(record);
    options.onTurn?.(record);

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
