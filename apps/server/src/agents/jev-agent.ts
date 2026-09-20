/**
 * JevAgent: the Agent the game plays against, backed by a real model.
 *
 * It contains no game rules. It translates an observation into questions,
 * asks, translates the answers back, and returns an intention. Whether that
 * intention actually happens is entirely the engine's business.
 *
 * Failures are thrown as classified ArenaErrors. The orchestrator catches
 * them, records the category in the decision trace, and substitutes the
 * configured fallback, so a provider outage degrades a match rather than
 * ending it.
 */

import type { Agent } from "@jev-arena/agent-core";
import {
  STRATEGY_PROFILES,
  type AgentDecision,
  type AgentObservation,
  type StrategyProfile,
  type StrategyProfileId,
} from "@jev-arena/types";
import type { JevGateway } from "../typesafe/gateway";
import {
  buildDecisionQuestions,
  buildDecisionState,
  parseDecision,
} from "./jev-decision";

export interface JevAgentOptions {
  readonly name?: string;
  /** Changes the emphasis given to the model. Never changes the rules. */
  readonly profile?: StrategyProfileId | StrategyProfile;
  /** Per-request timeout handed to the SDK. */
  readonly timeoutMs?: number;
}

export class JevAgent implements Agent {
  readonly name: string;
  private readonly profile: StrategyProfile;

  constructor(
    private readonly gateway: JevGateway,
    private readonly options: JevAgentOptions = {},
  ) {
    this.profile =
      typeof options.profile === "string"
        ? STRATEGY_PROFILES[options.profile]
        : (options.profile ?? STRATEGY_PROFILES.neutral);
    this.name = options.name ?? `Jev (${this.profile.label})`;
  }

  async decide(observation: AgentObservation): Promise<AgentDecision> {
    const state = buildDecisionState(observation);
    const questions = buildDecisionQuestions(observation, this.profile);

    // One request per agent per turn. Never per frame, never per animation.
    const result = await this.gateway.ask(state, questions, {
      ...(this.options.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.options.timeoutMs }),
    });

    const parsed = parseDecision(observation, result.answers);

    return {
      action: parsed.action,
      origin: "model",
      confidence: parsed.confidence,
      probabilities: parsed.probabilities,
      model: result.model,
      providerLatencyMs: result.latencyMs,
      ...(result.requestId === undefined
        ? {}
        : { providerRequestId: result.requestId }),
    };
  }
}
