/**
 * Authoritative game state.
 *
 * This holds only facts the engine owns. Nothing inferred, nothing
 * model-generated, nothing presentational. Every value here is the result of a
 * deterministic rule.
 */

import type { Position } from "./geometry";

export const PLAYER_IDS = ["A", "B"] as const;

export type PlayerId = (typeof PLAYER_IDS)[number];

export const MATCH_STATUSES = ["running", "finished"] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

export function isPlayerId(value: unknown): value is PlayerId {
  return (
    typeof value === "string" &&
    (PLAYER_IDS as readonly string[]).includes(value)
  );
}

export function opponentOf(id: PlayerId): PlayerId {
  return id === "A" ? "B" : "A";
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly hp: number;
  readonly energy: number;
  readonly position: Position;
  /**
   * Stored attack power, 0..maxCharge.
   *
   * Builds on any turn the player does not attack and empties the moment
   * they do. It gives the fight a rhythm: a held charge is a visible threat,
   * and because the opponent can see it, "they are winding up" becomes a
   * decision rather than a surprise.
   */
  readonly charge: number;
  /** Ability name -> turns remaining. Empty today; the hook exists for later. */
  readonly cooldowns: Readonly<Record<string, number>>;
}

export interface EnvironmentState {
  readonly width: number;
  readonly height: number;
  readonly obstacles: readonly Position[];
  /** Tiles that restore energy to whoever ends a turn standing on them. */
  readonly energyNodes: readonly Position[];
}

export interface GameState {
  /** 1-based turn number. Turn 1 is the first turn agents decide on. */
  readonly turn: number;
  /**
   * Monotonic snapshot counter, incremented on every resolution.
   *
   * A decision produced for version N must never be applied to version N+1.
   * This is what makes late API responses safe.
   */
  readonly version: number;
  readonly status: MatchStatus;
  readonly players: Record<PlayerId, PlayerState>;
  readonly environment: EnvironmentState;
  /**
   * The winner, once `status` is `"finished"`.
   * `null` means the match ended in a draw. `undefined` means still running.
   */
  readonly winner?: PlayerId | null;
}
