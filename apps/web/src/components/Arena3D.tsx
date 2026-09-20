/**
 * The 3D arena.
 *
 * Same job as the old 2D canvas: make the tactics legible. The board is a
 * floating slab in the dark, lit so the two robots are the brightest things
 * in frame, with the tactical overlays painted flat on the floor where they
 * cannot compete with the characters.
 *
 * Still true, and still the important part: this reads authoritative state
 * and draws it. Nothing here can change the outcome of a match, and the
 * animation budget is fixed wall-clock time that the simulation never waits
 * for.
 */

import { Grid, Line, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
/** Only the bit of the controls we touch. */
type OrbitTarget = { target: THREE.Vector3; update: () => void };
import {
  manhattanDistance,
  type GameConfig,
  type GameState,
  type PlayerId,
  type Position,
} from "@jev-arena/types";
import type { AgentTurnRecord } from "@jev-arena/agent-core";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Robot, type Mood } from "./Robot";

const COLOUR: Record<PlayerId, string> = { A: "#39e6ff", B: "#ff6bb3" };
const ANIMATION_MS = 520;

export interface Arena3DProps {
  readonly config: GameConfig;
  readonly record: AgentTurnRecord | undefined;
  readonly fallbackState: GameState;
  readonly animationKey: number;
}

/** Board space: centre the grid on the origin so the camera maths is simple. */
function toWorld(p: { x: number; y: number }, size: number): [number, number] {
  return [p.x - size / 2 + 0.5, p.y - size / 2 + 0.5];
}

