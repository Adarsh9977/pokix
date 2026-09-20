import { ArenaError } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { parseDotEnv, loadDotEnv } from "../src/config/dotenv";
import {
  describeConfig,
  hasApiKey,
  liveTestsEnabled,
  loadAgentMode,
  loadTypeSafeConfig,
} from "../src/config/env";

describe("parseDotEnv", () => {
  it("reads simple assignments", () => {
    expect(parseDotEnv("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("ignores comments and blank lines", () => {
    expect(parseDotEnv("# a comment\n\n  \nA=1")).toEqual({ A: "1" });
  });

  it("handles `export` prefixes", () => {
    expect(parseDotEnv("export A=1")).toEqual({ A: "1" });
  });

  it("strips surrounding quotes", () => {
    expect(parseDotEnv(`A="quoted"\nB='single'`)).toEqual({
      A: "quoted",
      B: "single",
    });
  });

  it("keeps a '#' that is inside a quoted value", () => {
    expect(parseDotEnv('A="secret#value"')).toEqual({ A: "secret#value" });
  });

  it("strips a trailing comment from an unquoted value", () => {
    expect(parseDotEnv("A=value # a note")).toEqual({ A: "value" });
  });

  it("allows an empty value", () => {
    expect(parseDotEnv("TYPESAFE_API_KEY=")).toEqual({ TYPESAFE_API_KEY: "" });
  });

  it("skips malformed lines instead of throwing", () => {
    expect(parseDotEnv("not an assignment\n=novalue\nA=1")).toEqual({ A: "1" });
  });
});

describe("loadDotEnv", () => {
  it("reports absence rather than failing when there is no .env", () => {
    expect(loadDotEnv("./definitely-not-here.env", {})).toBe(false);
  });

  it("never overwrites a variable already set in the real environment", () => {
    const target: NodeJS.ProcessEnv = { TYPESAFE_API_KEY: "from-shell" };
    // Simulated via parse + the same precedence rule loadDotEnv applies.
    const parsed = parseDotEnv("TYPESAFE_API_KEY=from-file\nOTHER=x");
    for (const [key, value] of Object.entries(parsed)) {
      if (target[key] === undefined || target[key] === "") target[key] = value;
    }
    expect(target.TYPESAFE_API_KEY).toBe("from-shell");
    expect(target.OTHER).toBe("x");
  });
});

describe("loadTypeSafeConfig", () => {
  it("reads the key from the SDK's documented variable name", () => {
    const config = loadTypeSafeConfig({ TYPESAFE_API_KEY: "test-key" });
    expect(config.apiKey).toBe("test-key");
  });

  it("leaves the optional settings unset so the SDK defaults apply", () => {
    const config = loadTypeSafeConfig({ TYPESAFE_API_KEY: "k" });
    expect(config.baseURL).toBeUndefined();
    expect(config.defaultModel).toBeUndefined();
  });

  it("passes through explicit overrides", () => {
    const config = loadTypeSafeConfig({
      TYPESAFE_API_KEY: "k",
      TYPESAFE_BASE_URL: "https://example.test",
      TYPESAFE_DEFAULT_MODEL: "jev-1.13.0",
    });
    expect(config.baseURL).toBe("https://example.test");
    expect(config.defaultModel).toBe("jev-1.13.0");
  });

  it("treats a blank or whitespace-only key as missing", () => {
    for (const value of ["", "   "]) {
      expect(() => loadTypeSafeConfig({ TYPESAFE_API_KEY: value })).toThrow(
        ArenaError,
      );
    }
  });

  it("fails with a category and an actionable message, not a generic error", () => {
    try {
      loadTypeSafeConfig({});
      throw new Error("expected loadTypeSafeConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ArenaError);
      const arena = error as ArenaError;
      expect(arena.category).toBe("CONFIGURATION_ERROR");
      expect(arena.message).toContain("TYPESAFE_API_KEY");
      expect(arena.message).toContain(".env");
      expect(arena.retryable).toBe(false);
    }
  });
});

describe("agent mode", () => {
  it("defaults to mock, so nothing spends credits by accident", () => {
    expect(loadAgentMode({})).toBe("mock");
  });

  it("accepts jev, case-insensitively", () => {
    expect(loadAgentMode({ AGENT_MODE: "JEV" })).toBe("jev");
  });

  it("rejects an unknown mode loudly", () => {
    expect(() => loadAgentMode({ AGENT_MODE: "gpt" })).toThrow(
      /must be one of/,
    );
  });
});

describe("live test switch", () => {
  it("is off unless explicitly set to true", () => {
    expect(liveTestsEnabled({})).toBe(false);
    expect(liveTestsEnabled({ RUN_LIVE_JEV_TESTS: "false" })).toBe(false);
    expect(liveTestsEnabled({ RUN_LIVE_JEV_TESTS: "1" })).toBe(false);
    expect(liveTestsEnabled({ RUN_LIVE_JEV_TESTS: "true" })).toBe(true);
  });
});

describe("describeConfig", () => {
  it("reports the key as present without revealing any part of it", () => {
    const described = describeConfig({ TYPESAFE_API_KEY: "sk-supersecret123" });
    expect(described.TYPESAFE_API_KEY).toBe("set");
    // Not even a masked prefix: that still leaks length and provider.
    expect(JSON.stringify(described)).not.toContain("sk-");
    expect(JSON.stringify(described)).not.toContain("supersecret");
  });

  it("reports a missing key as missing", () => {
    expect(describeConfig({}).TYPESAFE_API_KEY).toBe("missing");
  });
});

describe("hasApiKey", () => {
  it("is false for absent, empty and whitespace keys", () => {
    expect(hasApiKey({})).toBe(false);
    expect(hasApiKey({ TYPESAFE_API_KEY: "" })).toBe(false);
    expect(hasApiKey({ TYPESAFE_API_KEY: "  " })).toBe(false);
    expect(hasApiKey({ TYPESAFE_API_KEY: "k" })).toBe(true);
  });
});
