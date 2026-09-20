/**
 * A little arena robot.
 *
 * The design brief is "readable first, charming second, and charming is how
 * you get readable". A viewer should know how a robot feels before they know
 * the rules, so the eyes do most of the work:
 *
 *   wide         idle, watching
 *   narrowed     attacking, focused
 *   squeezed     bracing behind a shield
 *   huge         dodging, alarmed
 *   spirals      knocked out
 *
 * On top of that: it hops rather than slides, squashes when it lands, leans
 * into what it is doing, and puffs up as it stores charge. Every one of those
 * is a state you would otherwise have to read off a HUD.
 */

import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type Mood = "idle" | "attack" | "defend" | "dodge" | "hurt" | "down";

export interface RobotProps {
  readonly colour: string;
  readonly label: string;
  /** Tile position, already interpolated by the caller. */
  readonly position: [number, number, number];
  /** Radians. The robot turns to face what it cares about. */
  readonly facing: number;
  readonly mood: Mood;
  /** 0..1, drives how puffed-up and bright it looks. */
  readonly charge: number;
  /** 0..1 */
  readonly hp: number;
  /** 0..1 progress through the current turn's animation. */
  readonly beat: number;
  readonly hopping: boolean;
}

/** How open the eyes are, vertically. */
const EYE_OPENNESS: Record<Mood, number> = {
  idle: 1,
  attack: 0.4,
  defend: 0.22,
  dodge: 1.45,
  hurt: 1.5,
  down: 0.12,
};

