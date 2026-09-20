/**
 * Strategy profiles.
 *
 * A profile changes what an agent *wants*, never what it is allowed to do.
 * The rules, the action space and the validator are identical for every
 * profile, so a match between two profiles is still a fair fight.
 *
 * This is also the fix for the most boring property the game had: two
 * identical policies starting mirror-symmetrically fight to an exact draw
 * every time. Correct, and proof the engine is neutral, but nothing to watch.
 */

export const STRATEGY_PROFILE_IDS = [
  "neutral",
  "aggressive",
  "defensive",
  "tactical",
] as const;

export type StrategyProfileId = (typeof STRATEGY_PROFILE_IDS)[number];

export interface StrategyProfile {
  readonly id: StrategyProfileId;
  readonly label: string;
  /** One-line description, shown in the UI. */
  readonly blurb: string;

  /**
   * Emphasis handed to Jev alongside the state. It shapes preference only:
   * it never describes a rule, because the rules are code's business.
   */
  readonly directive: string;

  // --- Knobs the deterministic local agent reads -------------------------
  /** HP fraction below which it starts preferring escape over trading. */
  readonly retreatBelowHpFraction: number;
  /** Energy fraction below which it will break off to find a power node. */
  readonly seeksEnergyBelowFraction: number;
  /** Prefers to hold at maximum reach rather than close the gap. */
  readonly prefersDistance: boolean;
}

export const STRATEGY_PROFILES: Readonly<
  Record<StrategyProfileId, StrategyProfile>
> = Object.freeze({
  neutral: {
    id: "neutral",
    label: "Neutral",
    blurb: "Trades when it is worth trading.",
    directive:
      "Play to win the fight. Weigh the risk of being hit against the value of landing a hit.",
    retreatBelowHpFraction: 0.3,
    seeksEnergyBelowFraction: 0.25,
    prefersDistance: false,
  },
  aggressive: {
    id: "aggressive",
    label: "Aggressive",
    blurb: "Closes distance and keeps the pressure on.",
    directive:
      "Press the attack. Close distance and keep the enemy under pressure. Accept taking a hit in order to land one, and only break off if staying would be fatal.",
    retreatBelowHpFraction: 0.15,
    seeksEnergyBelowFraction: 0.15,
    prefersDistance: false,
  },
  defensive: {
    id: "defensive",
    label: "Defensive",
    blurb: "Survives first, strikes on the counter.",
    directive:
      "Survive first. Prefer cover and evasion over trading blows, keep your energy reserve healthy, and take the shot only when it is clearly safe to.",
    retreatBelowHpFraction: 0.55,
    seeksEnergyBelowFraction: 0.45,
    prefersDistance: true,
  },
  tactical: {
    id: "tactical",
    label: "Tactical",
    blurb: "Plays the map: cover, power nodes, angles.",
    directive:
      "Play the map, not just the enemy. Use obstacles to break their line of fire, take power nodes when the fight allows it, and pick the moment to engage rather than accepting the one you are offered.",
    retreatBelowHpFraction: 0.4,
    seeksEnergyBelowFraction: 0.5,
    prefersDistance: true,
  },
});

export function isStrategyProfileId(
  value: unknown,
): value is StrategyProfileId {
  return (
    typeof value === "string" &&
    (STRATEGY_PROFILE_IDS as readonly string[]).includes(value)
  );
}

export function strategyProfile(id: StrategyProfileId): StrategyProfile {
  return STRATEGY_PROFILES[id];
}