function clearLine(
  from: Position,
  to: Position,
  blocked: Set<string>,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let s = 1; s < steps; s += 1) {
    const t = s / steps;
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

function moodFor(
  record: AgentTurnRecord | undefined,
  id: PlayerId,
  state: GameState,
): Mood {
  if (state.players[id].hp <= 0) return "down";
  const resolved = record?.resolution.players[id];
  if (!resolved) return "idle";
  if (resolved.damageTaken > 0) return "hurt";
  switch (resolved.applied.type) {
    case "ATTACK":
      return "attack";
    case "DEFEND":
      return "defend";
    case "DODGE":
      return "dodge";
    default:
      return "idle";
  }
}

function Scene({ config, record, fallbackState, animationKey }: Arena3DProps) {
  const size = config.arena.width;
  const started = useRef(performance.now());
  const beat = useRef(1);
  // The orbit controls own the camera. Following the action means moving
  // their target, not calling camera.lookAt behind their back - doing both
  // makes the view fight itself every frame.
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  const lastKey = useRef(animationKey);
  if (lastKey.current !== animationKey) {
    lastKey.current = animationKey;
    started.current = performance.now();
  }

  const before = record?.resolution.previous ?? fallbackState;
  const after = record?.resolution.next ?? fallbackState;

  const blocked = useMemo(
    () => new Set(after.environment.obstacles.map((o) => `${o.x},${o.y}`)),
    [after.environment.obstacles],
  );

  useFrame(() => {
    beat.current = Math.min(
      1,
      (performance.now() - started.current) / ANIMATION_MS,
    );

    // Drift toward the midpoint between the robots, so the action stays
    // centred without the viewer losing the board.
    const orbit = controls.current as OrbitTarget | null;
    if (orbit) {
      const [ax, az] = toWorld(after.players.A.position, size);
      const [bx, bz] = toWorld(after.players.B.position, size);
      orbit.target.lerp(
        new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2),
        0.03,
      );
      orbit.update();
    }
  });

  const eased = (t: number) => 1 - (1 - t) ** 3;
  const positionOf = (id: PlayerId): [number, number, number] => {
    const t = eased(beat.current);
    const [fx, fz] = toWorld(before.players[id].position, size);
    const [tx, tz] = toWorld(after.players[id].position, size);
    return [fx + (tx - fx) * t, 0.62, fz + (tz - fz) * t];
  };

  const facingOf = (id: PlayerId): number => {
    const other = id === "A" ? "B" : "A";
    const [sx, sz] = toWorld(after.players[id].position, size);
    const [ox, oz] = toWorld(after.players[other].position, size);
    return Math.atan2(ox - sx, oz - sz);
  };

  const sightOpen = clearLine(
    after.players.A.position,
    after.players.B.position,
    blocked,
  );
  const inRange =
    manhattanDistance(after.players.A.position, after.players.B.position) <=
    config.combat.attackRange;

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 12, 4]} intensity={1.1} castShadow />
      {(["A", "B"] as const satisfies readonly PlayerId[]).map((id) => {
        const [lx, lz] = toWorld(after.players[id].position, size);
        return (
          <pointLight
            key={`light-${id}`}
            position={[lx, 2, lz]}
            color={COLOUR[id]}
            intensity={12}
            distance={7}
          />
        );
      })}

      {/* board slab */}
      <RoundedBox
        args={[size + 0.6, 0.5, size + 0.6]}
        radius={0.25}
        smoothness={4}
        position={[0, 0.05, 0]}
        receiveShadow
      >
        <meshStandardMaterial
          color="#0d141c"
          roughness={0.85}
          metalness={0.1}
        />
      </RoundedBox>

      <Grid
        args={[size, size]}
        position={[0, 0.31, 0]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#22384c"
        sectionSize={5}
        sectionThickness={1.1}
        sectionColor="#2f5a78"
        fadeDistance={48}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* threat footprints: the main readability device, flat on the floor */}
      {(["A", "B"] as const).map((id) => {
        if (after.players[id].hp <= 0) return null;
        const origin = after.players[id].position;
        const tiles: Position[] = [];
        const range = config.combat.attackRange;
        for (let dx = -range; dx <= range; dx += 1) {
          for (let dy = -range; dy <= range; dy += 1) {
            const tile = { x: origin.x + dx, y: origin.y + dy };
            if (manhattanDistance(origin, tile) > range) continue;
            if (tile.x < 0 || tile.y < 0 || tile.x >= size || tile.y >= size)
              continue;
            if (blocked.has(`${tile.x},${tile.y}`)) continue;
            if (
              config.combat.requiresLineOfSight &&
              !clearLine(origin, tile, blocked)
            ) {
              continue;
            }
            tiles.push(tile);
          }
        }
        return (
          <group key={id}>
            {tiles.map((tile) => {
              const [wx, wz] = toWorld(tile, size);
              return (
                <mesh
                  key={`${tile.x},${tile.y}`}
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[wx, 0.32, wz]}
                >
                  <planeGeometry args={[0.94, 0.94]} />
                  <meshBasicMaterial
                    color={COLOUR[id]}
                    transparent
                    opacity={0.09}
                    depthWrite={false}
                  />
                </mesh>
              );
            })}
          </group>
        );
      })}

      {/* obstacles */}
      {after.environment.obstacles.map((tile) => {
        const [wx, wz] = toWorld(tile, size);
        return (
          <RoundedBox
            key={`o-${tile.x}-${tile.y}`}
            args={[0.9, 0.95, 0.9]}
            radius={0.12}
            smoothness={3}
            position={[wx, 0.78, wz]}
            castShadow
          >
            <meshStandardMaterial
              color="#243546"
              roughness={0.7}
              metalness={0.2}
              emissive="#0e2233"
              emissiveIntensity={0.4}
            />
          </RoundedBox>
        );
      })}

      {/* power nodes */}
      {after.environment.energyNodes.map((tile) => {
        const [wx, wz] = toWorld(tile, size);
        const held = (["A", "B"] as const).find(
          (id) =>
            after.players[id].position.x === tile.x &&
            after.players[id].position.y === tile.y,
        );
        return (
          <PowerNode
            key={`n-${tile.x}-${tile.y}`}
            position={[wx, 0.72, wz]}
            colour={held ? COLOUR[held] : "#ffd166"}
          />
        );
      })}

      {/* sight line */}
      {after.players.A.hp > 0 && after.players.B.hp > 0 && (
        <SightLine
          from={positionOf("A")}
          to={positionOf("B")}
          open={sightOpen}
          strong={inRange}
        />
      )}

      {/* attack beams */}
      {(["A", "B"] as const).map((id) => {
        const resolved = record?.resolution.players[id];
        if (!resolved || resolved.applied.type !== "ATTACK") return null;
        if (!resolved.attackOutcome) return null;
        const other = id === "A" ? "B" : "A";
        return (
          <Beam
            key={`beam-${id}`}

            from={positionOf(id)}
            to={positionOf(other)}
            colour={COLOUR[id]}
            connected={resolved.damageDealt > 0}
            beat={beat}
          />
        );
      })}

      {/* the robots */}
      <group>
        <Robot
          colour={COLOUR.A}
          label="A"
          position={positionOf("A")}
          facing={facingOf("A")}
          mood={moodFor(record, "A", after)}
          charge={after.players.A.charge / config.combat.maxCharge}
          hp={Math.max(0, after.players.A.hp / config.player.maxHp)}
          beat={beat.current}
          hopping={
            before.players.A.position.x !== after.players.A.position.x ||
            before.players.A.position.y !== after.players.A.position.y
          }
        />
      </group>
      <group>
        <Robot
          colour={COLOUR.B}
          label="B"
          position={positionOf("B")}
          facing={facingOf("B")}
          mood={moodFor(record, "B", after)}
          charge={after.players.B.charge / config.combat.maxCharge}
          hp={Math.max(0, after.players.B.hp / config.player.maxHp)}
          beat={beat.current}
          hopping={
            before.players.B.position.x !== after.players.B.position.x ||
            before.players.B.position.y !== after.players.B.position.y
          }
        />
      </group>

      <OrbitControls
        ref={controls}
        enablePan={false}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.35}
        minDistance={14}
        maxDistance={38}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

