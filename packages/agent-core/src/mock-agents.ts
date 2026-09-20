/**
 * Deterministic local agents.
 *
 * These exist so that the overwhelming majority of the test suite, and all
 * frontend development, can run without touching the TypeSafe API. None of
 * them reports a confidence: they have no calibrated uncertainty to report,
 * and inventing one would make a mock indistinguishable from a model in the
 * HUD and in the analytics.
 */

import {
  DIRECTIONS,
  attack,
  defend,
  describeAction,
  dodge,
  move,
  type Action,
  STRATEGY_PROFILES,
  type AgentDecision,
  type AgentObservation,
  type Direction,
  type StrategyProfile,
  type StrategyProfileId,
} from "@jev-arena/types";
import type { Agent } from "./agent";

function mockDecision(action: Action): AgentDecision {
  return Object.freeze({ action, origin: "mock" as const });
}

/** Always does the same thing. The simplest possible test double. */
export class MockAgent implements Agent {
  readonly name: string;

  constructor(
    private readonly action: Action,
    name?: string,
  ) {
    this.name = name ?? `Mock(${describeAction(action)})`;
  }

  async decide(_observation: AgentObservation): Promise<AgentDecision> {
    return mockDecision(this.action);
  }
}

/**
 * Plays a fixed sequence of actions, then either loops or falls back.
 * Useful for driving the engine through an exact scenario.
 */
export class ScriptedAgent implements Agent {
  readonly name: string;
  private index = 0;

  constructor(
    private readonly script: readonly Action[],
    private readonly options: {
      readonly loop?: boolean;
      readonly name?: string;
    } = {},
  ) {
    if (script.length === 0) {
      throw new Error("ScriptedAgent needs at least one action in its script.");
    }
    this.name = options.name ?? `Scripted(${script.length})`;
  }

  async decide(_observation: AgentObservation): Promise<AgentDecision> {
    const action =
      this.index < this.script.length
        ? this.script[this.index]!
        : this.options.loop
          ? this.script[this.index % this.script.length]!
          : defend();
    this.index += 1;
    return mockDecision(action);
  }

  reset(): void {
    this.index = 0;
  }
}

/**
 * A competent, stateless, fully deterministic opponent.
 *
 * It reads only the observation, exactly like a Jev agent does, so it is a
 * fair baseline to measure a model against and a realistic stand-in while
 * building the UI. Its policy, in priority order:
 *
 *   1. Badly hurt, under threat, and able to escape? Dodge away.
 *   2. Low on energy with a power node reachable? Go take it.
 *   3. Enemy in reach with a clear line? Attack.
 *   4. Enemy in reach but behind cover? Sidestep for an angle.
 *   5. Out of range? Close the larger axis gap first.
 *   6. Nothing useful? Brace.
 *
 * The thresholds come from its strategy profile, which is what stops two of
 * these from mirroring each other into a guaranteed draw.
 *
 * Every tie is broken by a fixed order, so the same observation always
 * produces the same action.
 */
export class HeuristicAgent implements Agent {
  readonly name: string;
  private readonly profile: StrategyProfile;

  constructor(
    private readonly options: {
      readonly profile?: StrategyProfileId | StrategyProfile;
      readonly maxHp?: number;
      readonly maxEnergy?: number;
      readonly name?: string;
    } = {},
  ) {
    this.profile =
      typeof options.profile === "string"
        ? STRATEGY_PROFILES[options.profile]
        : (options.profile ?? STRATEGY_PROFILES.neutral);
    this.name = options.name ?? `Local (${this.profile.label})`;
  }

  async decide(observation: AgentObservation): Promise<AgentDecision> {
    return mockDecision(this.choose(observation));
  }

