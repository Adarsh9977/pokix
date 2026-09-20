import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG } from "../src/config";
import { PLAYER_IDS } from "../src/state";

const config = DEFAULT_GAME_CONFIG;

describe("default game configuration", () => {
  it("uses the 20x20 arena the spec mandates", () => {
    expect(config.arena.width).toBe(20);
    expect(config.arena.height).toBe(20);
  });

  it("is fully deterministic: no randomness knobs", () => {
    expect(Object.keys(config)).not.toContain("seed");
    expect(Object.keys(config)).not.toContain("random");
  });

  it("is deeply frozen so a match cannot mutate the rules mid-game", () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.arena)).toBe(true);
    expect(Object.isFrozen(config.combat)).toBe(true);
    expect(Object.isFrozen(config.startingPositions)).toBe(true);
  });
});

describe("balance invariants", () => {
  it("gives both players identical starting resources", () => {
    expect(config.player.startingHp).toBe(config.player.maxHp);
    expect(config.player.startingEnergy).toBe(config.player.maxEnergy);
  });

  it("places both players inside the arena", () => {
    for (const id of PLAYER_IDS) {
      const position = config.startingPositions[id];
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThan(config.arena.width);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThan(config.arena.height);
    }
  });

  it("places both players mirror-symmetrically so neither starts favoured", () => {
    const a = config.startingPositions.A;
    const b = config.startingPositions.B;
    expect(a.x + b.x).toBe(config.arena.width - 1);
    expect(a.y).toBe(b.y);
  });

  it("starts the players out of attack range of each other", () => {
    const a = config.startingPositions.A;
    const b = config.startingPositions.B;
    const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    expect(distance).toBeGreaterThan(config.combat.attackRange);
  });

  it("keeps all combat values as non-negative integers", () => {
    const integers = [
      config.combat.attackRange,
      config.combat.attackDamage,
      config.combat.attackEnergyCost,
      config.combat.dodgeEnergyCost,
      config.combat.moveEnergyCost,
      config.combat.energyRegenPerTurn,
      config.maxTurns,
    ];
    for (const value of integers) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("expresses damage mitigation as fractions between 0 and 1", () => {
    for (const fraction of [
      config.combat.defendDamageReduction,
      config.combat.grazedDodgeDamageReduction,
    ]) {
      expect(fraction).toBeGreaterThan(0);
      expect(fraction).toBeLessThan(1);
    }
  });

  it("makes dodging cost more energy than attacking, so evasion is a real trade", () => {
    expect(config.combat.dodgeEnergyCost).toBeGreaterThan(
      config.combat.attackEnergyCost,
    );
  });

  it("lets a player sustain attacks without ever being energy-locked forever", () => {
    expect(config.combat.energyRegenPerTurn).toBeGreaterThan(0);
    expect(config.player.maxEnergy).toBeGreaterThanOrEqual(
      config.combat.dodgeEnergyCost,
    );
  });

  it("guarantees a match ends: max turns of unmitigated damage exceeds max HP", () => {
    const turnsToKill = Math.ceil(
      config.player.maxHp / config.combat.attackDamage,
    );
    expect(config.maxTurns).toBeGreaterThan(turnsToKill);
  });

  it("does not place obstacles under either starting position", () => {
    for (const obstacle of config.arena.obstacles) {
      for (const id of PLAYER_IDS) {
        const start = config.startingPositions[id];
        expect({ ...obstacle }).not.toEqual({ ...start });
      }
    }
  });

  it("keeps every obstacle inside the arena", () => {
    for (const obstacle of config.arena.obstacles) {
      expect(obstacle.x).toBeGreaterThanOrEqual(0);
      expect(obstacle.x).toBeLessThan(config.arena.width);
      expect(obstacle.y).toBeGreaterThanOrEqual(0);
      expect(obstacle.y).toBeLessThan(config.arena.height);
    }
  });

  it("mirrors the obstacle layout so neither side gets better cover", () => {
    const mirrored = config.arena.obstacles.map((o) => ({
      x: config.arena.width - 1 - o.x,
      y: o.y,
    }));
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    expect(new Set(mirrored.map(key))).toEqual(
      new Set(config.arena.obstacles.map(key)),
    );
  });
});
