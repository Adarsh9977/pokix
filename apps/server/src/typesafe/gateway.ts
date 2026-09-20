/**
 * The only file in the project that imports the TypeSafe SDK.
 *
 * Everything else talks to `JevGateway`. That keeps the provider replaceable,
 * keeps the API key inside one module, and - most usefully - lets every test
 * above this line run offline against a fake gateway instead of mocking HTTP.
 *
 * Request shape follows the documented API: one `state`, a map of named
 * questions, answers returned under the same names. Independent questions go
 * in a single call, because Jev evaluates them in parallel against one
 * ingestion of the state; that is both faster and cheaper than one call each.
 */

import { TypeSafeClient, choice, type EntryType } from "@typesafe-ai/sdk";
import { ArenaError } from "@jev-arena/types";
import type { TypeSafeConfig } from "../config/env";
import { classifyTypeSafeError } from "./errors";

/** A bounded choice, in our own vocabulary rather than the SDK's. */
export interface JevChoiceQuestion {
  /** Our key. Never sent to the model; the answer comes back under it. */
  readonly id: string;
  readonly instructions: EntryType;
  /** Option name -> description, or null when the name speaks for itself. */
  readonly criteria: Readonly<Record<string, string | null>>;
}

export interface JevChoiceAnswer {
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface JevAskResult {
  readonly answers: Readonly<Record<string, JevChoiceAnswer>>;
  /** The versioned model that actually answered, e.g. "jev-1.13.0". */
  readonly model: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly latencyMs: number;
  readonly requestId?: string;
}

export interface JevAskOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface JevGateway {
  /** The model alias this gateway will ask for. */
  readonly model: string;
  /** Cheap authentication probe: lists models without spending input tokens. */
  listModels(): Promise<string[]>;
  ask(
    state: unknown,
    questions: readonly JevChoiceQuestion[],
    options?: JevAskOptions,
  ): Promise<JevAskResult>;
}

function asChoiceAnswer(id: string, value: unknown): JevChoiceAnswer {
  const answer = value as Partial<JevChoiceAnswer> & { type?: string };

  if (
    answer === null ||
    typeof answer !== "object" ||
    answer.type !== "choice" ||
    typeof answer.choice !== "string" ||
    typeof answer.confidence !== "number" ||
    answer.probabilities === null ||
    typeof answer.probabilities !== "object"
  ) {
    throw new ArenaError(
      "INVALID_RESPONSE",
      `TypeSafe returned an answer for "${id}" that is not a usable choice.`,
    );
  }

  return {
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
  };
}

export interface TypeSafeGatewayOptions {
  /** Per-attempt timeout in ms. The SDK default is 10000. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export function createTypeSafeGateway(
  config: TypeSafeConfig,
  options: TypeSafeGatewayOptions = {},
): JevGateway {
  const now = options.now ?? Date.now;

  // The key is handed to the SDK here and is not stored anywhere else.
  const client = new TypeSafeClient({
    apiKey: config.apiKey,
    ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
    ...(config.defaultModel === undefined
      ? {}
      : { defaultModel: config.defaultModel }),
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });

  return {
    model: client.defaultModel,

    async listModels(): Promise<string[]> {
      try {
        const models = await client.models.list();
        return models.map((model) => model.name);
      } catch (error) {
        throw classifyTypeSafeError(error);
      }
    },

    async ask(state, questions, askOptions = {}): Promise<JevAskResult> {
      if (questions.length === 0) {
        throw new ArenaError(
          "INTERNAL_GAME_ERROR",
          "Refusing to call TypeSafe with no questions.",
        );
      }

      const payload = Object.fromEntries(
        questions.map((question) => [
          question.id,
          choice(question.instructions, question.criteria),
        ]),
      );

      const startedAt = now();
      try {
        const { data, requestId } = await client
          .systemOne(
            { state: state as EntryType, questions: payload },
            {
              ...(askOptions.timeoutMs === undefined
                ? {}
                : { timeout: askOptions.timeoutMs }),
              ...(askOptions.signal === undefined
                ? {}
                : { signal: askOptions.signal }),
            },
          )
          .withResponse();

        const answers: Record<string, JevChoiceAnswer> = {};
        for (const question of questions) {
          const raw = (data.answers as Record<string, unknown>)[question.id];
          if (raw === undefined) {
            throw new ArenaError(
              "INVALID_RESPONSE",
              `TypeSafe did not answer the question "${question.id}".`,
            );
          }
          answers[question.id] = asChoiceAnswer(question.id, raw);
        }

        return {
          answers,
          model: data.model,
          usage: {
            inputTokens: data.usage.input_tokens,
            outputTokens: data.usage.output_tokens,
          },
          latencyMs: now() - startedAt,
          ...(requestId === undefined ? {} : { requestId }),
        };
      } catch (error) {
        throw classifyTypeSafeError(error);
      }
    },
  };
}
