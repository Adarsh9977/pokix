/**
 * GET /api/config
 *
 * Tells the browser what this deployment can actually do, so the UI can say
 * "Jev is not configured here" up front instead of letting you press Start
 * and discover it through a failed request.
 *
 * It returns booleans and a mode name. It never returns the key, any part of
 * the key, or anything derived from it.
 */

import { hasApiKey, loadAgentMode } from "../config/env";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export interface ArenaClientConfig {
  /** The mode the UI should start in. */
  readonly agentMode: "mock" | "jev";
  /** Whether a key is present server-side. Never the key itself. */
  readonly jevConfigured: boolean;
  /** What AGENT_MODE asked for, before availability was taken into account. */
  readonly requestedMode: "mock" | "jev";
}

export default function handler(
  _request: VercelRequest,
  response: VercelResponse,
): void {
  let requestedMode: "mock" | "jev" = "mock";
  try {
    requestedMode = loadAgentMode();
  } catch {
    // A misspelled AGENT_MODE should not take the whole site down. Local
    // agents are always safe to fall back to.
    requestedMode = "mock";
  }

  const jevConfigured = hasApiKey();

  const body: ArenaClientConfig = {
    // Asking for jev without a key would start the match in a mode that
    // cannot work, so availability wins.
    agentMode: requestedMode === "jev" && jevConfigured ? "jev" : "mock",
    jevConfigured,
    requestedMode,
  };

  response.setHeader("cache-control", "no-store");
  response.status(200).json(body);
}
