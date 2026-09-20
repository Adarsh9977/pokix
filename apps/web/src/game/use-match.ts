/**
 * Drives a match from React, one turn at a time.
 *
 * The important separation: the simulation is never driven by the renderer.
 * The orchestrator resolves a turn as fast as the agents allow; the UI then
 * spends a fixed amount of wall-clock time animating it. Rendering speed
 * cannot change the outcome, and a slow agent cannot drop a frame.
 */

import {
  DEFAULT_GAME_CONFIG,
  STRATEGY_PROFILES,
  type GameConfig,
  type PlayerId,
  type StrategyProfileId,
} from "@jev-arena/types";
import {
  HeuristicAgent,
  MatchOrchestrator,
  type Agent,
  type AgentTurnRecord,
} from "@jev-arena/agent-core";
import { createInitialState } from "@jev-arena/game-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RemoteJevAgent } from "./remote-jev-agent";

export type AgentMode = "local" | "jev";
export type MatchPhase =
  "idle" | "thinking" | "animating" | "paused" | "finished";

export interface MatchError {
  readonly category: string;
  readonly message: string;
}

const TURN_ANIMATION_MS = 520;

export type Profiles = Record<PlayerId, StrategyProfileId>;

/**
 * Different profiles by default.
 *
 * Two identical policies starting mirror-symmetrically fight to an exact
 * draw. That is a good property to have proven, and a dull thing to put in
 * front of someone.
 */
export const DEFAULT_PROFILES: Profiles = { A: "aggressive", B: "tactical" };

function buildAgents(
  mode: AgentMode,
  profiles: Profiles,
): Record<PlayerId, Agent> {
  const label = (id: PlayerId) =>
    `${mode === "jev" ? "Jev" : "Local"} · ${id} · ${STRATEGY_PROFILES[profiles[id]].label}`;

  if (mode === "jev") {
    return {
      A: new RemoteJevAgent({ name: label("A"), profile: profiles.A }),
      B: new RemoteJevAgent({ name: label("B"), profile: profiles.B }),
    };
  }
  return {
    A: new HeuristicAgent({ name: label("A"), profile: profiles.A }),
    B: new HeuristicAgent({ name: label("B"), profile: profiles.B }),
  };
}

export interface UseMatch {
  readonly config: GameConfig;
  readonly mode: AgentMode;
  readonly phase: MatchPhase;
  readonly turns: readonly AgentTurnRecord[];
  /** The turn currently on screen. Lets the timeline scrub the past. */
  readonly viewIndex: number;
  readonly viewing: AgentTurnRecord | undefined;
  readonly agentNames: Record<PlayerId, string>;
  readonly error: MatchError | undefined;
  readonly speed: number;
  /**
   * Whether the server has a TypeSafe key. `undefined` while unknown.
   * Lets the UI say so before you press Start, rather than after.
   */
  readonly jevAvailable: boolean | undefined;
  readonly profiles: Profiles;
  setMode(mode: AgentMode): void;
  setProfile(id: PlayerId, profile: StrategyProfileId): void;
  setSpeed(speed: number): void;
  setViewIndex(index: number): void;
  start(): void;
  pause(): void;
  step(): void;
  reset(): void;
}

