/**
 * Server-side configuration.
 *
 * The API key is read here and nowhere else. It is never logged, never
 * included in an error message, never returned from an API handler and never
 * sent to the browser. Everything downstream receives a configured client,
 * not the key.
 */

import { ArenaError } from "@jev-arena/types";

/** The SDK's own environment variable names, from its `ENV` export. */
export const ENV_VARS = {
  apiKey: "TYPESAFE_API_KEY",
  baseURL: "TYPESAFE_BASE_URL",
  defaultModel: "TYPESAFE_DEFAULT_MODEL",
  logLevel: "TYPESAFE_LOG_LEVEL",
  agentMode: "AGENT_MODE",
  liveTests: "RUN_LIVE_JEV_TESTS",
} as const;

export const AGENT_MODES = ["mock", "jev"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export interface TypeSafeConfig {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly defaultModel?: string;
  readonly logLevel?: string;
}

export interface ServerConfig {
  readonly agentMode: AgentMode;
  readonly typesafe?: TypeSafeConfig;
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** True when a usable-looking key is present. Says nothing about validity. */
export function hasApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return read(env, ENV_VARS.apiKey) !== undefined;
}

/**
 * Reads the TypeSafe configuration, or explains precisely what is missing.
 *
 * Throws a CONFIGURATION_ERROR rather than returning a half-built config, so
 * a missing key fails at startup instead of at the first API call.
 */
export function loadTypeSafeConfig(
  env: NodeJS.ProcessEnv = process.env,
): TypeSafeConfig {
  const apiKey = read(env, ENV_VARS.apiKey);

  if (apiKey === undefined) {
    throw new ArenaError(
      "CONFIGURATION_ERROR",
      `${ENV_VARS.apiKey} is not set. Copy .env.example to .env and add your TypeSafe API key, or export ${ENV_VARS.apiKey} in your shell.`,
    );
  }

  const baseURL = read(env, ENV_VARS.baseURL);
  const defaultModel = read(env, ENV_VARS.defaultModel);
  const logLevel = read(env, ENV_VARS.logLevel);

  return {
    apiKey,
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    ...(logLevel === undefined ? {} : { logLevel }),
  };
}

export function loadAgentMode(env: NodeJS.ProcessEnv = process.env): AgentMode {
  const raw = read(env, ENV_VARS.agentMode)?.toLowerCase() ?? "mock";
  if ((AGENT_MODES as readonly string[]).includes(raw)) return raw as AgentMode;

  throw new ArenaError(
    "CONFIGURATION_ERROR",
    `${ENV_VARS.agentMode} must be one of ${AGENT_MODES.join(", ")}, but is "${raw}".`,
  );
}

export function liveTestsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return read(env, ENV_VARS.liveTests)?.toLowerCase() === "true";
}

/**
 * A redacted description of the configuration, safe to print.
 *
 * The key is reported as present or absent and never rendered, not even
 * partially masked. A masked key still leaks its length and its prefix.
 */
export function describeConfig(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    [ENV_VARS.apiKey]: hasApiKey(env) ? "set" : "missing",
    [ENV_VARS.baseURL]: read(env, ENV_VARS.baseURL) ?? "default",
    [ENV_VARS.defaultModel]: read(env, ENV_VARS.defaultModel) ?? "default",
    [ENV_VARS.agentMode]: read(env, ENV_VARS.agentMode) ?? "mock",
  };
}
