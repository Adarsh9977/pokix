/**
 * The Jev playground.
 *
 * This is the project's most important checkpoint. Before any of the game is
 * wired to Jev, one command has to answer, honestly:
 *
 *   - Is the configuration present?
 *   - Does the API key authenticate?
 *   - Does a Jev request succeed?
 *   - Does it come back as a typed, bounded decision?
 *   - Is there a probability, and what does it actually look like?
 *   - What is the real latency?
 *   - Can we run two decisions concurrently, as a match will need to?
 *   - And if it fails: is it credentials, credit, quota, rate, network,
 *     or our own bad request?
 *
 * It must never report success it did not observe. In particular it does not
 * claim a credit balance, because TypeSafe does not publish one.
 *
 * The run is separated from the rendering so that all of this logic is
 * testable offline against a fake gateway.
 */

import {
  ArenaError,
  categorize,
  describeError,
  isActionType,
  type ActionType,
  type ErrorCategory,
} from "@jev-arena/types";
import { isBillingCategory } from "../typesafe/errors";
import type { JevChoiceQuestion, JevGateway } from "../typesafe/gateway";

/** The scenario from spec section 2, verbatim. */
export const PLAYGROUND_STATE = {
  agent: { hp: 80, energy: 40, position: { x: 4, y: 5 } },
  enemy: { hp: 60, position: { x: 5, y: 5 } },
  availableActions: ["ATTACK", "MOVE", "DEFEND", "DODGE"],
} as const;

/**
 * One narrow, bounded judgment.
 *
 * The model is asked what the agent should want, and nothing else. It is not
 * asked to compute damage, check range, or decide whether the move is legal;
 * code already knows all of that. Each option describes when it applies, so
 * the options separate from each other rather than relying on their names.
 */
export const PLAYGROUND_QUESTION: JevChoiceQuestion = {
  id: "action",
  instructions:
    "A tactical arena agent must choose one action for this turn. Given the agent's own health, energy and position, and the enemy's health and position, which action best serves the agent right now?",
  criteria: {
    ATTACK:
      "Strike the enemy. Only worthwhile when the enemy is close enough to hit and the agent can afford the energy.",
    MOVE: "Reposition by one tile, to close distance or to break away.",
    DEFEND:
      "Brace for impact. Costs nothing and reduces incoming damage, but deals none.",
    DODGE:
      "Spend energy to evade one tile, avoiding an incoming attack entirely if it breaks the enemy's reach.",
  },
};

export type CheckStatus = "pass" | "fail" | "skipped";

export interface PlaygroundCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail?: string;
}

export interface PlaygroundDecision {
  readonly action: string;
  /** Probability of the selected option. The spec's "probability: 0.91". */
  readonly probability: number;
  /** Distribution concentration, as reported by TypeSafe. */
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
  /** Whether the selected option is one of our four real action types. */
  readonly isKnownActionType: boolean;
}

export interface PlaygroundFailure {
  readonly category: ErrorCategory;
  readonly message: string;
  readonly providerMessage?: string;
  readonly providerRequestId?: string;
  readonly retryable: boolean;
}

export interface PlaygroundReport {
  readonly ok: boolean;
  readonly checks: readonly PlaygroundCheck[];
  readonly decision?: PlaygroundDecision;
  readonly latencyMs?: number;
  readonly model?: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly concurrency?: {
    readonly latencyMs: number;
    readonly bothSucceeded: boolean;
    readonly agreed: boolean;
  };
  readonly credits: { readonly status: string; readonly detail: string };
  readonly failure?: PlaygroundFailure;
}

export interface RunPlaygroundOptions {
  /**
   * Also fire two requests at once, to check that a real match's concurrent
   * A/B decisions will work. Two extra small requests.
   */
  readonly checkConcurrency?: boolean;
  readonly now?: () => number;
}

function toFailure(error: unknown): PlaygroundFailure {
  const arena = error instanceof ArenaError ? error : undefined;
  return {
    category: arena?.category ?? categorize(error),
    message: arena?.message ?? describeError(error),
    retryable: arena?.retryable ?? false,
    ...(arena?.providerMessage === undefined
      ? {}
      : { providerMessage: arena.providerMessage }),
    ...(arena?.providerRequestId === undefined
      ? {}
      : { providerRequestId: arena.providerRequestId }),
  };
}

