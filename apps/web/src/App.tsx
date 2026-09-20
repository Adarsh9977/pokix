import { DEFAULT_GAME_CONFIG, PLAYER_IDS } from "@jev-arena/types";
import { useMemo } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { Arena } from "./components/Arena";
import { initialSnapshot, useMatch } from "./game/use-match";

const config = DEFAULT_GAME_CONFIG;

export default function App() {
  const match = useMatch(config);
  const blank = useMemo(() => initialSnapshot(config), []);

  const shown = match.viewing;
  const state = shown?.resolution.next ?? blank;
  const thinking = match.phase === "thinking";
  const live = match.phase === "thinking" || match.phase === "animating";
  const finished = state.status === "finished";

  return (
    <div className="app">
      <header className="masthead">
        <h1>
          JEV<span className="a">·</span>ARENA<span className="b">_</span>
        </h1>
        <p>
          Two agents observe the same world, decide simultaneously, and a
          deterministic engine turns those decisions into consequences.
        </p>
      </header>

      <div className="mode-switch" role="group" aria-label="Agent mode">
        <button
          type="button"
          className={match.mode === "local" ? "on" : ""}
          onClick={() => match.setMode("local")}
        >
          Local agents
          <small>free · instant · deterministic</small>
        </button>
        <button
          type="button"
          className={match.mode === "jev" ? "on" : ""}
          onClick={() => match.setMode("jev")}
        >
          Jev agents
          <small>
            {match.jevAvailable === undefined
              ? "real model · checking server…"
              : match.jevAvailable
                ? "real model · server key detected"
                : "real model · no server key configured"}
          </small>
        </button>
      </div>

      <main className="stage">
        <AgentPanel
          id="A"
          name={match.agentNames.A}
          config={config}
          state={state}
          record={shown}
          thinking={thinking}
          profile={match.profiles.A}
          onProfileChange={(profile) => match.setProfile("A", profile)}
        />

        <div className="arena-wrap">
          <Arena
            config={config}
            record={shown}
            fallbackState={blank}
            animationKey={match.viewIndex}
          />

          <div className="arena-status">
            {finished ? (
              <strong className="verdict">
                {state.winner ? `AGENT ${state.winner} WINS` : "DRAW"}
              </strong>
            ) : (
              <span>
                TURN {shown?.turn ?? 0}
                {thinking && " · agents deciding"}
              </span>
            )}
          </div>
        </div>

        <AgentPanel
          id="B"
          name={match.agentNames.B}
          config={config}
          state={state}
          record={shown}
          thinking={thinking}
          profile={match.profiles.B}
          onProfileChange={(profile) => match.setProfile("B", profile)}
        />
      </main>

      <div className="controls">
        {match.phase === "idle" || match.phase === "paused" ? (
          <button type="button" className="primary" onClick={match.start}>
            {match.turns.length === 0 ? "Start match" : "Resume"}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={match.pause}
            disabled={finished}
          >
            Pause
          </button>
        )}

        <button type="button" onClick={match.step} disabled={live || finished}>
          Step
        </button>
        <button type="button" onClick={match.reset}>
          Reset
        </button>

        <label className="speed">
          Speed
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.5}
            value={match.speed}
            onChange={(event) => match.setSpeed(Number(event.target.value))}
          />
          <span>{match.speed}×</span>
        </label>

        {match.turns.length > 0 && (
          <label className="timeline">
            Replay
            <input
              type="range"
              min={0}
              max={match.turns.length - 1}
              value={Math.max(0, match.viewIndex)}
              onChange={(event) =>
                match.setViewIndex(Number(event.target.value))
              }
            />
            <span>
              {Math.max(0, match.viewIndex) + 1}/{match.turns.length}
            </span>
          </label>
        )}
      </div>

      {match.mode === "jev" && match.jevAvailable === false && (
        <div className="banner">
          <strong>NO SERVER KEY</strong>
          <span>
            This deployment has no TYPESAFE_API_KEY, so Jev agents cannot
            decide. Every turn will fall back to DEFEND.
          </span>
          <em>
            Set TYPESAFE_API_KEY in your Vercel project settings and redeploy,
            or switch to Local agents — they play the full game for free.
          </em>
        </div>
      )}

      {match.error && (
        <div className="banner">
          <strong>{match.error.category}</strong>
          <span>{match.error.message}</span>
          {match.mode === "jev" && (
            <em>
              The match keeps running — the engine substitutes DEFEND when an
              agent cannot answer. Switch to Local agents to play without an API
              key.
            </em>
          )}
        </div>
      )}

      <div className="key">
        <span>
          <i className="swatch threat-a" /> A&apos;s reach
        </span>
        <span>
          <i className="swatch threat-b" /> B&apos;s reach
        </span>
        <span>
          <i className="swatch node" /> power node (+
          {config.combat.energyNodeRestore} energy)
        </span>
        <span>
          <i className="swatch cover" /> cover blocks the shot
        </span>
        <span>
          <i className="swatch sight-open" /> clear line
        </span>
        <span>
          <i className="swatch sight-blocked" /> blocked line
        </span>
      </div>

      <footer className="legend">
        <span>
          OBSERVE <b>→</b> JEV DECIDES <b>→</b> TYPED ACTION <b>→</b> ENGINE
          RESOLVES <b>→</b> NEW STATE
        </span>
        <span className="muted">
          {config.arena.width}×{config.arena.height} arena · turn limit{" "}
          {config.maxTurns} · attack range {config.combat.attackRange} ·{" "}
          {PLAYER_IDS.length} agents, identical capabilities
        </span>
      </footer>
    </div>
  );
}
