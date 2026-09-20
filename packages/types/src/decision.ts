/**
 * What an agent hands back.
 *
 * A decision is an intention, not an effect. The engine still validates it and
 * may refuse it. `origin` records where the intention came from, so a mock's
 * certainty is never mistaken for a model's calibrated confidence.
 */

import type { Action, ActionType } from "./actions";

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
}