export async function runPlayground(
  gateway: JevGateway,
  options: RunPlaygroundOptions = {},
): Promise<PlaygroundReport> {
  const now = options.now ?? Date.now;
  const checks: PlaygroundCheck[] = [
    { name: "Configuration", status: "pass", detail: "API key present" },
  ];

  // --- Authentication ------------------------------------------------------
  // GET /v1/models proves the key works without spending input tokens on it.
  let models: string[];
  try {
    models = await gateway.listModels();
    checks.push({
      name: "Authentication",
      status: "pass",
      detail: `${models.length} model(s) available: ${models.join(", ")}`,
    });
  } catch (error) {
    const failure = toFailure(error);
    checks.push({
      name: "Authentication",
      status: "fail",
      detail: failure.message,
    });
    checks.push({ name: "Jev request", status: "skipped" });
    checks.push({ name: "Typed decision", status: "skipped" });
    return {
      ok: false,
      checks,
      credits: creditsFor(failure),
      failure,
    };
  }

  // --- One real Jev request ------------------------------------------------
  const startedAt = now();
  try {
    const result = await gateway.ask(PLAYGROUND_STATE, [PLAYGROUND_QUESTION]);
    const answer = result.answers[PLAYGROUND_QUESTION.id]!;
    const latencyMs = result.latencyMs || now() - startedAt;

    checks.push({
      name: "Jev request",
      status: "pass",
      detail: `${latencyMs} ms via ${result.model}`,
    });

    const probability = answer.probabilities[answer.choice] ?? 0;
    const isKnownActionType = isActionType(answer.choice);

    checks.push({
      name: "Typed decision",
      status: isKnownActionType ? "pass" : "fail",
      detail: isKnownActionType
        ? `"${answer.choice}" is one of the four arena actions`
        : `"${answer.choice}" is not one of the four arena actions`,
    });

    const report: Omit<PlaygroundReport, "ok" | "concurrency"> = {
      checks,
      decision: {
        action: answer.choice,
        probability,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        isKnownActionType,
      },
      latencyMs,
      model: result.model,
      usage: result.usage,
      // Evidence-based, not invented: the request was accepted and metered.
      credits: {
        status: "accepted",
        detail: `The request was accepted and billed ${result.usage.inputTokens} input tokens. TypeSafe does not publish a balance endpoint, so a remaining credit figure cannot be reported.`,
      },
    };

    if (options.checkConcurrency !== true) {
      return { ...report, ok: isKnownActionType, checks };
    }

    // --- Two at once, as a real turn will do -------------------------------
    const concurrentStart = now();
    try {
      const [first, second] = await Promise.all([
        gateway.ask(PLAYGROUND_STATE, [PLAYGROUND_QUESTION]),
        gateway.ask(PLAYGROUND_STATE, [PLAYGROUND_QUESTION]),
      ]);
      const concurrencyLatency = now() - concurrentStart;
      const agreed =
        first.answers[PLAYGROUND_QUESTION.id]!.choice ===
        second.answers[PLAYGROUND_QUESTION.id]!.choice;

      checks.push({
        name: "Concurrent decisions",
        status: "pass",
        detail: `two simultaneous requests in ${concurrencyLatency} ms; answers ${agreed ? "agreed" : "differed"}`,
      });

      return {
        ...report,
        ok: isKnownActionType,
        checks,
        concurrency: {
          latencyMs: concurrencyLatency,
          bothSucceeded: true,
          agreed,
        },
      };
    } catch (error) {
      const failure = toFailure(error);
      checks.push({
        name: "Concurrent decisions",
        status: "fail",
        detail: failure.message,
      });
      return {
        ...report,
        ok: false,
        checks,
        failure,
        concurrency: { latencyMs: 0, bothSucceeded: false, agreed: false },
      };
    }
  } catch (error) {
    const failure = toFailure(error);
    checks.push({
      name: "Jev request",
      status: "fail",
      detail: failure.message,
    });
    checks.push({ name: "Typed decision", status: "skipped" });
    return { ok: false, checks, credits: creditsFor(failure), failure };
  }
}

function creditsFor(failure: PlaygroundFailure): {
  status: string;
  detail: string;
} {
  if (isBillingCategory(failure.category)) {
    return {
      status: "blocked",
      detail:
        failure.providerMessage ??
        "The provider refused the request for billing or quota reasons.",
    };
  }
  return {
    status: "unknown",
    detail:
      "No request reached the model, so nothing can be established about credit or quota.",
  };
}

/** The action types the playground offers, for reuse by the renderer. */
export const PLAYGROUND_OPTIONS = Object.keys(
  PLAYGROUND_QUESTION.criteria,
) as ActionType[];
