import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  RateLimitError,
  UnprocessableEntityError,
} from "@typesafe-ai/sdk";
import { ArenaError } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import {
  classifyTypeSafeError,
  providerMessageOf,
} from "../src/typesafe/errors";

const headers = (extra: Record<string, string> = {}) => new Headers(extra);

describe("HTTP status classification", () => {
  it("maps 401 to an authentication error that points at the key", () => {
    const arena = classifyTypeSafeError(
      new AuthenticationError(401, { message: "Invalid API key" }, headers()),
    );
    expect(arena.category).toBe("AUTHENTICATION_ERROR");
    expect(arena.message).toContain("TYPESAFE_API_KEY");
    expect(arena.retryable).toBe(false);
  });

  it("maps 429 to a retryable rate limit", () => {
    const arena = classifyTypeSafeError(
      new RateLimitError(429, { message: "Too many requests" }, headers()),
    );
    expect(arena.category).toBe("RATE_LIMIT_ERROR");
    expect(arena.retryable).toBe(true);
  });

  it("reads a 429 that is really an allowance problem as a quota error", () => {
    const arena = classifyTypeSafeError(
      new RateLimitError(
        429,
        { message: "You have exceeded your monthly quota" },
        headers(),
      ),
    );
    expect(arena.category).toBe("QUOTA_ERROR");
    // Backing off will not refill an allowance.
    expect(arena.retryable).toBe(false);
  });

  it("reads a billing refusal as a credit error", () => {
    const arena = classifyTypeSafeError(
      APIError.fromResponse(
        403,
        { message: "Insufficient credit on this account" },
        headers(),
      ),
    );
    expect(arena.category).toBe("CREDIT_ERROR");
    expect(arena.retryable).toBe(false);
  });

  it("maps 402 to a credit error", () => {
    const arena = classifyTypeSafeError(
      APIError.fromResponse(402, { message: "Payment required" }, headers()),
    );
    expect(arena.category).toBe("CREDIT_ERROR");
  });

  it("blames us, not the credentials, for a rejected request body", () => {
    const arena = classifyTypeSafeError(
      new UnprocessableEntityError(
        422,
        { message: "questions must not be empty" },
        headers(),
      ),
    );
    expect(arena.category).toBe("CONFIGURATION_ERROR");
    expect(arena.message).toMatch(/bug on our side/i);
  });

  it("treats 529 overloaded as retryable, per the docs", () => {
    const arena = classifyTypeSafeError(
      APIError.fromResponse(529, { message: "Overloaded" }, headers()),
    );
    expect(arena.retryable).toBe(true);
  });

  it("does not guess at an unknown status", () => {
    const arena = classifyTypeSafeError(
      APIError.fromResponse(418, { message: "I am a teapot" }, headers()),
    );
    expect(arena.category).toBe("PROVIDER_ERROR");
  });
});

describe("transport failures", () => {
  it("maps a timeout to TIMEOUT_ERROR with the configured duration", () => {
    const arena = classifyTypeSafeError(new APITimeoutError(9000));
    expect(arena.category).toBe("TIMEOUT_ERROR");
    expect(arena.message).toContain("9000 ms");
  });

  it("maps a connection failure to a retryable network error", () => {
    const arena = classifyTypeSafeError(
      new APIConnectionError("getaddrinfo ENOTFOUND api.typesafe.ai"),
    );
    expect(arena.category).toBe("NETWORK_ERROR");
    expect(arena.retryable).toBe(true);
  });
});

describe("preserving the provider's message", () => {
  it("keeps the provider text alongside our own headline", () => {
    const arena = classifyTypeSafeError(
      new AuthenticationError(
        401,
        { message: "The supplied key has been revoked" },
        headers(),
      ),
    );
    expect(arena.providerMessage).toBe("The supplied key has been revoked");
    expect(arena.message).not.toBe(arena.providerMessage);
  });

  it("keeps the provider request id when there is one", () => {
    const arena = classifyTypeSafeError(
      APIError.fromResponse(
        500,
        { message: "boom" },
        headers({ "x-typesafe-request-id": "req_xyz" }),
      ),
    );
    expect(arena.providerRequestId).toBe("req_xyz");
  });

  it("reads a plain string body", () => {
    expect(
      providerMessageOf(
        APIError.fromResponse(500, "upstream exploded", headers()),
      ),
    ).toBe("upstream exploded");
  });

  it("reads a nested error object", () => {
    expect(
      providerMessageOf(
        APIError.fromResponse(
          400,
          { error: { message: "bad field" } },
          headers(),
        ),
      ),
    ).toBe("bad field");
  });
});

describe("pass-through and fallbacks", () => {
  it("leaves an ArenaError alone", () => {
    const original = new ArenaError("CREDIT_ERROR", "no credit");
    expect(classifyTypeSafeError(original)).toBe(original);
  });

  it("wraps an ordinary Error rather than losing it", () => {
    const arena = classifyTypeSafeError(new Error("unexpected"));
    expect(arena.category).toBe("PROVIDER_ERROR");
    expect(arena.message).toBe("unexpected");
  });

  it("survives a thrown non-Error", () => {
    const arena = classifyTypeSafeError("just a string");
    expect(arena).toBeInstanceOf(ArenaError);
    expect(arena.category).toBe("PROVIDER_ERROR");
  });

  it("always produces a specific, actionable headline", () => {
    // Even with an empty provider body, our own message has to say something
    // a developer can act on. Section 46 forbids "something went wrong".
    for (const error of [
      new AuthenticationError(401, {}, headers()),
      new RateLimitError(429, {}, headers()),
      new APITimeoutError(1000),
      new APIConnectionError("ECONNRESET"),
    ]) {
      const { message } = classifyTypeSafeError(error);
      expect(message).not.toMatch(/something went wrong/i);
      expect(message.length).toBeGreaterThan(20);
    }
  });

  it("preserves an arbitrary error's own message verbatim", () => {
    expect(classifyTypeSafeError(new Error("x")).message).toBe("x");
  });
});
