/**
 * POST /api/decide
 *
 * The browser's only route to Jev. It exists so that the API key stays on the
 * server, per spec section 50.
 *
 * What it is: a stateless translator. Observation in, typed decision out.
 *
 * What it is deliberately *not*: authoritative. It holds no match state and
 * changes nothing. It returns an intention, and the engine running in the
 * caller validates that intention like any other before anything happens.
 * A client that lies in its observation can only mislead itself; it cannot
 * produce an illegal move, because legality is decided by the engine and not
 * here. See docs/ASSUMPTIONS.md A23.
 */

// Relative imports only. This file is bundled into a single self-contained
// function by scripts/build-vercel.ts, so nothing is left for the runtime to
// resolve. See docs/ASSUMPTIONS.md A24.
import { ArenaError, type AgentObservation } from "@jev-arena/types";
import { JevAgent } from "../agents/jev-agent";
import { hasApiKey, loadTypeSafeConfig } from "../config/env";
import { createTypeSafeGateway } from "../typesafe/gateway";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Reused across warm invocations so the SDK client is not rebuilt per call. */
let cachedAgent: JevAgent | undefined;

function agent(): JevAgent {
  if (!cachedAgent) {
    cachedAgent = new JevAgent(
      createTypeSafeGateway(loadTypeSafeConfig(), { timeoutMs: 20_000 }),
      { name: "Jev" },
    );
  }
  return cachedAgent;
}

/** Enough of a check to fail fast with a useful message. */
function isObservation(value: unknown): value is AgentObservation {
  if (value === null || typeof value !== "object") return false;
  const o = value as Partial<AgentObservation>;
  return (
    typeof o.turn === "number" &&
    typeof o.stateVersion === "number" &&
    Array.isArray(o.availableActions) &&
    o.availableActions.length > 0 &&
    typeof o.self === "object" &&
    typeof o.enemy === "object" &&
    Array.isArray(o.legalMoveDirections) &&
    Array.isArray(o.legalDodgeDirections)
  );
}

function fail(
  response: VercelResponse,
  status: number,
  category: string,
  message: string,
): void {
  response.status(status).json({ error: { category, message } });
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    fail(response, 405, "CONFIGURATION_ERROR", "Use POST.");
    return;
  }

  if (!hasApiKey()) {
    // The single most likely deployment mistake, so it gets its own message.
    fail(
      response,
      503,
      "CONFIGURATION_ERROR",
      "TYPESAFE_API_KEY is not set on the server. Add it in your Vercel project settings (Settings > Environment Variables) and redeploy. Local agents work without it.",
    );
    return;
  }

  const body =
    typeof request.body === "string"
      ? (JSON.parse(request.body) as Record<string, unknown>)
      : ((request.body ?? {}) as Record<string, unknown>);

  if (!isObservation(body.observation)) {
    fail(
      response,
      400,
      "INVALID_RESPONSE",
      "The request body must contain a valid `observation`.",
    );
    return;
  }

  try {
    const decision = await agent().decide(body.observation);
    // No caching: every turn is a fresh judgment about a new world.
    response.setHeader("cache-control", "no-store");
    response.status(200).json({ decision });
  } catch (error) {
    const arena =
      error instanceof ArenaError
        ? error
        : new ArenaError(
            "PROVIDER_ERROR",
            error instanceof Error ? error.message : "Unknown failure.",
          );

    const status =
      arena.category === "AUTHENTICATION_ERROR"
        ? 401
        : arena.category === "CREDIT_ERROR" || arena.category === "QUOTA_ERROR"
          ? 402
          : arena.category === "RATE_LIMIT_ERROR"
            ? 429
            : arena.category === "TIMEOUT_ERROR"
              ? 504
              : 502;

    // The provider's own words where we have them, never a credential.
    fail(
      response,
      status,
      arena.category,
      arena.providerMessage ?? arena.message,
    );
  }
}
