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
import {
  ArenaError,
  isStrategyProfileId,
  type AgentObservation,
  type StrategyProfileId,
} from "@jev-arena/types";
import { JevAgent } from "../agents/jev-agent";
import { hasApiKey, loadTypeSafeConfig } from "../config/env";
import { createTypeSafeGateway, type JevGateway } from "../typesafe/gateway";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Reused across warm invocations so the SDK client is not rebuilt per call. */
let cachedGateway: JevGateway | undefined;
const cachedAgents = new Map<StrategyProfileId, JevAgent>();

function agent(profile: StrategyProfileId): JevAgent {
  if (!cachedGateway) {
    cachedGateway = createTypeSafeGateway(loadTypeSafeConfig(), {
      timeoutMs: 20_000,
    });
  }
  let existing = cachedAgents.get(profile);
  if (!existing) {
    existing = new JevAgent(cachedGateway, { profile });
    cachedAgents.set(profile, existing);
  }
  return existing;
}

/**
 * Validates every field the decision builder will read.
 *
 * Deliberately exhaustive rather than "enough to look right". A partial
 * observation used to sail past a looser guard and then throw deep inside
 * the agent, which surfaced as an opaque 502 instead of a 400 naming the
 * problem. Anything this function misses becomes a crash, so it checks the
 * whole contract.
 */
function missingObservationFields(value: unknown): string[] {
  if (value === null || typeof value !== "object") return ["observation"];
  const o = value as Partial<AgentObservation>;
  const missing: string[] = [];

  const need = (ok: boolean, field: string) => {
    if (!ok) missing.push(field);
  };

  need(typeof o.turn === "number", "turn");
  need(typeof o.stateVersion === "number", "stateVersion");
  need(typeof o.self === "object" && o.self !== null, "self");
  need(typeof o.enemy === "object" && o.enemy !== null, "enemy");
  need(
    Array.isArray(o.availableActions) && o.availableActions.length > 0,
    "availableActions",
  );
  need(Array.isArray(o.legalMoveDirections), "legalMoveDirections");
  need(Array.isArray(o.legalDodgeDirections), "legalDodgeDirections");
  need(typeof o.distanceToEnemy === "number", "distanceToEnemy");
  need(typeof o.attackRange === "number", "attackRange");
  need(typeof o.enemyInAttackRange === "boolean", "enemyInAttackRange");
  need(typeof o.hasLineOfSightToEnemy === "boolean", "hasLineOfSightToEnemy");
  need(typeof o.isBehindCover === "boolean", "isBehindCover");
  need(typeof o.standingOnEnergyNode === "boolean", "standingOnEnergyNode");
  need(Array.isArray(o.energyNodes), "energyNodes");
  need(
    typeof o.environment === "object" && o.environment !== null,
    "environment",
  );

  return missing;
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

  const missing = missingObservationFields(body.observation);
  if (missing.length > 0) {
    fail(
      response,
      400,
      "INVALID_RESPONSE",
      `The request body needs a complete \`observation\`. Missing or malformed: ${missing.join(", ")}.`,
    );
    return;
  }
  const observation = body.observation as AgentObservation;

  // An unknown profile falls back to neutral rather than failing the turn:
  // a bad preference is not worth losing a match over.
  const profile: StrategyProfileId = isStrategyProfileId(body.profile)
    ? body.profile
    : "neutral";

  try {
    const decision = await agent(profile).decide(observation);
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
