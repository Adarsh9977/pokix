import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ACTION_TYPES,
  attack,
  defend,
  dodge,
  isActionType,
  move,
  describeAction,
} from "../src/actions";
import type { Action, ActionType } from "../src/actions";

describe("action space", () => {
  it("is bounded to the four actions the spec defines", () => {
    expect([...ACTION_TYPES]).toEqual(["MOVE", "ATTACK", "DEFEND", "DODGE"]);
  });

  it("recognises only those four as action types", () => {
    for (const type of ACTION_TYPES) {
      expect(isActionType(type)).toBe(true);
    }
    expect(isActionType("SCAN")).toBe(false);
    expect(isActionType("")).toBe(false);
    expect(isActionType("move")).toBe(false);
  });
});

describe("action constructors", () => {
  it("builds a directional MOVE", () => {
    expect(move("NORTH")).toEqual({ type: "MOVE", direction: "NORTH" });
  });

  it("builds an ATTACK against a named target", () => {
    expect(attack("B")).toEqual({ type: "ATTACK", target: "B" });
  });

  it("builds a DEFEND with no parameters", () => {
    expect(defend()).toEqual({ type: "DEFEND" });
  });

  it("builds a directional DODGE", () => {
    expect(dodge("WEST")).toEqual({ type: "DODGE", direction: "WEST" });
  });

  it("produces frozen actions so a decision cannot be edited after the fact", () => {
    expect(Object.isFrozen(move("NORTH"))).toBe(true);
    expect(Object.isFrozen(attack("A"))).toBe(true);
    expect(Object.isFrozen(defend())).toBe(true);
    expect(Object.isFrozen(dodge("EAST"))).toBe(true);
  });
});

describe("action discrimination", () => {
  it("narrows on the `type` tag", () => {
    const action: Action = move("SOUTH");
    if (action.type === "MOVE") {
      expectTypeOf(action.direction).toEqualTypeOf<
        "NORTH" | "SOUTH" | "EAST" | "WEST"
      >();
      expect(action.direction).toBe("SOUTH");
    } else {
      throw new Error("expected a MOVE action");
    }
  });

  it("covers every action type exhaustively", () => {
    // If a fifth action is ever added, describeAction stops compiling.
    const samples: Record<ActionType, Action> = {
      MOVE: move("NORTH"),
      ATTACK: attack("B"),
      DEFEND: defend(),
      DODGE: dodge("SOUTH"),
    };
    expect(describeAction(samples.MOVE)).toBe("MOVE NORTH");
    expect(describeAction(samples.ATTACK)).toBe("ATTACK B");
    expect(describeAction(samples.DEFEND)).toBe("DEFEND");
    expect(describeAction(samples.DODGE)).toBe("DODGE SOUTH");
  });
});
