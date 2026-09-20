/**
 * The arena renderer.
 *
 * Canvas, animated on requestAnimationFrame, interpolating between the turn's
 * "before" and "after" snapshots. It reads authoritative state and draws it;
 * it never writes any. Nothing here can change the outcome of a match.
 */

import type { AgentTurnRecord } from "@jev-arena/agent-core";
import type { GameConfig, GameState, PlayerId } from "@jev-arena/types";
import { useEffect, useRef } from "react";

const COLOURS: Record<PlayerId, string> = { A: "#38e8ff", B: "#ff5ea8" };
const ANIMATION_MS = 520;

export interface ArenaProps {
  readonly config: GameConfig;
  readonly record: AgentTurnRecord | undefined;
  readonly fallbackState: GameState;
  /** Bumped whenever a new turn should replay its animation. */
  readonly animationKey: number;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function Arena({
  config,
  record,
  fallbackState,
  animationKey,
}: ArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedAt = useRef(performance.now());

  useEffect(() => {
    startedAt.current = performance.now();
  }, [animationKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = Math.min(canvas.clientWidth, canvas.clientHeight);
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }

      const ctx = context;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const cells = config.arena.width;
      const cell = size / cells;
      const before = record?.resolution.previous ?? fallbackState;
      const after = record?.resolution.next ?? fallbackState;

      const elapsed = performance.now() - startedAt.current;
      const t = record ? Math.min(1, elapsed / ANIMATION_MS) : 1;
      const eased = easeOutCubic(t);

      // --- floor -----------------------------------------------------------
      ctx.fillStyle = "#080b10";
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = "rgba(90, 130, 170, 0.10)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= cells; i += 1) {
        const p = Math.round(i * cell) + 0.5;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
      }

      // --- obstacles -------------------------------------------------------
      for (const tile of after.environment.obstacles) {
        const x = tile.x * cell;
        const y = tile.y * cell;
        ctx.fillStyle = "#151d28";
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.strokeStyle = "rgba(120, 160, 200, 0.22)";
        ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
      }

      const centre = (id: PlayerId) => {
        const from = before.players[id].position;
        const to = after.players[id].position;
        return {
          x: (from.x + (to.x - from.x) * eased + 0.5) * cell,
          y: (from.y + (to.y - from.y) * eased + 0.5) * cell,
        };
      };

      // --- movement trails --------------------------------------------------
      for (const id of ["A", "B"] as const) {
        const from = before.players[id].position;
        const to = after.players[id].position;
        if (from.x === to.x && from.y === to.y) continue;
        const now = centre(id);
        const grad = ctx.createLinearGradient(
          (from.x + 0.5) * cell,
          (from.y + 0.5) * cell,
          now.x,
          now.y,
        );
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, `${COLOURS[id]}55`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = cell * 0.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo((from.x + 0.5) * cell, (from.y + 0.5) * cell);
        ctx.lineTo(now.x, now.y);
        ctx.stroke();
      }

      // --- attacks ----------------------------------------------------------
      if (record) {
        for (const id of ["A", "B"] as const) {
          const resolved = record.resolution.players[id];
          if (resolved.applied.type !== "ATTACK" || !resolved.attackOutcome) {
            continue;
          }
          const other = id === "A" ? "B" : "A";
          const from = centre(id);
          const to = centre(other);
          const connected = resolved.damageDealt > 0;
          // Beam snaps out early in the animation, then fades.
          const flash = Math.max(0, 1 - Math.abs(t - 0.35) * 3);
          if (flash <= 0) continue;

          ctx.save();
          ctx.globalAlpha = flash;
          ctx.strokeStyle = connected ? COLOURS[id] : "rgba(150,170,190,0.65)";
          ctx.lineWidth = connected ? cell * 0.22 : cell * 0.09;
          ctx.setLineDash(connected ? [] : [cell * 0.25, cell * 0.2]);
          ctx.shadowColor = COLOURS[id];
          ctx.shadowBlur = connected ? 22 : 0;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // --- agents -----------------------------------------------------------
      for (const id of ["A", "B"] as const) {
        const position = centre(id);
        const player = after.players[id];
        const resolved = record?.resolution.players[id];
        const radius = cell * 0.36;
        const dead = player.hp <= 0;

        ctx.save();
        ctx.globalAlpha = dead ? 0.28 : 1;

        // glow
        const glow = ctx.createRadialGradient(
          position.x,
          position.y,
          0,
          position.x,
          position.y,
          radius * 2.6,
        );
        glow.addColorStop(0, `${COLOURS[id]}44`);
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius * 2.6, 0, Math.PI * 2);
        ctx.fill();

        // body
        ctx.fillStyle = COLOURS[id];
        ctx.shadowColor = COLOURS[id];
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // label
        ctx.fillStyle = "#04070b";
        ctx.font = `700 ${Math.round(cell * 0.42)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, position.x, position.y + 1);

        // shield ring for a defender
        if (resolved?.applied.type === "DEFEND") {
          ctx.strokeStyle = `${COLOURS[id]}cc`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(
            position.x,
            position.y,
            radius * (1.55 + 0.12 * Math.sin(elapsed / 140)),
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }

        // damage number
        if (resolved && resolved.damageTaken > 0) {
          ctx.globalAlpha = Math.max(0, 1 - t) * (dead ? 0.6 : 1);
          ctx.fillStyle = "#ff8a8a";
          ctx.font = `700 ${Math.round(cell * 0.55)}px ui-monospace, monospace`;
          ctx.fillText(
            `-${resolved.damageTaken}`,
            position.x,
            position.y - radius - cell * 0.5 - eased * cell * 0.7,
          );
        }

        ctx.restore();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [config, record, fallbackState]);

  return <canvas ref={canvasRef} className="arena-canvas" />;
}
