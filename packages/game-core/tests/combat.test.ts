import { attack, defend, dodge, move } from "@jev-arena/types";
import { describe, expect, it } from "vitest";
import { resolveTurn } from "../src/resolver";
import { facingOff, OPEN_ARENA, stateWith, withCombat } from "./helpers";

const combat = OPEN_ARENA.combat;

describe("attack range (spec 14: attack range)", () => {
  it("given adjacent players, when A attacks B, damage is applied", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.A.attackOutcome).toBe("DEFENDED");
    expect(next.players.B.hp).toBeLessThan(state.players.B.hp);
  });

  it("deals full damage to an opponent who does nothing defensive", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: move("SOUTH") },
      OPEN_ARENA,
    );
    expect(players.A.attackOutcome).toBe("HIT");
    expect(players.A.damageDealt).toBe(combat.attackDamage);
    expect(next.players.B.hp).toBe(state.players.B.hp - combat.attackDamage);
  });

  it("connects at exactly maximum range", () => {
    const state = facingOff(
      { x: 5, y: 5 },
      { x: 5 + combat.attackRange, y: 5 },
    );
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.A.damageDealt).toBeGreaterThan(0);
  });

  it("spends energy on an attack and regenerates at end of turn", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, energy: 50 },
        B: { position: { x: 6, y: 5 } },
      },
    });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.A.energySpent).toBe(combat.attackEnergyCost);
    expect(next.players.A.energy).toBe(
      50 - combat.attackEnergyCost + combat.energyRegenPerTurn,
    );
  });
});

describe("invalid attack (spec 14: invalid attack)", () => {
  it("given players far apart, when A attacks B, the attack is rejected", () => {
    const state = facingOff({ x: 2, y: 2 }, { x: 17, y: 17 });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.A.rejection?.reason).toBe("OUT_OF_RANGE");
    expect(players.A.applied).toEqual(defend());
    expect(players.A.damageDealt).toBe(0);
    expect(next.players.B.hp).toBe(state.players.B.hp);
  });

  it("does not charge energy for a rejected attack", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 2, y: 2 }, energy: 40 },
        B: { position: { x: 17, y: 17 } },
      },
    });
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.A.energySpent).toBe(0);
  });
});

describe("DEFEND", () => {
  it("reduces incoming damage by the configured fraction", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    const expected = Math.round(
      combat.attackDamage * (1 - combat.defendDamageReduction),
    );
    expect(players.A.damageDealt).toBe(expected);
    expect(players.B.damageTaken).toBe(expected);
  });

  it("costs no energy", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      OPEN_ARENA,
    );
    expect(players.B.energySpent).toBe(0);
  });

  it("does not protect against an attack that never connects", () => {
    const state = facingOff({ x: 2, y: 2 }, { x: 17, y: 17 });
    const { players } = resolveTurn(
      state,
      { A: defend(), B: defend() },
      OPEN_ARENA,
    );
    expect(players.B.damageTaken).toBe(0);
  });
});

describe("DODGE", () => {
  it("negates the attack entirely when it breaks range", () => {
    // Range 2; B dodges from distance 2 to distance 3.
    const state = facingOff({ x: 5, y: 5 }, { x: 7, y: 5 });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: dodge("EAST") },
      OPEN_ARENA,
    );
    expect(next.players.B.position).toEqual({ x: 8, y: 5 });
    expect(players.A.attackOutcome).toBe("EVADED");
    expect(players.A.damageDealt).toBe(0);
    expect(next.players.B.hp).toBe(state.players.B.hp);
  });

  it("only grazes when the dodge fails to break range", () => {
    // B dodges from distance 1 to distance 2, still inside range 2.
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: dodge("EAST") },
      OPEN_ARENA,
    );
    const expected = Math.round(
      combat.attackDamage * (1 - combat.grazedDodgeDamageReduction),
    );
    expect(players.A.attackOutcome).toBe("GRAZED");
    expect(players.A.damageDealt).toBe(expected);
  });

  it("costs energy whether or not it works", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, energy: 60 },
        B: { position: { x: 6, y: 5 }, energy: 60 },
      },
    });
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: dodge("EAST") },
      OPEN_ARENA,
    );
    expect(players.B.energySpent).toBe(combat.dodgeEnergyCost);
  });

  it("is beaten by simply walking out of range too", () => {
    const state = facingOff({ x: 5, y: 5 }, { x: 7, y: 5 });
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: move("EAST") },
      OPEN_ARENA,
    );
    expect(players.A.attackOutcome).toBe("MISSED");
    expect(players.A.damageDealt).toBe(0);
  });
});

describe("resource clamping", () => {
  it("never drops HP below zero", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 } },
        B: { position: { x: 6, y: 5 }, hp: 3 },
      },
    });
    const { next, players } = resolveTurn(
      state,
      { A: attack("B"), B: move("SOUTH") },
      OPEN_ARENA,
    );
    expect(next.players.B.hp).toBe(0);
    // The resolution still reports the damage that was actually absorbed.
    expect(players.B.damageTaken).toBe(3);
  });

  it("never regenerates energy above the maximum", () => {
    const state = stateWith({
      players: {
        A: { position: { x: 5, y: 5 }, energy: OPEN_ARENA.player.maxEnergy },
        B: { position: { x: 15, y: 15 } },
      },
    });
    const { next } = resolveTurn(
      state,
      { A: defend(), B: defend() },
      OPEN_ARENA,
    );
    expect(next.players.A.energy).toBe(OPEN_ARENA.player.maxEnergy);
  });

  it("keeps every damage value an integer", () => {
    const config = withCombat({ attackDamage: 13 });
    const state = facingOff({ x: 5, y: 5 }, { x: 6, y: 5 });
    const { players } = resolveTurn(
      state,
      { A: attack("B"), B: defend() },
      config,
    );
    expect(Number.isInteger(players.A.damageDealt)).toBe(true);
  });
});
