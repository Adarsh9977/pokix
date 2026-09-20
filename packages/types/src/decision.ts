/**
 * What an agent hands back.
 *
 * A decision is an intention, not an effect. The engine still validates it and
 * may refuse it. `origin` records where the intention came from, so a mock's
 * certainty is never mistaken for a model's calibrated confidence.
 */

import type { Action, ActionType } from "./actions";
import type { ErrorCategory } from "./errors";
import type { AgentObservation } from "./observation";
import type { PlayerId } from "./state";

export const DECISION_ORIGINS = [
  /** A deterministic local agent. Carries no confidence, because it has none. */
  "mock",
  /** A real System One judgment. */
  "model",
  /** The engine's own safe default, after a timeout or an unusable response. */
  "fallback",
] as const;

export type DecisionOrigin = (typeof DECISION_ORIGINS)[number];

export interface AgentDecision {
  readonly action: Action;
  readonly origin: DecisionOrigin;
  /**
   * Model confidence, when the source actually produced one.
   *
   * Absent for mock and fallback decisions. This is deliberate: the spec's
   * illustrative MockAgent returns `confidence: 1`, but a fabricated 1.0 would
   * be indistinguishable from a genuinely certain model answer in the HUD and
   * in the analytics. Absence is the honest value.
   */
  readonly confidence?: number;
  /** The full distribution over action types, when available. */
  readonly probabilities?: Readonly<Partial<Record<ActionType, number>>>;
  /**
   * Provider metadata, when the decision came from one.
   *
   * The orchestrator copies these into the DecisionTrace. It cannot discover
   * them itself, because it deliberately knows nothing about providers.
   */
  readonly model?: string;
  readonly providerRequestId?: string;
  /** Latency the adapter measured, which excludes orchestrator overhead. */
  readonly providerLatencyMs?: number;
}

/**
 * A decision asked for, tied to the exact snapshot it was asked about.
 *
 * `turn` and `stateVersion` travel with the request so that an answer can be
 * matched back to the world it was an answer to. An asynchronous API response
 * that arrives after the world has moved on is not a decision, it is history.
 */
export interface DecisionRequest {
  readonly agentId: PlayerId;
  readonly turn: number;
  readonly stateVersion: number;
  readonly observation: AgentObservation;
}

/**
 * The audit record for one decision.
 *
 * Written for every decision, including failures and fallbacks, so that the
 * analytics and the replay never have to guess why an agent did something.
 * Deliberately contains no credentials and no prompt text.
 */
export interface DecisionTrace {
  readonly turn: number;
  readonly agentId: PlayerId;
  readonly stateVersion: number;
  readonly requestStartedAt: number;
  readonly requestCompletedAt: number;
  readonly latencyMs: number;
  /** The action that was actually submitted to the engine. */
  readonly action: Action;
  readonly origin: DecisionOrigin;
  /** Probability of the chosen action, when the source reported one. */
  readonly probability?: number;
  readonly confidence?: number;
  readonly providerRequestId?: string;
  readonly model?: string;
  readonly error?: string;
  readonly errorCategory?: ErrorCategory;
}
