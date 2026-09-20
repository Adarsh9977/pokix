import type {
  JevAskResult,
  JevChoiceAnswer,
  JevChoiceQuestion,
  JevGateway,
} from "../src/typesafe/gateway";

export interface FakeGatewayOptions {
  readonly models?: string[];
  readonly listModelsError?: unknown;
  readonly askError?: unknown;
  readonly answer?: Partial<JevChoiceAnswer>;
  readonly latencyMs?: number;
  readonly model?: string;
  readonly inputTokens?: number;
}

/**
 * A JevGateway that never touches the network.
 *
 * Every test above the SDK boundary uses this, which is why the default test
 * run cannot spend a credit even by accident.
 */
export class FakeGateway implements JevGateway {
  readonly model: string;
  askCalls: { state: unknown; questions: readonly JevChoiceQuestion[] }[] = [];
  listModelsCalls = 0;
  /** Highest number of `ask` calls in flight at the same time. */
  maxConcurrent = 0;
  private inFlight = 0;

  constructor(private readonly options: FakeGatewayOptions = {}) {
    this.model = options.model ?? "jev-latest";
  }

  async listModels(): Promise<string[]> {
    this.listModelsCalls += 1;
    if (this.options.listModelsError) throw this.options.listModelsError;
    return this.options.models ?? ["jev-latest", "jev-preview"];
  }

  async ask(
    state: unknown,
    questions: readonly JevChoiceQuestion[],
  ): Promise<JevAskResult> {
    this.askCalls.push({ state, questions });
    this.inFlight += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (this.options.askError) throw this.options.askError;

      const answers: Record<string, JevChoiceAnswer> = {};
      for (const question of questions) {
        answers[question.id] = {
          choice: "ATTACK",
          confidence: 0.82,
          probabilities: {
            ATTACK: 0.91,
            MOVE: 0.05,
            DEFEND: 0.03,
            DODGE: 0.01,
          },
          ...this.options.answer,
        };
      }

      return {
        answers,
        model: this.options.model ?? "jev-1.13.0",
        usage: {
          inputTokens: this.options.inputTokens ?? 312,
          outputTokens: 34,
        },
        latencyMs: this.options.latencyMs ?? 742,
      };
    } finally {
      this.inFlight -= 1;
    }
  }
}
