/**
 * The simultaneous decision orchestrator.
 *
 *     STATE N
 *        |
 *        +---------> Agent A  \
 *        |                     |  asked together, from one snapshot
 *        +---------> Agent B  /
 *                       |
 *                  WAIT FOR BOTH
 *                       |
 *                  VALIDATE ACTIONS
 *                       |
 *                  RESOLVE ACTIONS
 *                       |
 *                    STATE N+1
 *
 * Three properties this file is responsible for:
 *
 * 1. **Fairness.** Both observations are built before either agent is asked,
 *    and the turn does not resolve until both have answered. Answering first
 *    buys nothing; answering slowly costs nothing but wall-clock time.
 *
 * 2. **Staleness.** Every request carries the version of the snapshot it was
 *    asked about. An answer is only applied while the authoritative state is
 *    still at that version. A response that arrives after the world moved on
 *    is recorded and discarded, never applied.
 *
 * 3. **Survivability.** A slow, broken or hostile agent cannot hang or corrupt
 *    a match. It gets the configured fallback action and a trace explaining
 *    why.
 */

import {
  DEFAULT_GAME_CONFIG,
  PLAYER_IDS,
  categorize,
  defend,
  describeError,
  isAction,
  type Action,
  type AgentDecision,
  type AgentObservation,
  type DecisionRequest,
  type DecisionTrace,
  type ErrorCategory,
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
  readonly traces: Record<PlayerId, DecisionTrace>;
  readonly resolution: TurnResolution;
}

export interface AgentMatchResult {
  readonly matchId: string;
  readonly initialState: GameState;
  readonly finalState: GameState;
  readonly turns: readonly AgentTurnRecord[];
  readonly turnCount: number;
  /** `null` for a draw. */
  readonly winner: PlayerId | null;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
}

export interface OrchestratorOptions {
  readonly config?: GameConfig;
  readonly initialState?: GameState;
  readonly matchId?: string;

  /**
   * How long to wait for one agent, in milliseconds.
   *
   * Undefined means "wait indefinitely", which is the correct default for
   * local agents and for the first live runs. Section 22 says not to hard-code
   * a timeout without measuring actual behaviour, so there is no invented
   * default here: the value comes from the caller, after measurement.
   */
  readonly decisionTimeoutMs?: number;

  /**
   * What to submit when an agent cannot be used this turn.
   *
   * DEFEND is the default because it is always legal, costs nothing, and
   * cannot move a player somewhere they did not ask to be.
   */
  readonly fallbackAction?: Action;

  /** Injectable clock, so latency behaviour can be tested deterministically. */
  readonly now?: () => number;

  readonly onTrace?: (trace: DecisionTrace) => void;
  readonly onTurn?: (record: AgentTurnRecord) => void;
  /**
   * Called when an agent's answer turns up after its turn already resolved.
   * The answer is discarded; this is purely for observability.
   */
  readonly onStaleDecision?: (trace: DecisionTrace) => void;
}

const TIMED_OUT = Symbol("decision-timed-out");

async function raceTimeout<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface Failure {
  readonly message: string;
  readonly category: ErrorCategory;
}

export class MatchOrchestrator {
  readonly matchId: string;
  private readonly config: GameConfig;
  private readonly fallbackAction: Action;
  private readonly now: () => number;
  private current: GameState;
  private readonly records: AgentTurnRecord[] = [];

  constructor(
    private readonly agents: Record<PlayerId, Agent>,
    private readonly options: OrchestratorOptions = {},
  ) {
    this.config = options.config ?? DEFAULT_GAME_CONFIG;
    this.fallbackAction = options.fallbackAction ?? defend();
    this.now = options.now ?? Date.now;
    this.current = options.initialState ?? createInitialState(this.config);
    this.matchId = options.matchId ?? `match-${this.now()}`;
  }

  /** The authoritative state. Only this object decides what is true. */
  get state(): GameState {
    return this.current;
  }

  get turns(): readonly AgentTurnRecord[] {
    return this.records;
  }

  /**
   * Is this decision still about the world we are in?
   *
   * The whole point of versioning the snapshot: an answer to an older
   * question must never be applied to a newer world.
   */
  isStale(request: Pick<DecisionRequest, "stateVersion">): boolean {
    return request.stateVersion !== this.current.version;
  }

  async playTurn(): Promise<AgentTurnRecord> {
    const state = this.current;
    if (state.status !== "running") {
      throw new Error(
        `Cannot play turn ${state.turn}: the match has already finished.`,
      );
    }

    // One snapshot. Both observations built before either agent is asked, so
    // neither can possibly see a world the other did not.
    const observations = {} as Record<PlayerId, AgentObservation>;
    const requests = {} as Record<PlayerId, DecisionRequest>;
    for (const id of PLAYER_IDS) {
      observations[id] = buildObservation(state, id, this.config);
      requests[id] = {
        agentId: id,
        turn: state.turn,
        stateVersion: state.version,
        observation: observations[id],
      };
    }

    // Launched together. Not "A, then B".
    const [a, b] = await Promise.all([
      this.collect(requests.A),
      this.collect(requests.B),
    ]);

    const decisions = { A: a.decision, B: b.decision };
    const traces = { A: a.trace, B: b.trace };

    const actions = {} as Record<PlayerId, Action>;
    for (const id of PLAYER_IDS) actions[id] = decisions[id].action;

    const resolution = resolveTurn(state, actions, this.config);

    const record: AgentTurnRecord = Object.freeze({
      turn: state.turn,
      stateVersion: state.version,
      observations,
      decisions,
      traces,
      resolution,
    });

    this.current = resolution.next;
    this.records.push(record);
    this.options.onTurn?.(record);
    return record;
  }

