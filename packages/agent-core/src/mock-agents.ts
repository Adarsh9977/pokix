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
  type AgentDecision,
  type AgentObservation,
  type Direction,
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
 * building the UI. Its policy, in order:
 *
 *   1. Badly hurt and under threat with the energy to escape? Dodge away.
 *   2. Enemy in range and attack affordable? Attack.
 *   3. Out of range? Close the larger axis gap first.
 *   4. Nothing useful available? Brace.
 *
 * Every tie is broken by a fixed order, so the same observation always
 * produces the same action.
 */
export class HeuristicAgent implements Agent {
  readonly name: string;

  constructor(
    private readonly options: {
      /** HP fraction below which it starts favouring escape. */
      readonly retreatBelowHpFraction?: number;
      readonly maxHp?: number;
      readonly name?: string;
    } = {},
  ) {
    this.name = options.name ?? "Heuristic";
  }

  async decide(observation: AgentObservation): Promise<AgentDecision> {
    return mockDecision(this.choose(observation));
  }

  private choose(observation: AgentObservation): Action {
    const { self, enemy, availableActions } = observation;
    const maxHp = this.options.maxHp ?? 100;
    const retreatBelow = this.options.retreatBelowHpFraction ?? 0.3;

    const hurt = self.hp / maxHp < retreatBelow;
    const canDodge = availableActions.includes("DODGE");
    const canAttack = availableActions.includes("ATTACK");
    const canMove = availableActions.includes("MOVE");

    if (hurt && observation.enemyInAttackRange && canDodge) {
      const away = this.directionAwayFrom(observation);
      if (away) return dodge(away);
    }

    if (canAttack) return attack(enemy.id);

    if (canMove) {
      const toward = this.directionToward(observation);
      if (toward) return move(toward);
    }

    return defend();
  }

  /** Closes the larger axis gap first; falls back to any legal direction. */
  private directionToward(o: AgentObservation): Direction | undefined {
    const dx = o.enemy.position.x - o.self.position.x;
    const dy = o.enemy.position.y - o.self.position.y;
    const preferences: Direction[] =
      Math.abs(dx) >= Math.abs(dy)
        ? [horizontal(dx), vertical(dy)].filter(isDefined)
        : [vertical(dy), horizontal(dx)].filter(isDefined);

    return (
      preferences.find((d) => o.legalMoveDirections.includes(d)) ??
      DIRECTIONS.find((d) => o.legalMoveDirections.includes(d))
    );
  }

  /** Opens the larger axis gap first; falls back to any legal direction. */
  private directionAwayFrom(o: AgentObservation): Direction | undefined {
    const dx = o.self.position.x - o.enemy.position.x;
    const dy = o.self.position.y - o.enemy.position.y;
    const preferences: Direction[] =
      Math.abs(dx) >= Math.abs(dy)
        ? [horizontal(dx), vertical(dy)].filter(isDefined)
        : [vertical(dy), horizontal(dx)].filter(isDefined);

    return (
      preferences.find((d) => o.legalDodgeDirections.includes(d)) ??
      DIRECTIONS.find((d) => o.legalDodgeDirections.includes(d))
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
