/**
 * The arena renderer.
 *
 * The brief this is built against: a viewer who has never read the rules
 * should be able to tell, at a glance, who is about to get hit and why.
 * Everything drawn here serves that, in roughly this priority:
 *
 *   1. Threat. Each agent's reach is drawn on the floor, so stepping into
 *      danger is visible *before* the hit lands rather than after.
 *   2. Cover. A sight-line between the two agents shows solid when the shot
 *      is available and broken when a pillar is in the way, which is the
 *      single most confusing thing about line of sight otherwise.
 *   3. Intent. The chosen action floats above each agent as it resolves.
 *   4. Consequence. Beams, shields, afterimages, impact rings, damage.
 *
 * It reads authoritative state and draws it. It never writes any, and
 * nothing here can change the outcome of a match.
 */

import type { AgentTurnRecord } from "@jev-arena/agent-core";
import {
  describeAction,
  manhattanDistance,
  type GameConfig,
  type GameState,
  type PlayerId,
  type Position,
} from "@jev-arena/types";
import { useEffect, useRef } from "react";

const COLOUR: Record<PlayerId, string> = { A: "#38e8ff", B: "#ff5ea8" };
const ANIMATION_MS = 520;

export interface ArenaProps {
  readonly config: GameConfig;
  readonly record: AgentTurnRecord | undefined;
  readonly fallbackState: GameState;
  readonly animationKey: number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mirrors the engine's line-of-sight walk, for drawing only. */
function clearLine(
  from: Position,
  to: Position,
  blocked: Set<string>,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    if (
      blocked.has(
        `${Math.round(from.x + dx * t)},${Math.round(from.y + dy * t)}`,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function Arena({
  config,
  record,
  fallbackState,
  animationKey,
}: ArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedAt = useRef(performance.now());
  const camera = useRef({ x: 9.5, y: 9.5, zoom: 1 });

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
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }

      const ctx = context;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const cells = config.arena.width;
      const before = record?.resolution.previous ?? fallbackState;
      const after = record?.resolution.next ?? fallbackState;
      const elapsed = performance.now() - startedAt.current;
      const t = record ? Math.min(1, elapsed / ANIMATION_MS) : 1;
      const eased = easeOut(t);

      const blocked = new Set(
        after.environment.obstacles.map((o) => `${o.x},${o.y}`),
      );

      // --- interpolated positions -----------------------------------------
      const at = (id: PlayerId) => {
        const from = before.players[id].position;
        const to = after.players[id].position;
        return {
          x: lerp(from.x, to.x, eased) + 0.5,
          y: lerp(from.y, to.y, eased) + 0.5,
        };
      };
      const pos = { A: at("A"), B: at("B") };

      // --- camera -----------------------------------------------------------
      // A gentle push toward the action. Never so tight that the arena stops
      // being legible: context is the whole point.
      const midX = (pos.A.x + pos.B.x) / 2;
      const midY = (pos.A.y + pos.B.y) / 2;
      const spread = Math.max(
        Math.abs(pos.A.x - pos.B.x),
        Math.abs(pos.A.y - pos.B.y),
      );
      const targetZoom = Math.max(1, Math.min(1.45, 13 / (spread + 5)));
      camera.current.x = lerp(camera.current.x, midX, 0.05);
      camera.current.y = lerp(camera.current.y, midY, 0.05);
      camera.current.zoom = lerp(camera.current.zoom, targetZoom, 0.04);

      // Impact shake, strongest right after the beam connects.
      const hit = record
        ? Math.max(
            record.resolution.players.A.damageDealt,
            record.resolution.players.B.damageDealt,
          )
        : 0;
      const shakeWindow = Math.max(0, 1 - Math.abs(t - 0.45) * 5);
      const shake = hit > 0 ? shakeWindow * Math.min(5, hit * 0.25) : 0;

      const cell = (size / cells) * camera.current.zoom;
      const originX =
        size / 2 - camera.current.x * cell + (Math.random() - 0.5) * shake;
      const originY =
        size / 2 - camera.current.y * cell + (Math.random() - 0.5) * shake;
      const sx = (x: number) => originX + x * cell;
      const sy = (y: number) => originY + y * cell;

      // --- floor -------------------------------------------------------------
      ctx.fillStyle = "#06080c";
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = "rgba(90, 130, 170, 0.09)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= cells; i += 1) {
        ctx.moveTo(sx(i), sy(0));
        ctx.lineTo(sx(i), sy(cells));
        ctx.moveTo(sx(0), sy(i));
        ctx.lineTo(sx(cells), sy(i));
      }
      ctx.stroke();

      // Arena boundary, so the edges read as walls.
      ctx.strokeStyle = "rgba(120, 170, 210, 0.3)";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(0), sy(0), cells * cell, cells * cell);

      // --- threat footprints -------------------------------------------------
      // The floor tint is the main readability device: you can see who is
      // standing in whose kill zone without knowing a single rule.
      for (const id of ["A", "B"] as const) {
        if (after.players[id].hp <= 0) continue;
        const origin = after.players[id].position;
        const range = config.combat.attackRange;

        for (let dx = -range; dx <= range; dx += 1) {
          for (let dy = -range; dy <= range; dy += 1) {
            const tile = { x: origin.x + dx, y: origin.y + dy };
            if (manhattanDistance(origin, tile) > range) continue;
            if (
              tile.x < 0 ||
              tile.y < 0 ||
              tile.x >= cells ||
              tile.y >= cells
            ) {
              continue;
            }
            if (blocked.has(`${tile.x},${tile.y}`)) continue;
            // A tile you cannot actually shoot into is not a threat.
            if (
              config.combat.requiresLineOfSight &&
              !clearLine(origin, tile, blocked)
            ) {
              continue;
            }
            ctx.fillStyle = `${COLOUR[id]}12`;
            ctx.fillRect(sx(tile.x), sy(tile.y), cell, cell);
          }
        }
      }

      // --- power nodes --------------------------------------------------------
      const pulse = 0.5 + 0.5 * Math.sin(elapsed / 420);
      for (const node of after.environment.energyNodes) {
        const cx = sx(node.x + 0.5);
        const cy = sy(node.y + 0.5);
        const held = (["A", "B"] as const).find(
          (id) =>
            after.players[id].position.x === node.x &&
            after.players[id].position.y === node.y,
        );
        const tint = held ? COLOUR[held] : "#ffd166";

        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 1.3);
        glow.addColorStop(0, `${tint}${held ? "66" : "33"}`);
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 1.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 4 + elapsed / 2600);
        const r = cell * (0.22 + pulse * 0.04);
        ctx.strokeStyle = tint;
        ctx.lineWidth = 2;
        ctx.strokeRect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = `${tint}55`;
        ctx.fillRect(-r * 0.5, -r * 0.5, r, r);
        ctx.restore();
      }

      // --- obstacles ----------------------------------------------------------
      for (const tile of after.environment.obstacles) {
        const x = sx(tile.x);
        const y = sy(tile.y);
        ctx.fillStyle = "#18222f";
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.strokeStyle = "rgba(130, 175, 215, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
        // A lit top edge reads as height rather than as a hole.
        ctx.strokeStyle = "rgba(160, 205, 245, 0.45)";
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 2.5);
        ctx.lineTo(x + cell - 2, y + 2.5);
        ctx.stroke();
      }

      // --- sight line ----------------------------------------------------------
      {
        const a = after.players.A.position;
        const b = after.players.B.position;
        const inRange = manhattanDistance(a, b) <= config.combat.attackRange;
        const open = clearLine(a, b, blocked);
        const alive = after.players.A.hp > 0 && after.players.B.hp > 0;

        if (alive) {
          ctx.save();
          ctx.globalAlpha = inRange ? 0.75 : 0.28;
          ctx.strokeStyle = open ? "#9fe8b0" : "#ff8a8a";
          ctx.lineWidth = 1.5;
          ctx.setLineDash(open ? [] : [4, 5]);
          ctx.beginPath();
          ctx.moveTo(pos.A.x * 0 + sx(pos.A.x), sy(pos.A.y));
          ctx.lineTo(sx(pos.B.x), sy(pos.B.y));
          ctx.stroke();
          ctx.restore();
        }
      }

      // --- movement afterimages -------------------------------------------------
      for (const id of ["A", "B"] as const) {
        const from = before.players[id].position;
        const to = after.players[id].position;
        if (from.x === to.x && from.y === to.y) continue;
        const dodging = record?.resolution.players[id].applied.type === "DODGE";
        const ghosts = dodging ? 4 : 2;
        for (let g = 1; g <= ghosts; g += 1) {
          const back = Math.max(0, eased - g * 0.12);
          ctx.globalAlpha = (1 - g / (ghosts + 1)) * 0.3 * (1 - t);
          ctx.fillStyle = COLOUR[id];
          ctx.beginPath();
          ctx.arc(
            sx(lerp(from.x, to.x, back) + 0.5),
            sy(lerp(from.y, to.y, back) + 0.5),
            cell * 0.3,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // --- attacks ----------------------------------------------------------------
      if (record) {
        for (const id of ["A", "B"] as const) {
          const resolved = record.resolution.players[id];
          if (resolved.applied.type !== "ATTACK" || !resolved.attackOutcome) {
            continue;
          }
          const other = id === "A" ? "B" : "A";
          const from = { x: sx(pos[id].x), y: sy(pos[id].y) };
          const to = { x: sx(pos[other].x), y: sy(pos[other].y) };
          const connected = resolved.damageDealt > 0;

          // Wind-up, then strike, then fade: the beam is readable instead of
          // a single frame flash.
          const charge = Math.min(1, Math.max(0, t / 0.35));
          const strike = Math.max(0, 1 - Math.abs(t - 0.45) * 4);

          if (t < 0.4) {
            ctx.save();
            ctx.globalAlpha = charge * 0.8;
            ctx.fillStyle = COLOUR[id];
            ctx.beginPath();
            ctx.arc(from.x, from.y, cell * 0.12 * charge, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          if (strike > 0) {
            ctx.save();
            ctx.globalAlpha = strike;
            ctx.strokeStyle = connected ? COLOUR[id] : "rgba(150,170,190,0.7)";
            ctx.lineWidth = connected ? cell * 0.18 : cell * 0.07;
            ctx.setLineDash(connected ? [] : [cell * 0.22, cell * 0.18]);
            ctx.shadowColor = COLOUR[id];
            ctx.shadowBlur = connected ? 26 : 0;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            ctx.restore();

            if (connected) {
              ctx.save();
              ctx.globalAlpha = strike;
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(
                to.x,
                to.y,
                cell * (0.4 + (1 - strike) * 0.9),
                0,
                Math.PI * 2,
              );
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      // --- agents --------------------------------------------------------------------
      for (const id of ["A", "B"] as const) {
        const other = id === "A" ? "B" : "A";
        const p = { x: sx(pos[id].x), y: sy(pos[id].y) };
        const player = after.players[id];
        const resolved = record?.resolution.players[id];
        const dead = player.hp <= 0;
        const radius = cell * 0.34;
        const facing = Math.atan2(
          pos[other].y - pos[id].y,
          pos[other].x - pos[id].x,
        );

        ctx.save();
        ctx.globalAlpha = dead ? 0.25 : 1;

        // ground glow
        const glow = ctx.createRadialGradient(
          p.x,
          p.y,
          0,
          p.x,
          p.y,
          radius * 3,
        );
        glow.addColorStop(0, `${COLOUR[id]}3a`);
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 3, 0, Math.PI * 2);
        ctx.fill();

        // hp ring
        const hpFraction = Math.max(0, player.hp / config.player.maxHp);
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 1.45, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = hpFraction > 0.3 ? COLOUR[id] : "#ff6b6b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y,
          radius * 1.45,
          -Math.PI / 2,
          -Math.PI / 2 + hpFraction * Math.PI * 2,
        );
        ctx.stroke();

        // chassis: a directed silhouette, so facing is obvious
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(facing);
        ctx.fillStyle = COLOUR[id];
        ctx.shadowColor = COLOUR[id];
        ctx.shadowBlur = 18;

        if (id === "A") {
          // Arrowhead: light, fast-reading.
          ctx.beginPath();
          ctx.moveTo(radius * 1.15, 0);
          ctx.lineTo(-radius * 0.7, radius * 0.85);
          ctx.lineTo(-radius * 0.3, 0);
          ctx.lineTo(-radius * 0.7, -radius * 0.85);
          ctx.closePath();
          ctx.fill();
        } else {
          // Hexagon: heavier, clearly a different machine.
          ctx.beginPath();
          for (let i = 0; i < 6; i += 1) {
            const angle = (i / 6) * Math.PI * 2;
            const r = i === 0 ? radius * 1.1 : radius * 0.92;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.shadowBlur = 0;

        // dark core, so the silhouette stays readable when it glows
        ctx.fillStyle = "#05080c";
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // identity letter
        ctx.fillStyle = "#e8f6ff";
        ctx.font = `700 ${Math.round(cell * 0.3)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, p.x, p.y + 1);

        // shield: an arc facing the incoming attack
        if (resolved?.applied.type === "DEFEND") {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(facing);
          ctx.strokeStyle = `${COLOUR[id]}dd`;
          ctx.lineWidth = 3.5;
          ctx.shadowColor = COLOUR[id];
          ctx.shadowBlur = 14;
          const flare =
            resolved.damageTaken > 0 ? 1 - Math.abs(t - 0.45) * 3 : 0;
          ctx.globalAlpha = 0.55 + Math.max(0, flare) * 0.45;
          ctx.beginPath();
          ctx.arc(0, 0, radius * 1.9, -0.85, 0.85);
          ctx.stroke();
          ctx.restore();
        }

        ctx.restore();

        // floating intent + damage
        ctx.save();
        ctx.textAlign = "center";
        if (resolved && !dead) {
          ctx.globalAlpha = Math.min(1, 1.6 - t);
          ctx.fillStyle = "#c9dcee";
          ctx.font = `600 ${Math.round(Math.max(9, cell * 0.28))}px ui-monospace, monospace`;
          ctx.fillText(
            describeAction(resolved.applied),
            p.x,
            p.y - radius * 2.3,
          );
        }
        if (resolved && resolved.damageTaken > 0) {
          ctx.globalAlpha = Math.max(0, 1 - t);
          ctx.fillStyle = "#ff8a8a";
          ctx.font = `700 ${Math.round(Math.max(11, cell * 0.44))}px ui-monospace, monospace`;
          ctx.fillText(
            `-${resolved.damageTaken}`,
            p.x + radius * 1.6,
            p.y - radius * 1.4 - eased * cell * 0.8,
          );
        }
        if (resolved && resolved.energyHarvested > 0) {
          ctx.globalAlpha = Math.max(0, 1 - t);
          ctx.fillStyle = "#ffd166";
          ctx.font = `700 ${Math.round(Math.max(10, cell * 0.34))}px ui-monospace, monospace`;
          ctx.fillText(
            `+${resolved.energyHarvested}`,
            p.x - radius * 1.6,
            p.y - radius * 1.4 - eased * cell * 0.8,
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