  async playMatch(): Promise<AgentMatchResult> {
    const startedAt = this.now();
    const initialState = this.current;

    // The turn cap guarantees termination; this guards a misconfiguration.
    const hardLimit = Math.max(1, this.config.maxTurns) + 1;

    while (this.current.status === "running") {
      if (this.records.length >= hardLimit) {
        throw new Error(
          `Match exceeded the hard turn limit of ${hardLimit}. Check GameConfig.maxTurns.`,
        );
      }
      await this.playTurn();
    }

    const completedAt = this.now();
    return Object.freeze({
      matchId: this.matchId,
      initialState,
      finalState: this.current,
      turns: Object.freeze([...this.records]),
      turnCount: this.records.length,
      winner: this.current.winner ?? null,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    });
  }

  // -------------------------------------------------------------------------

  private async collect(
    request: DecisionRequest,
  ): Promise<{ decision: AgentDecision; trace: DecisionTrace }> {
    const agent = this.agents[request.agentId];
    const requestStartedAt = this.now();
    const timeoutMs = this.options.decisionTimeoutMs;

    // Wrapped so a synchronous throw inside decide() becomes a rejection.
    const work = (async () => agent.decide(request.observation))();

    // If this ever settles after we have moved on, record it and drop it.
    // Without this, a late response is either lost silently or - worse -
    // applied to a state it was never about.
    void work.then(
      (late) => {
        if (this.isStale(request)) this.reportStale(request, late);
      },
      () => {
        /* Failures of an abandoned request are already traced below. */
      },
    );

    let decision: AgentDecision | undefined;
    let failure: Failure | undefined;

    try {
      const outcome =
        timeoutMs === undefined
          ? await work
          : await raceTimeout(work, timeoutMs);

      if (outcome === TIMED_OUT) {
        failure = {
          category: "TIMEOUT_ERROR",
          message: `Agent ${request.agentId} did not answer within ${timeoutMs} ms on turn ${request.turn}.`,
        };
      } else {
        decision = outcome;
      }
    } catch (error) {
      failure = {
        category: categorize(error),
        message: describeError(error),
      };
    }

    // The world must not have moved while we waited.
    if (decision && this.isStale(request)) {
      failure = {
        category: "STALE_DECISION",
        message: `Agent ${request.agentId} answered for state version ${request.stateVersion}, but the match is now at version ${this.current.version}.`,
      };
      decision = undefined;
    }

    // Structural check only. Game legality is the engine's job, and an
    // illegal-but-well-formed action is a legitimate thing for an agent to
    // attempt.
    if (decision && !isAction(decision.action)) {
      failure = {
        category: "INVALID_RESPONSE",
        message: `Agent ${request.agentId} returned something that is not a valid action: ${JSON.stringify(decision.action)}.`,
      };
      decision = undefined;
    }

    const requestCompletedAt = this.now();
    const resolved: AgentDecision = decision ?? {
      action: this.fallbackAction,
      origin: "fallback",
    };

    const trace: DecisionTrace = Object.freeze({
      turn: request.turn,
      agentId: request.agentId,
      stateVersion: request.stateVersion,
      requestStartedAt,
      requestCompletedAt,
      latencyMs: requestCompletedAt - requestStartedAt,
      action: resolved.action,
      origin: resolved.origin,
      ...(resolved.confidence === undefined
        ? {}
        : { confidence: resolved.confidence }),
      ...(resolved.probabilities?.[resolved.action.type] === undefined
        ? {}
        : { probability: resolved.probabilities[resolved.action.type] }),
      ...(resolved.model === undefined ? {} : { model: resolved.model }),
      ...(resolved.providerRequestId === undefined
        ? {}
        : { providerRequestId: resolved.providerRequestId }),
      ...(failure === undefined
        ? {}
        : { error: failure.message, errorCategory: failure.category }),
    });

    this.options.onTrace?.(trace);
    return { decision: resolved, trace };
  }

  private reportStale(request: DecisionRequest, late: AgentDecision): void {
    const at = this.now();
    this.options.onStaleDecision?.(
      Object.freeze({
        turn: request.turn,
        agentId: request.agentId,
        stateVersion: request.stateVersion,
        requestStartedAt: at,
        requestCompletedAt: at,
        latencyMs: 0,
        action: late.action,
        origin: late.origin,
        error: `Discarded: this answer is for state version ${request.stateVersion}, the match is at ${this.current.version}.`,
        errorCategory: "STALE_DECISION" as const,
      }),
    );
  }
}

export type RunAgentMatchOptions = OrchestratorOptions;

/** Convenience wrapper: build an orchestrator and play the match out. */
export async function runAgentMatch(
  agents: Record<PlayerId, Agent>,
  options: RunAgentMatchOptions = {},
): Promise<AgentMatchResult> {
  return new MatchOrchestrator(agents, options).playMatch();
}
