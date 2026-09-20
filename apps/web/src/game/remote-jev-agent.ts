/**
 * An Agent that asks the server to ask Jev.
 *
 * The browser never sees the API key, and never talks to TypeSafe. It sends
 * an observation to our own serverless function and gets a typed decision
 * back. The function is stateless and cannot change the game: it only ever
 * returns an intention, which the engine in this tab then validates like any
 * other.
 */

import type { Agent } from "@jev-arena/agent-core";
import {
  ArenaError,
  type AgentDecision,
  type AgentObservation,
} from "@jev-arena/types";

export interface DecideResponseBody {
  decision?: AgentDecision;
  error?: { category?: string; message?: string };
}

export interface RemoteJevAgentOptions {
  readonly name: string;
  readonly profile?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

export class RemoteJevAgent implements Agent {
  readonly name: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RemoteJevAgentOptions) {
    this.name = options.name;
    this.endpoint = options.endpoint ?? "/api/decide";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async decide(observation: AgentObservation): Promise<AgentDecision> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observation,
          profile: this.options.profile ?? "neutral",
        }),
      });
    } catch (cause) {
      throw new ArenaError(
        "NETWORK_ERROR",
        "Could not reach the decision endpoint. Is the server running?",
        { cause },
      );
    }

    let body: DecideResponseBody;
    try {
      body = (await response.json()) as DecideResponseBody;
    } catch (cause) {
      throw new ArenaError(
        "INVALID_RESPONSE",
        `The decision endpoint returned a non-JSON response (HTTP ${response.status}).`,
        { cause },
      );
    }

    if (!response.ok || body.error || !body.decision) {
      // The server has already classified this; carry the category through
      // so the HUD can say what actually went wrong.
      throw new ArenaError(
        (body.error?.category as never) ?? "PROVIDER_ERROR",
        body.error?.message ??
          `The decision endpoint failed with HTTP ${response.status}.`,
      );
    }

    return body.decision;
  }
}
