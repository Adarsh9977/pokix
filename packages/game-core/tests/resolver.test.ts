import { attack, defend, dodge, move, type Action } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { resolveTurn } from "../src/resolver";
import { facingOff, OPEN_ARENA, stateWith } from "./helpers";

describe("simultaneous actions (spec 14: simultaneous actions)", () => {
  it("resolves A attacking while B dodges, in one turn", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 7, y: 5 });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: dodge("EAST") },
      OPEN_ARENA,
    );
    expect(players.A.applied).toEqual(attack("B"));
    expect(players.B.applied).toEqual(dodge("EAST"));
    expect(next.players.B.position).toEqual({ x: 8, y: 5 });
    expect(next.turn).toBe(state.turn + 1);
  });

  it("lets both players damage each other in the same turn", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { next } = resolveTurn(
      state,
      { A: attack("B"), B: attack("A") },
      OPEN_ARENA,
    );
    expect(next.players.A.hp).toBeLessThan(state.players.A.hp);
    expect(next.players.B.hp).toBeLessThan(state.players.B.hp);
    expect(next.players.A.hp).toBe(next.players.B.hp);
  });

  it("lets a dying player land their blow: damage is computed before HP is written", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, hp: 1 },
        B: { position: { x: 6, y: 5 }, hp: 100 },
      },
    });
    const { next } = resolveTurn(
      state,
      { A: attack("B"), B: attack("A") },
      OPEN_ARENA,
    );
    expect(next.players.A.hp).toBe(0);
    expect(next.players.B.hp).toBeLessThan(100);
  });
});

describe("deterministic resolution (spec 14: deterministic resolution)", () => {
  it("produces the same result every time for the same inputs", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const actions = { A: attack("B"), B: dodge("NORTH") };
    const first = resolveTurn(state, actions, OPEN_ARENA);
    for (let i = 0; i < 50; i += 1) {
      expect(resolveTurn(state, actions, OPEN_ARENA)).toEqual(first);
    }
  });

  it("does not depend on the order the two actions were supplied in", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const aFirst: Record<"A" | "B", Action> = {
      A: attack("B"),
      B: dodge("NORTH"),
    };
    const bFirst: Record<"A" | "B", Action> = {
      B: dodge("NORTH"),
      A: attack("B"),
    };
    expect(resolveTurn(state, aFirst, OPEN_ARENA).next).toEqual(
      resolveTurn(state, bFirst, OPEN_ARENA).next,
    );
  });

  it("is symmetric: mirroring the players mirrors the outcome", () => {
    const left = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const right = facingOff({ x: 6, y: 5 }, { x: 5, y: 5 });
    const l = resolveTurn(left, { A: attack("B"), B: defend() }, OPEN_ARENA);
    const r = resolveTurn(right, { A: defend(), B: attack("A") }, OPEN_ARENA);
    expect(l.players.B.damageTaken).toBe(r.players.A.damageTaken);
    expect(l.next.players.B.hp).toBe(r.next.players.A.hp);
  });
});

describe("state immutability (spec 14: state immutability)", () => {
  it("returns a new state and leaves the previous snapshot untouched", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const before = structuredClone(state);
    const { next } = resolveTurn(
      state,
      { A: attack("B"), B: move("SOUTH") },
      OPEN_ARENA,
    );
    expect(next).not.toBe(state);
    expect(state).toEqual(before);
  });

  it("freezes the new state too", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { next } = resolveTurn(
      state,
      { A: defend(), B: defend() },
      OPEN_ARENA,
    );
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.players.A)).toBe(true);
    expect(Object.isFrozen(next.players.A.position)).toBe(true);
  });

  it("exposes the exact snapshot the turn was resolved against", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { previous } = resolveTurn(
      state,
      { A: defend(), B: defend() },
      OPEN_ARENA,
    );
    expect(previous).toBe(state);
  });
});

describe("turn and version advancement", () => {
  it("increments both the turn and the state version", () => {
    const state = stateWith({ turn: 7, version: 6 });
    const { next } = resolveTurn(
      state,
      { A: defend(), B: defend() },
      OPEN_ARENA,
    );
    expect(next.turn).toBe(8);
    expect(next.version).toBe(7);
  });

  it("refuses to resolve a finished match", () => {
    const running = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const finished = { ...running, status: "finished" as const };
    expect(() =>
      resolveTurn(finished, { A: defend(), B: defend() }, OPEN_ARENA),
    ).toThrow(/finished/i);
  });
});

describe("win conditions", () => {
  it("finishes the match and names the winner when a player reaches 0 HP", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 } },
        B: { position: { x: 6, y: 5 }, hp: 2 },
      },
    });
    const { next } = resolveTurn(
      state,
      { A: attack("B"), B: move("SOUTH") },
      OPEN_ARENA,
    );
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("A");
  });

  it("calls a double knockout a draw", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, hp: 2 },
        B: { position: { x: 6, y: 5 }, hp: 2 },
      },
    });
    const { next } = resolveTurn(
      state,
      { A: attack("B"), B: attack("A") },
      OPEN_ARENA,
    );
    expect(next.status).toBe("finished");
    expect(next.winner).toBeNull();
  });

  it("awards the turn limit to whoever has more HP", () => {
    const state = stateWith({
      turn: OPEN_ARENA.maxTurns,
      players: {
        A: { position: { x: 2, y: 2 }, hp: 40 },
        B: { position: { x: 17, y: 17 }, hp: 30 },
      },
    });
    const { next } = resolveTurn(
      state,
      { A: defend(), B: defend() },
      OPEN_ARENA,
    );
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("A");
  });

  it("draws the turn limit when HP is level", () => {
    const state = stateWith({
      turn: OPEN_ARENA.maxTurns,
      players: {
        A: { position: { x: 2, y: 2 }, hp: 30 },
        B: { position: { x: 17, y: 17 }, hp: 30 },
      },
    });
    const { next } = resolveTurn(
      state,
      { A: defend(), B: defend() },
      OPEN_ARENA,
    );
    expect(next.winner).toBeNull();
  });
});
