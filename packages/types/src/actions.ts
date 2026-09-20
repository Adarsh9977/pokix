/**
 * The bounded action space.
 *
 * This set is deliberately tiny. It is the entire vocabulary an agent may use,
 * and it doubles as the option list handed to Jev's Choice primitive. Jev picks
 * an `ActionType`; code turns that pick into a fully-formed `Action` and the
 * engine decides whether it actually happens.
 */

import type { Direction } from "./geometry";
import type { PlayerId } from "./state";

export const ACTION_TYPES = ["MOVE", "ATTACK", "DEFEND", "DODGE"] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export interface MoveAction {
  readonly type: "MOVE";
  readonly direction: Direction;
}

export interface AttackAction {
  readonly type: "ATTACK";
  readonly target: PlayerId;
}

export interface DefendAction {
  readonly type: "DEFEND";
}

export interface DodgeAction {
  readonly type: "DODGE";
  readonly direction: Direction;
}

export type Action = MoveAction | AttackAction | DefendAction | DodgeAction;

export function isActionType(value: unknown): value is ActionType {
  return (
    typeof value === "string" &&
    (ACTION_TYPES as readonly string[]).includes(value)
  );
}

export function move(direction: Direction): MoveAction {
  return Object.freeze({ type: "MOVE", direction } as const);
}

export function attack(target: PlayerId): AttackAction {
  return Object.freeze({ type: "ATTACK", target } as const);
}

export function defend(): DefendAction {
  return Object.freeze({ type: "DEFEND" } as const);
}

export function dodge(direction: Direction): DodgeAction {
  return Object.freeze({ type: "DODGE", direction } as const);
}

/**
 * Human-readable one-liner, used by the CLI and the commentary layer.
 *
 * The `never` branch is load-bearing: adding a fifth action breaks compilation
 * here instead of silently falling through at runtime.
 */
export function describeAction(action: Action): string {
  switch (action.type) {
    case "MOVE":
      return `MOVE ${action.direction}`;
    case "ATTACK":
      return `ATTACK ${action.target}`;
    case "DEFEND":
      return "DEFEND";
    case "DODGE":
      return `DODGE ${action.direction}`;
    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled action: ${JSON.stringify(exhaustive)}`);
    }
  }
}
