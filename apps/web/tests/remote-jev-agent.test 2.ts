import { DEFAULT_GAME_CONFIG, ArenaError, attack } from "@jev-arena/types";
import { buildObservation, createInitialState } from "@jev-arena/game-core";
import { describe, expect, it } from "vitest";
import { RemoteJevAgent } from "../src/game/remote-jev-agent";

const observation = buildObservation(
  createInitialState(DEFAULT_GAME_CONFIG),
  "A",
  DEFAULT_GAME_CONFIG,
);

function respondWith(
  body: unknown,
  init: { status?: number } = {},
): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("RemoteJevAgent", () => {
  it("posts the observation to the decision endpoint", async () => {
    let captured: { url: string; body: unknown } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)) };
      return new Response(
        JSON.stringify({ decision: { action: attack("B"), origin: "model" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await new RemoteJevAgent({ name: "Jev A", fetchImpl }).decide(observation);

    expect(captured?.url).toBe("/api/decide");
    expect((captured?.body as { observation: unknown }).observation).toEqual(
      JSON.parse(JSON.stringify(observation)),
    );
  });

  it("returns the decision the server produced", async () => {
    const decision = await new RemoteJevAgent({
      name: "Jev A",
      fetchImpl: respondWith({
        decision: {
          action: attack("B"),
          origin: "model",
          confidence: 0.84,
          model: "jev-1.13.0",
        },
      }),
    }).decide(observation);

    expect(decision.action).toEqual(attack("B"));
    expect(decision.origin).toBe("model");
    expect(decision.confidence).toBe(0.84);
  });

  it("carries the server's error category through, rather than flattening it", async () => {
    const agent = new RemoteJevAgent({
      name: "Jev A",
      fetchImpl: respondWith(
        {
          error: {
            category: "CREDIT_ERROR",
            message: "Your account has no remaining credit.",
          },
        },
        { status: 402 },
      ),
    });

    await expect(agent.decide(observation)).rejects.toMatchObject({
      category: "CREDIT_ERROR",
      message: "Your account has no remaining credit.",
    });
  });

  it("reports a missing key as configuration, not as a mystery", async () => {
    const agent = new RemoteJevAgent({
      name: "Jev A",
      fetchImpl: respondWith(
        {
          error: {
            category: "CONFIGURATION_ERROR",
            message: "TYPESAFE_API_KEY is not set on the server.",
          },
        },
        { status: 503 },
      ),
    });
    await expect(agent.decide(observation)).rejects.toMatchObject({
      category: "CONFIGURATION_ERROR",
    });
  });

  it("classifies an unreachable endpoint as a network error", async () => {
    const agent = new RemoteJevAgent({
      name: "Jev A",
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    await expect(agent.decide(observation)).rejects.toMatchObject({
      category: "NETWORK_ERROR",
    });
  });

  it("classifies a non-JSON response instead of throwing a parse error", async () => {
    const agent = new RemoteJevAgent({
      name: "Jev A",
      fetchImpl: (async () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
        })) as unknown as typeof fetch,
    });
    await expect(agent.decide(observation)).rejects.toBeInstanceOf(ArenaError);
  });

  it("rejects a 200 that carries no decision", async () => {
    const agent = new RemoteJevAgent({
      name: "Jev A",
      fetchImpl: respondWith({}),
    });
    await expect(agent.decide(observation)).rejects.toThrow();
  });
});