  private choose(observation: AgentObservation): Action {
    const { self, enemy, availableActions } = observation;
    const maxHp = this.options.maxHp ?? 100;
    const maxEnergy = this.options.maxEnergy ?? 100;

    const hurt = self.hp / maxHp < this.profile.retreatBelowHpFraction;
    const drained =
      self.energy / maxEnergy < this.profile.seeksEnergyBelowFraction;
    const canDodge = availableActions.includes("DODGE");
    const canAttack = availableActions.includes("ATTACK");
    const canMove = availableActions.includes("MOVE");

    // 1. A charged opponent in range is a telegraphed big hit.
    //
    //    Only worth evading if they out-gun us. If we are just as charged,
    //    evading is a losing move: neither side ever spends its charge, both
    //    keep building it, and the fight deadlocks into a dodge loop. When
    //    both are loaded, trade.
    const outgunned = observation.enemy.charge > self.charge;
    const incoming =
      observation.enemyInAttackRange &&
      observation.hasLineOfSightToEnemy &&
      outgunned &&
      observation.enemyPotentialDamage >= self.hp * 0.4;

    if (incoming) {
      const away = this.directionAwayFrom(observation);
      if (canDodge && away) return dodge(away);
      if (availableActions.includes("DEFEND")) return defend();
    }

    // 2. Break off while there is still something left to break off with.
    if (hurt && observation.enemyInAttackRange && canDodge) {
      const away = this.directionAwayFrom(observation);
      if (away) return dodge(away);
    }

    // 2. Running dry is a losing position, so top up before it happens.
    // Not while standing on the node: at that point just hold it.
    if (drained && canMove && !observation.standingOnEnergyNode) {
      const node = observation.energyNodes[0];
      if (node) {
        const toNode = this.directionTowardTile(observation, node.position);
        if (toNode) return move(toNode);
      }
    }

    // 3. The shot is there. Take it.
    if (canAttack) return attack(enemy.id);

    // 4. In reach but shooting at a pillar: step out and get the angle.
    if (observation.isBehindCover && canMove) {
      const sidestep = this.sidestep(observation);
      if (sidestep) return move(sidestep);
    }

    // 5. Close, unless this profile would rather hold its spacing.
    if (canMove) {
      const holdingDistance =
        this.profile.prefersDistance &&
        observation.enemyInAttackRange &&
        observation.hasLineOfSightToEnemy;
      const toward = holdingDistance
        ? this.directionAwayFrom(observation, "move")
        : this.directionToward(observation);
      if (toward) return move(toward);
    }

    return defend();
  }

  /** Closes the larger axis gap first; falls back to any legal direction. */
  private directionToward(o: AgentObservation): Direction | undefined {
    return this.directionTowardTile(o, o.enemy.position);
  }

  private directionTowardTile(
    o: AgentObservation,
    target: { x: number; y: number },
  ): Direction | undefined {
    const dx = target.x - o.self.position.x;
    const dy = target.y - o.self.position.y;
    const preferences: Direction[] =
      Math.abs(dx) >= Math.abs(dy)
        ? [horizontal(dx), vertical(dy)].filter(isDefined)
        : [vertical(dy), horizontal(dx)].filter(isDefined);

    return (
      preferences.find((d) => o.legalMoveDirections.includes(d)) ??
      DIRECTIONS.find((d) => o.legalMoveDirections.includes(d))
    );
  }

  /**
   * Steps perpendicular to the enemy, which is the movement most likely to
   * clear a pillar without giving up distance.
   */
  private sidestep(o: AgentObservation): Direction | undefined {
    const dx = o.enemy.position.x - o.self.position.x;
    const dy = o.enemy.position.y - o.self.position.y;
    const perpendicular: Direction[] =
      Math.abs(dx) >= Math.abs(dy) ? ["NORTH", "SOUTH"] : ["EAST", "WEST"];
    return perpendicular.find((d) => o.legalMoveDirections.includes(d));
  }

  /** Opens the larger axis gap first; falls back to any legal direction. */
  private directionAwayFrom(
    o: AgentObservation,
    kind: "dodge" | "move" = "dodge",
  ): Direction | undefined {
    const legal =
      kind === "dodge" ? o.legalDodgeDirections : o.legalMoveDirections;
    const dx = o.self.position.x - o.enemy.position.x;
    const dy = o.self.position.y - o.enemy.position.y;
    const preferences: Direction[] =
      Math.abs(dx) >= Math.abs(dy)
        ? [horizontal(dx), vertical(dy)].filter(isDefined)
        : [vertical(dy), horizontal(dx)].filter(isDefined);

    return (
      preferences.find((d) => legal.includes(d)) ??
      DIRECTIONS.find((d) => legal.includes(d))
    );
  }
}

function horizontal(dx: number): Direction | undefined {
  if (dx > 0) return "EAST";
  if (dx < 0) return "WEST";
  return undefined;
}

function vertical(dy: number): Direction | undefined {
  if (dy > 0) return "SOUTH";
  if (dy < 0) return "NORTH";
  return undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
