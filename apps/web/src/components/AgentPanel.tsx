/**
 * One agent's HUD.
 *
 * Shows the game-level facts plus the decision behind them: what was chosen,
 * how confident the model was, the distribution it chose from, and how long
 * it took. Provider internals stay out of it; a category is shown when
 * something failed, not a stack trace.
 */

import type { AgentTurnRecord } from "@jev-arena/agent-core";
import {
  STRATEGY_PROFILES,
  STRATEGY_PROFILE_IDS,
  describeAction,
  type ActionType,
  type GameConfig,
  type GameState,
  type PlayerId,
  type StrategyProfileId,
} from "@jev-arena/types";

const ACTION_ORDER: ActionType[] = ["MOVE", "ATTACK", "DEFEND", "DODGE"];

export interface AgentPanelProps {
  readonly id: PlayerId;
  readonly name: string;
  readonly config: GameConfig;
  readonly state: GameState;
  readonly record: AgentTurnRecord | undefined;
  readonly thinking: boolean;
  readonly profile: StrategyProfileId;
  readonly onProfileChange: (profile: StrategyProfileId) => void;
}

function Meter({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <div
          className="meter-fill"
          style={{ width: `${pct}%`, background: tone }}
        />
      </div>
      <span className="meter-value">{value}</span>
    </div>
  );
}

export function AgentPanel({
  id,
  name,
  config,
  state,
  record,
  thinking,
  profile,
  onProfileChange,
}: AgentPanelProps) {
  const player = state.players[id];
  const decision = record?.decisions[id];
  const trace = record?.traces[id];
  const resolved = record?.resolution.players[id];
  const onNode = config.arena.energyNodes.some(
    (tile) => tile.x === player.position.x && tile.y === player.position.y,
  );

  return (
    <section className={`panel panel-${id}`}>
      <header className="panel-head">
        <span className="panel-dot" />
        <h2>{name.split(" · ").slice(0, 2).join(" · ")}</h2>
        {player.hp <= 0 && <span className="panel-flag down">DOWN</span>}
      </header>

      <label className="profile-picker">
        <select
          value={profile}
          onChange={(event) =>
            onProfileChange(event.target.value as StrategyProfileId)
          }
        >
          {STRATEGY_PROFILE_IDS.map((option) => (
            <option key={option} value={option}>
              {STRATEGY_PROFILES[option].label}
            </option>
          ))}
        </select>
        <small>{STRATEGY_PROFILES[profile].blurb}</small>
      </label>

      <Meter
        label="HP"
        value={player.hp}
        max={config.player.maxHp}
        tone={id === "A" ? "#38e8ff" : "#ff5ea8"}
      />
      <Meter
        label="EN"
        value={player.energy}
        max={config.player.maxEnergy}
        tone={onNode ? "#ffd166" : "#6b7f95"}
      />

      <div className="tags">
        <span className={`tag ${onNode ? "on" : ""}`}>
          {onNode ? "on power node" : "no node"}
        </span>
        {resolved && resolved.energyHarvested > 0 && (
          <span className="tag energy">+{resolved.energyHarvested} energy</span>
        )}
      </div>

      <div className="decision">
        {thinking ? (
          <div className="thinking">
            <span className="pulse" /> deciding…
          </div>
        ) : decision ? (
          <>
            <div className="decision-row">
              <span className="decision-action">
                {describeAction(decision.action)}
              </span>
              {decision.origin !== "model" && (
                <span className={`origin ${decision.origin}`}>
                  {decision.origin}
                </span>
              )}
            </div>

            {resolved?.rejection && (
              <div className="rejection">
                rejected · {resolved.rejection.reason} → DEFEND
              </div>
            )}
            {resolved?.attackOutcome && (
              <div className="outcome">{resolved.attackOutcome}</div>
            )}

            {decision.probabilities && (
              <div className="dist">
                {ACTION_ORDER.filter(
                  (type) => decision.probabilities?.[type] !== undefined,
                ).map((type) => {
                  const p = decision.probabilities?.[type] ?? 0;
                  return (
                    <div key={type} className="dist-row">
                      <span className="dist-key">{type}</span>
                      <div className="dist-track">
                        <div
                          className="dist-fill"
                          style={{
                            width: `${Math.round(p * 100)}%`,
                            background:
                              decision.action.type === type
                                ? id === "A"
                                  ? "#38e8ff"
                                  : "#ff5ea8"
                                : "#31404f",
                          }}
                        />
                      </div>
                      <span className="dist-val">{p.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <dl className="facts">
              {decision.confidence !== undefined && (
                <>
                  <dt>confidence</dt>
                  <dd>{decision.confidence.toFixed(2)}</dd>
                </>
              )}
              {trace && (
                <>
                  <dt>latency</dt>
                  <dd>{trace.latencyMs} ms</dd>
                </>
              )}
              {trace?.model && (
                <>
                  <dt>model</dt>
                  <dd>{trace.model}</dd>
                </>
              )}
            </dl>

            {trace?.errorCategory && (
              <div className="failure">
                {trace.errorCategory}
                <span>{trace.error}</span>
              </div>
            )}
          </>
        ) : (
          <div className="idle-note">waiting for the first turn</div>
        )}
      </div>
    </section>
  );
}