export function useMatch(config: GameConfig = DEFAULT_GAME_CONFIG): UseMatch {
  const [mode, setModeState] = useState<AgentMode>("local");
  const [phase, setPhase] = useState<MatchPhase>("idle");
  const [turns, setTurns] = useState<AgentTurnRecord[]>([]);
  const [viewIndex, setViewIndex] = useState(-1);
  const [error, setError] = useState<MatchError | undefined>();
  const [speed, setSpeed] = useState(1);
  const [jevAvailable, setJevAvailable] = useState<boolean | undefined>();
  const [profiles, setProfiles] = useState<Profiles>(DEFAULT_PROFILES);

  const orchestratorRef = useRef<MatchOrchestrator | null>(null);
  const runningRef = useRef(false);
  const modeRef = useRef(mode);
  const speedRef = useRef(speed);
  const followRef = useRef(true);
  const profilesRef = useRef(profiles);

  modeRef.current = mode;
  speedRef.current = speed;
  profilesRef.current = profiles;

  const agentNames = useMemo<Record<PlayerId, string>>(() => {
    const kind = mode === "jev" ? "Jev" : "Local";
    return {
      A: `${kind} · A · ${STRATEGY_PROFILES[profiles.A].label}`,
      B: `${kind} · B · ${STRATEGY_PROFILES[profiles.B].label}`,
    };
  }, [mode, profiles]);

  const ensureOrchestrator = useCallback((): MatchOrchestrator => {
    if (!orchestratorRef.current) {
      orchestratorRef.current = new MatchOrchestrator(
        buildAgents(modeRef.current, profilesRef.current),
        {
          config,
          matchId: `web-${Date.now()}`,
          // Generous: a cold serverless function plus a model call can be
          // slow, and a false timeout would look like the agent gave up.
          decisionTimeoutMs: 30_000,
        },
      );
    }
    return orchestratorRef.current;
  }, [config]);

  const playOneTurn = useCallback(async (): Promise<boolean> => {
    const orchestrator = ensureOrchestrator();
    if (orchestrator.state.status !== "running") {
      setPhase("finished");
      return false;
    }

    setPhase("thinking");
    try {
      const record = await orchestrator.playTurn();
      setTurns((previous) => {
        const next = [...previous, record];
        if (followRef.current) setViewIndex(next.length - 1);
        return next;
      });

      // Surface a decision failure without stopping the match: the engine
      // already substituted a fallback, so the game is still valid.
      const failing = (["A", "B"] as const)
        .map((id) => record.traces[id])
        .find((trace) => trace.errorCategory !== undefined);
      setError(
        failing
          ? {
              category: failing.errorCategory ?? "PROVIDER_ERROR",
              message: failing.error ?? "A decision failed.",
            }
          : undefined,
      );

      setPhase("animating");
      await new Promise((resolve) =>
        setTimeout(resolve, TURN_ANIMATION_MS / speedRef.current),
      );

      if (orchestrator.state.status !== "running") {
        setPhase("finished");
        return false;
      }
      return true;
    } catch (caught) {
      setError({
        category: "INTERNAL_GAME_ERROR",
        message: caught instanceof Error ? caught.message : String(caught),
      });
      setPhase("paused");
      return false;
    }
  }, [ensureOrchestrator]);

  const loop = useCallback(async () => {
    while (runningRef.current) {
      const shouldContinue = await playOneTurn();
      if (!shouldContinue) break;
    }
    runningRef.current = false;
    setPhase((current) => (current === "finished" ? current : "paused"));
  }, [playOneTurn]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    followRef.current = true;
    runningRef.current = true;
    void loop();
  }, [loop]);

  const pause = useCallback(() => {
    runningRef.current = false;
  }, []);

  const step = useCallback(() => {
    if (runningRef.current) return;
    followRef.current = true;
    void playOneTurn();
  }, [playOneTurn]);

  const reset = useCallback(() => {
    runningRef.current = false;
    orchestratorRef.current = null;
    followRef.current = true;
    setTurns([]);
    setViewIndex(-1);
    setError(undefined);
    setPhase("idle");
  }, []);

  const setMode = useCallback(
    (next: AgentMode) => {
      setModeState(next);
      modeRef.current = next;
      reset();
    },
    [reset],
  );

  // Changing a profile starts a new match: mid-fight is not a fair moment to
  // swap an agent's personality out from under it.
  const setProfile = useCallback(
    (id: PlayerId, profile: StrategyProfileId) => {
      setProfiles((current) => {
        const next = { ...current, [id]: profile };
        profilesRef.current = next;
        return next;
      });
      reset();
    },
    [reset],
  );

  const scrub = useCallback(
    (index: number) => {
      // Scrubbing back detaches from live play; scrubbing to the end
      // re-attaches.
      followRef.current = index >= turns.length - 1;
      setViewIndex(index);
    },
    [turns.length],
  );

  // Ask the server what this deployment can do. AGENT_MODE decides the
  // starting mode, but only if a key is actually present: starting in a mode
  // that cannot work would be worse than ignoring the setting.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/config");
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          agentMode?: string;
          jevConfigured?: boolean;
        };
        if (cancelled) return;
        setJevAvailable(Boolean(body.jevConfigured));
        if (body.agentMode === "jev" && body.jevConfigured) {
          setModeState("jev");
          modeRef.current = "jev";
        }
      } catch {
        // No endpoint at all: a plain `vite build` preview, or `npm run dev`
        // with nothing serving /api. Local agents still work perfectly.
        if (!cancelled) setJevAvailable(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => void (runningRef.current = false), []);

  const viewing = viewIndex >= 0 ? turns[viewIndex] : undefined;

  return {
    config,
    mode,
    phase,
    turns,
    viewIndex,
    viewing,
    agentNames,
    error,
    speed,
    jevAvailable,
    profiles,
    setMode,
    setProfile,
    setSpeed,
    setViewIndex: scrub,
    start,
    pause,
    step,
    reset,
  };
}

/** The state to draw when no turn has been played yet. */
export function initialSnapshot(config: GameConfig) {
  return createInitialState(config);
}