export function Robot({
  colour,
  label,
  position,
  facing,
  mood,
  charge,
  hp,
  beat,
  hopping,
}: RobotProps) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const leftEye = useRef<THREE.Mesh>(null);
  const rightEye = useRef<THREE.Mesh>(null);
  const aura = useRef<THREE.Mesh>(null);

  const accent = useMemo(() => new THREE.Color(colour), [colour]);
  const down = mood === "down";

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!group.current || !body.current) return;

    // --- hop -------------------------------------------------------------
    // An arc rather than a slide. Sliding reads as a cursor; hopping reads
    // as a creature that decided to go there.
    const hop = hopping ? Math.sin(Math.min(1, beat) * Math.PI) : 0;
    const bob = down ? 0 : Math.sin(t * 2.2 + position[0]) * 0.035;
    group.current.position.set(
      position[0],
      position[1] + hop * 0.42 + bob + (down ? -0.18 : 0),
      position[2],
    );

    // --- squash and stretch -----------------------------------------------
    // Stretch on the way up, squash on landing. Cheap, and it makes the
    // whole thing feel alive.
    const landing = hopping ? Math.max(0, 1 - Math.abs(beat - 1) * 6) : 0;
    const lunge =
      mood === "attack" ? Math.max(0, 1 - Math.abs(beat - 0.45) * 5) : 0;
    const puff = 1 + charge * 0.16;
    const squash = 1 - landing * 0.22 + hop * 0.1;

    body.current.scale.set(
      (puff / Math.max(0.6, squash)) * 0.98,
      squash * puff,
      (puff / Math.max(0.6, squash)) * 0.98,
    );

    // --- facing and lean ----------------------------------------------------
    const targetY = down ? facing : facing;
    group.current.rotation.y = THREE.MathUtils.lerp(
      group.current.rotation.y,
      targetY,
      0.2,
    );
    // Lean into an attack, rock back when hurt, tip over when down.
    const lean = (down ? 1.15 : 0) + lunge * 0.42 - (mood === "hurt" ? 0.3 : 0);
    body.current.rotation.x = THREE.MathUtils.lerp(
      body.current.rotation.x,
      lean,
      0.18,
    );
    body.current.rotation.z = down ? 0.35 : Math.sin(t * 1.6) * 0.03;

    // --- eyes ----------------------------------------------------------------
    // A blink every few seconds, because a thing that never blinks is
    // unsettling rather than cute.
    const blink =
      mood === "idle" && Math.sin(t * 0.8 + position[0]) > 0.985 ? 0.1 : 1;
    const openness = EYE_OPENNESS[mood] * blink;
    for (const eye of [leftEye.current, rightEye.current]) {
      if (!eye) continue;
      eye.scale.y = THREE.MathUtils.lerp(eye.scale.y, openness, 0.25);
      eye.scale.x = THREE.MathUtils.lerp(
        eye.scale.x,
        mood === "dodge" || mood === "hurt" ? 1.25 : 1,
        0.25,
      );
    }

    // --- charge aura ------------------------------------------------------------
    if (aura.current) {
      const pulse = 1 + Math.sin(t * 6) * 0.05 * charge;
      aura.current.scale.setScalar((0.62 + charge * 0.3) * pulse);
      const material = aura.current.material as THREE.MeshBasicMaterial;
      material.opacity = charge * 0.3;
    }
  });

  const eyeColour = down ? "#4b5a6b" : mood === "hurt" ? "#ffd2d2" : "#ffffff";
  const eyeGeometry: [number, number, number] = [0.075, 0.1, 0.05];

  return (
    <group ref={group}>
      {/* charge aura */}
      <mesh ref={aura}>
        <sphereGeometry args={[1, 20, 20]} />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>

      <group ref={body}>
        {/* chassis */}
        <RoundedBox args={[0.58, 0.54, 0.5]} radius={0.16} smoothness={4}>
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={down ? 0.05 : 0.35 + charge * 0.7}
            roughness={0.35}
            metalness={0.25}
          />
        </RoundedBox>

        {/* visor: a dark inset so the eyes read against the body colour */}
        <RoundedBox
          args={[0.42, 0.24, 0.06]}
          radius={0.05}
          smoothness={3}
          position={[0, 0.04, 0.25]}
        >
          <meshStandardMaterial color="#0a0f16" roughness={0.25} />
        </RoundedBox>

        <mesh ref={leftEye} position={[-0.1, 0.04, 0.29]}>
          <capsuleGeometry args={[eyeGeometry[0], eyeGeometry[1], 4, 12]} />
          <meshStandardMaterial
            color={eyeColour}
            emissive={eyeColour}
            emissiveIntensity={down ? 0.1 : 1.6}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={rightEye} position={[0.1, 0.04, 0.29]}>
          <capsuleGeometry args={[eyeGeometry[0], eyeGeometry[1], 4, 12]} />
          <meshStandardMaterial
            color={eyeColour}
            emissive={eyeColour}
            emissiveIntensity={down ? 0.1 : 1.6}
            toneMapped={false}
          />
        </mesh>

        {/* antenna, with a bobble that lights up as charge builds */}
        <mesh position={[0, 0.36, -0.04]}>
          <cylinderGeometry args={[0.014, 0.014, 0.2, 6]} />
          <meshStandardMaterial
            color="#8fa6bd"
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
        <mesh position={[0, 0.48, -0.04]}>
          <sphereGeometry args={[0.055, 14, 14]} />
          <meshStandardMaterial
            color={charge > 0.99 ? "#fff1a8" : accent}
            emissive={charge > 0.99 ? "#ffd166" : accent}
            emissiveIntensity={0.6 + charge * 2.4}
            toneMapped={false}
          />
        </mesh>

        {/* little side fins, so the silhouette is not a plain cube */}
        {[-1, 1].map((side) => (
          <RoundedBox
            key={side}
            args={[0.08, 0.2, 0.26]}
            radius={0.03}
            smoothness={3}
            position={[side * 0.33, -0.02, -0.02]}
          >
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={0.2}
              roughness={0.4}
              metalness={0.3}
            />
          </RoundedBox>
        ))}
      </group>

      {/* hover glow on the floor, doubling as the shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]}>
        <circleGeometry args={[0.32, 24]} />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={down ? 0.06 : 0.28}
          depthWrite={false}
        />
      </mesh>

      {/* shield bubble */}
      {mood === "defend" && (
        <mesh>
          <sphereGeometry args={[0.52, 24, 24]} />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={0.22}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* charge pips, so stored power is countable and not just a vibe */}
      {charge > 0 && (
        <group position={[0, 0.66, 0]}>
          {[0, 1, 2].map((pip) => (
            <mesh key={pip} position={[(pip - 1) * 0.11, 0, 0]}>
              <sphereGeometry args={[0.035, 10, 10]} />
              <meshStandardMaterial
                color={charge * 3 > pip ? "#ffd166" : "#2a3644"}
                emissive={charge * 3 > pip ? "#ffd166" : "#000000"}
                emissiveIntensity={charge * 3 > pip ? 2 : 0}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* health bar, always facing the camera is overkill; a flat bar reads
          fine from the fixed-ish arena angle */}
      <group position={[0, 0.86, 0]} rotation={[-0.5, 0, 0]}>
        <mesh>
          <planeGeometry args={[0.52, 0.07]} />
          <meshBasicMaterial color="#121a24" transparent opacity={0.85} />
        </mesh>
        <mesh position={[-(0.52 * (1 - hp)) / 2, 0, 0.001]}>
          <planeGeometry args={[Math.max(0.001, 0.52 * hp), 0.05]} />
          <meshBasicMaterial
            color={hp > 0.3 ? colour : "#ff6b6b"}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* identity letter under the feet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.315, 0.42]}>
        <planeGeometry args={[0.3, 0.3]} />
        <meshBasicMaterial color={accent} transparent opacity={0.0} />
      </mesh>
      <LetterBadge label={label} colour={colour} />
    </group>
  );
}

/** A small floating plate with the agent's letter, drawn as geometry. */
function LetterBadge({ label, colour }: { label: string; colour: string }) {
  return (
    <group position={[0, -0.28, 0.46]} rotation={[-Math.PI / 2.2, 0, 0]}>
      <mesh>
        <circleGeometry args={[0.12, 18]} />
        <meshBasicMaterial color="#060a0f" transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <ringGeometry args={[0.1, 0.12, 18]} />
        <meshBasicMaterial color={colour} toneMapped={false} />
      </mesh>
      {/* The letter itself is drawn by the HUD, not in 3D: text geometry
          would pull in a font loader for two characters. */}
      <mesh position={[0, 0, 0.003]} visible={label.length === 0}>
        <circleGeometry args={[0.02, 8]} />
        <meshBasicMaterial color={colour} />
      </mesh>
    </group>
  );
}
