import { attack, defend, move } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { resolveTurn } from "../src/resolver";
import { facingOff, OPEN_ARENA, stateWith } from "./helpers";

const combat = OPEN_ARENA.combat;

describe("overcharge", () => {
  it("starts empty", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    expect(state.players.A.charge).toBe(0);
  });

  it("builds on any turn the player does not attack", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 15, y: 15 });
    const first = resolveTurn(
      state,
      { A: move("NORTH"), B: defend() },
      OPEN_ARENA,
    );
    expect(first.next.players.A.charge).toBe(combat.chargeGainPerTurn);
    expect(first.next.players.B.charge).toBe(combat.chargeGainPerTurn);
  });

  it("stops at the maximum rather than growing forever", () => {
    let state = facingOff({ x: 2, y: 2 }, { x: 17, y: 17 });
    for (let i = 0; i < combat.maxCharge + 4; i += 1) {
      state = resolveTurn(state, { A: defend(), B: defend() }, OPEN_ARENA).next;
    }
    expect(state.players.A.charge).toBe(combat.maxCharge);
  });

  it("makes a charged hit land harder, in proportion to the charge", () => {
    for (const charge of [0, 1, 2, 3]) {
      const state = stateWith({
        players: {
          A: { position: { x: 5, y: 5 }, charge },
          B: { position: { x: 6, y: 5 } },
        },
      });
      const { players } = resolveTurn(
        state,
        { A: attack("B"), B: move("SOUTH") },
        OPEN_ARENA,
      );
      expect(players.A.damageDealt).toBe(
        combat.attackDamage + charge * combat.chargeDamageBonus,
      );
    }
  });

  it("empties the charge the moment it is spent", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, charge: 3 },
        B: { position: { x: 6, y: 5 } },
      },
    });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.A.chargeSpent).toBe(3);
    expect(next.players.A.charge).toBe(0);
  });

  it("spends nothing when the attack was rejected", () => {
    // Out of range: the swing never happened, so the charge is kept and
    // still builds like any other non-attacking turn.
    const state = stateWith({
      players: {
        A: { position: { x: 2, y: 2 }, charge: 2 },
        B: { position: { x: 17, y: 17 } },
      },
    });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.A.rejection?.reason).toBe("OUT_OF_RANGE");
    expect(players.A.chargeSpent).toBe(0);
    expect(next.players.A.charge).toBe(3);
  });

  it("keeps the charge when an attack misses, since it still swung", () => {
    // A swing that whiffs is still a swing: the power is gone.
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, charge: 2 },
        B: { position: { x: 7, y: 5 } },
      },
    });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: move("EAST") },
      OPEN_ARENA,
    );
    expect(players.A.attackOutcome).toBe("MISSED");
    expect(next.players.A.charge).toBe(0);
  });

  it("is still halved by DEFEND, so bracing remains the answer", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, charge: 3 },
        B: { position: { x: 6, y: 5 } },
      },
    });
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    const full = combat.attackDamage + 3 * combat.chargeDamageBonus;
    expect(players.A.damageDealt).toBe(
      Math.round(full * (1 - combat.defendDamageReduction)),
    );
  });

  it("is dodged entirely, charge and all", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, charge: 3 },
        B: { position: { x: 7, y: 5 } },
      },
    });
    const { players, next } = resolveTurn(
      state,
      { A: attack("B"), B: { type: "DODGE", direction: "EAST" } },
      OPEN_ARENA,
    );
    expect(players.A.attackOutcome).toBe("EVADED");
    expect(players.A.damageDealt).toBe(0);
    // And the attacker is now empty, having swung at nothing.
    expect(next.players.A.charge).toBe(0);
  });

  it("stays deterministic", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, charge: 2 },
        B: { position: { x: 6, y: 5 }, charge: 1 },
      },
    });
    const actions = { A: attack("B"), B: attack("A") };
    const first = resolveTurn(state, actions, OPEN_ARENA);
    for (let i = 0; i < 20; i += 1) {
      expect(resolveTurn(state, actions, OPEN_ARENA)).toEqual(first);
    }
  });
});
