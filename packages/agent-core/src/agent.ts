/**
 * The seam between the game and whatever is making decisions.
 *
 * The engine knows this interface and nothing else. It has never heard of
 * TypeSafe, HTTP, latency or credits. That is what lets the entire game run
 * with mock agents and no API access, and it is what keeps the Jev integration
 * replaceable.
 *
 *     Game Engine
 *          |
 *          v
 *     Agent interface
 *          |
 *          +------ MockAgent / ScriptedAgent / HeuristicAgent   (local)
 *          |
 *          +------ JevAgent                                     (adapter)
 */

import type { AgentDecision, AgentObservation } from "@jev-arena/types";

export interface Agent {
  /** Shown in logs and in the HUD. Not used for any game logic. */
  readonly name: string;

  /**
   * Choose what to attempt, given only what this agent is allowed to know.
   *
   * Returning an illegal action is acceptable: the engine validates every
   * decision and substitutes a safe fallback. An implementation must not
   * throw for an ordinary "I could not decide" situation; it should return
   * a decision it can defend. Throwing is reserved for genuine failures.
   */
  decide(observation: AgentObservation): Promise<AgentDecision>;
}
