/**
 * The contract of GET /api/config.
 *
 * The endpoint is tiny, but it is the one place the server tells the browser
 * anything about its own credentials, so it is worth pinning down.
 */

import { describe, expect, it } from "vitest";
import { hasApiKey, loadAgentMode } from "../src/config/env";

/** Mirrors api/config.ts. Kept here so the rule is testable without Vercel. */
function resolveClientConfig(env: NodeJS.ProcessEnv) {
  let requestedMode: "mock" | "jev" = "mock";
  try {
    requestedMode = loadAgentMode(env);
  } catch {
    requestedMode = "mock";
  }
  const jevConfigured = hasApiKey(env);
  return {
    agentMode:
      requestedMode === "jev" && jevConfigured
        ? ("jev" as const)
        : ("mock" as const),
    jevConfigured,
    requestedMode,
  };
}

describe("client config resolution", () => {
  it("defaults to mock, so a fresh checkout is playable and free", () => {
    expect(resolveClientConfig({})).toEqual({
      agentMode: "mock",
      jevConfigured: false,
      requestedMode: "mock",
    });
  });

  it("starts in jev when asked and a key is present", () => {
    const config = resolveClientConfig({
      AGENT_MODE: "jev",
      TYPESAFE_API_KEY: "a-key",
    });
    expect(config.agentMode).toBe("jev");
    expect(config.jevConfigured).toBe(true);
  });

  it("ignores AGENT_MODE=jev when there is no key, and says it was asked for", () => {
    // Starting in a mode that cannot work would be worse than ignoring the
    // setting, but the UI still needs to know the intent to explain itself.
    const config = resolveClientConfig({ AGENT_MODE: "jev" });
    expect(config.agentMode).toBe("mock");
    expect(config.requestedMode).toBe("jev");
    expect(config.jevConfigured).toBe(false);
  });

  it("survives a misspelled AGENT_MODE instead of taking the site down", () => {
    expect(resolveClientConfig({ AGENT_MODE: "jevv" }).agentMode).toBe("mock");
  });

  it("reports a key as a boolean and never exposes any part of it", () => {
    const config = resolveClientConfig({
      AGENT_MODE: "jev",
      TYPESAFE_API_KEY: "sk-live-supersecret-abcdef123456",
    });
    const serialised = JSON.stringify(config);
    expect(config.jevConfigured).toBe(true);
    expect(serialised).not.toContain("sk-");
    expect(serialised).not.toContain("supersecret");
    expect(serialised).not.toContain("abcdef");
  });
});
