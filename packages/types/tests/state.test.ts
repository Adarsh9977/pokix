import { describe, expect, expectTypeOf, it } from "vitest";
import {
  MATCH_STATUSES,
  PLAYER_IDS,
  isPlayerId,
  opponentOf,
} from "../src/state";
import type { GameState, PlayerId, PlayerState } from "../src/state";

describe("player identity", () => {
  it("has exactly two players", () => {
    expect([...PLAYER_IDS]).toEqual(["A", "B"]);
  });

  it("recognises only A and B", () => {
    expect(isPlayerId("A")).toBe(true);
    expect(isPlayerId("B")).toBe(true);
    expect(isPlayerId("C")).toBe(false);
    expect(isPlayerId("a")).toBe(false);
  });

  it("resolves each player's opponent", () => {
    expect(opponentOf("A")).toBe("B");
    expect(opponentOf("B")).toBe("A");
  });

  it("is an involution: the opponent of your opponent is you", () => {
    for (const id of PLAYER_IDS) {
      expect(opponentOf(opponentOf(id))).toBe(id);
    }
  });
});

describe("match status", () => {
  it("models a match as running or finished", () => {
    expect([...MATCH_STATUSES]).toEqual(["running", "finished"]);
  });
});

describe("state shape", () => {
  it("keys players by PlayerId so both are always present", () => {
    expectTypeOf<GameState["players"]>().toEqualTypeOf<
      Record<PlayerId, PlayerState>
    >();
  });

  it("carries a monotonic version alongside the turn for stale-decision checks", () => {
    expectTypeOf<GameState["version"]>().toEqualTypeOf<number>();
    expectTypeOf<GameState["turn"]>().toEqualTypeOf<number>();
  });

  it("only exposes a winner once the match is finished", () => {
    // `winner` is null for a draw and undefined while the match runs.
    expectTypeOf<GameState["winner"]>().toEqualTypeOf<
      PlayerId | null | undefined
    >();
  });
});