function PowerNode({
  position,
  colour,
}: {
  position: [number, number, number];
  colour: string;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!mesh.current) return;
    const t = state.clock.elapsedTime;
    mesh.current.rotation.y = t * 0.9;
    mesh.current.rotation.x = Math.sin(t * 0.7) * 0.25;
    mesh.current.position.y = position[1] + Math.sin(t * 1.8) * 0.09;
  });
  return (
    <group position={position}>
      <mesh ref={mesh}>
        <octahedronGeometry args={[0.24, 0]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]}>
        <circleGeometry args={[0.42, 22]} />
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>
      <pointLight color={colour} intensity={3} distance={3} />
    </group>
  );
}

function SightLine({
  from,
  to,
  open,
  strong,
}: {
  from: [number, number, number];
  to: [number, number, number];
  open: boolean;
  strong: boolean;
}) {
  // drei's Line owns its geometry and material and disposes of them.
  // Constructing a THREE.Line inline here would allocate a fresh pair every
  // frame and never free them.
  return (
    <Line
      points={[
        [from[0], 0.36, from[2]],
        [to[0], 0.36, to[2]],
      ]}
      color={open ? "#8ff0a8" : "#ff8a8a"}
      lineWidth={strong ? 2.2 : 1.2}
      dashed={!open}
      dashSize={0.32}
      gapSize={0.26}
      transparent
      opacity={strong ? 0.9 : 0.32}
    />
  );
}

const Beam = ({
  from,
  to,
  colour,
  connected,
  beat,
}: {
  from: [number, number, number];
  to: [number, number, number];
  colour: string;
  connected: boolean;
  beat: React.RefObject<number>;
}) => {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!mesh.current) return;
    const t = beat.current;
    // Wind up, snap, fade. A single-frame flash is unreadable.
    const strike = Math.max(0, 1 - Math.abs(t - 0.45) * 4);
    const material = mesh.current.material as THREE.MeshBasicMaterial;
    material.opacity = strike * (connected ? 0.95 : 0.4);
    mesh.current.visible = strike > 0.01;

    const a = new THREE.Vector3(from[0], from[1], from[2]);
    const b = new THREE.Vector3(to[0], to[1], to[2]);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mesh.current.position.copy(mid);
    mesh.current.scale.set(1, a.distanceTo(b), 1);
    mesh.current.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    );
  });

  return (
    <mesh ref={mesh}>
      <cylinderGeometry
        args={[connected ? 0.075 : 0.025, connected ? 0.075 : 0.025, 1, 8]}
      />
      <meshBasicMaterial
        color={colour}
        transparent
        opacity={0}
        toneMapped={false}
      />
    </mesh>
  );
};

export function Arena3D(props: Arena3DProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 17, 19], fov: 42 }}
      gl={{ antialias: true }}
      style={{ background: "transparent" }}
    >
      <fog attach="fog" args={["#05080c", 26, 62]} />
      <Scene {...props} />
    </Canvas>
  );
}
