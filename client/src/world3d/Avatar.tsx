/**
 * Dango avatar: a squishy round dumpling character (inspired by classic
 * anime dango mascots, original geometry). Real modeled parts: body sphere,
 * dot eyes, mouth, blush, stubby arms/feet, sprout, hats, scarf, glasses.
 *
 * AvatarConfig field mapping for dango:
 *   shirt → body color        pants → scarf color      shoes → feet color
 *   hair  → sprout color      hairStyle → 0 curl, 1 leaf, 2 none
 *   skin  → cheek/blush tint  hat/hatColor/glasses → as named
 */
import { useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import type { AvatarConfig } from '@nexuspark/shared';
import { Anim } from '@nexuspark/shared';
import { applyPose, createAnimatorState, type DangoRefs } from './animator';
import { nameTexture } from './nameSprite';

export interface AvatarHandle {
  group: THREE.Group | null;
  setPose: (anim: Anim, speed: number, dt: number, t: number) => void;
  setHeld: (held: number) => void;
  setSpeaking: (speaking: boolean) => void;
}

interface Props {
  config: AvatarConfig;
  name: string;
  isNpc?: boolean;
  castShadow?: boolean;
}

/** Body center height when standing on the ground. */
export const DANGO_BODY_Y = 0.46;
export const DANGO_EYE_HEIGHT = 0.62;

export const Avatar = forwardRef<AvatarHandle, Props>(function Avatar(
  { config, name, isNpc = false, castShadow = true },
  ref
) {
  const groupRef = useRef<THREE.Group>(null);
  const joints = useRef<Partial<DangoRefs>>({});
  const animState = useRef(createAnimatorState());
  const heldRef = useRef<THREE.Group>(null);
  const speakRef = useRef<THREE.Sprite>(null);

  const bodyColor = config.shirt;
  const mats = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.62 }),
    bodyDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor).multiplyScalar(0.82), roughness: 0.62 }),
    feet: new THREE.MeshStandardMaterial({ color: config.shoes, roughness: 0.7 }),
    scarf: new THREE.MeshStandardMaterial({ color: config.pants, roughness: 0.85 }),
    sprout: new THREE.MeshStandardMaterial({ color: config.hair, roughness: 0.75 }),
    hat: new THREE.MeshStandardMaterial({ color: config.hatColor, roughness: 0.7 }),
    eye: new THREE.MeshBasicMaterial({ color: '#23252b' }),
    mouth: new THREE.MeshBasicMaterial({ color: '#3a2530' }),
    blush: new THREE.MeshBasicMaterial({ color: config.skin, transparent: true, opacity: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: '#2b2f38', roughness: 0.25, metalness: 0.6 }),
  }), [bodyColor, config.shoes, config.pants, config.hair, config.hatColor, config.skin]);

  const nameTex = useMemo(() => nameTexture(name, isNpc), [name, isNpc]);

  useImperativeHandle(ref, () => ({
    group: groupRef.current,
    setPose: (anim, speed, dt, t) => {
      const j = joints.current;
      if (j.root && j.body && j.face && j.armL && j.armR && j.footL && j.footR && j.eyes && j.mouth) {
        applyPose(j as DangoRefs, animState.current, anim, speed, dt, t);
      }
    },
    setHeld: (held) => {
      if (heldRef.current) {
        heldRef.current.children.forEach((c, i) => { c.visible = i === held - 1; });
        heldRef.current.visible = held > 0;
      }
    },
    setSpeaking: (speaking) => {
      if (speakRef.current) speakRef.current.visible = speaking;
    },
  }), []);

  const J = (key: keyof DangoRefs) => (el: THREE.Group | null) => {
    if (el) (joints.current as Record<string, THREE.Object3D>)[key] = el;
  };

  const R = 0.42; // body radius

  return (
    <group ref={groupRef}>
      <group ref={J('root')}>
        {/* feet (outside the squash group so they stay planted) */}
        <group ref={J('footL')} position={[0.16, 0.05, 0.12]}>
          <mesh material={mats.feet} castShadow={castShadow}>
            <sphereGeometry args={[0.12, 12, 9]} />
          </mesh>
        </group>
        <group ref={J('footR')} position={[-0.16, 0.05, 0.12]}>
          <mesh material={mats.feet} castShadow={castShadow}>
            <sphereGeometry args={[0.12, 12, 9]} />
          </mesh>
        </group>

        {/* squishy body */}
        <group ref={J('body')} position={[0, DANGO_BODY_Y, 0]}>
          <mesh material={mats.body} castShadow={castShadow} scale={[1, 0.94, 1]}>
            <sphereGeometry args={[R, 26, 20]} />
          </mesh>

          {/* scarf */}
          <mesh material={mats.scarf} position={[0, -0.19, 0]} rotation={[0.12, 0, 0]} castShadow={castShadow}>
            <torusGeometry args={[R * 0.82, 0.055, 10, 22]} />
          </mesh>
          <mesh material={mats.scarf} position={[0.1, -0.26, R * 0.72]} rotation={[0.3, 0, 0.2]}>
            <boxGeometry args={[0.09, 0.16, 0.03]} />
          </mesh>

          {/* face */}
          <group ref={J('face')} position={[0, 0.1, 0]}>
            <group ref={J('eyes')}>
              <mesh material={mats.eye} position={[-0.13, 0.05, R * 0.88]}>
                <sphereGeometry args={[0.038, 10, 8]} />
              </mesh>
              <mesh material={mats.eye} position={[0.13, 0.05, R * 0.88]}>
                <sphereGeometry args={[0.038, 10, 8]} />
              </mesh>
            </group>
            {/* mouth: small open arc */}
            <mesh ref={(el) => { if (el) (joints.current as Record<string, THREE.Object3D>).mouth = el; }}
              material={mats.mouth} position={[0, -0.07, R * 0.9]} rotation={[0.1, 0, 0]}>
              <circleGeometry args={[0.045, 12]} />
            </mesh>
            {/* blush */}
            <mesh material={mats.blush} position={[-0.24, -0.03, R * 0.8]} rotation={[0, -0.5, 0]}>
              <circleGeometry args={[0.055, 10]} />
            </mesh>
            <mesh material={mats.blush} position={[0.24, -0.03, R * 0.8]} rotation={[0, 0.5, 0]}>
              <circleGeometry args={[0.055, 10]} />
            </mesh>
          </group>

          {/* arms: stubby nubs */}
          <group ref={J('armL')} position={[R * 0.86, -0.02, 0]}>
            <mesh material={mats.bodyDark} castShadow={castShadow} position={[0.06, 0, 0]}>
              <capsuleGeometry args={[0.075, 0.1, 4, 10]} />
            </mesh>
          </group>
          <group ref={J('armR')} position={[-R * 0.86, -0.02, 0]}>
            <mesh material={mats.bodyDark} castShadow={castShadow} position={[-0.06, 0, 0]}>
              <capsuleGeometry args={[0.075, 0.1, 4, 10]} />
            </mesh>
            <group ref={heldRef} position={[-0.1, -0.1, 0.1]} visible={false}>
              <HeldCoffee />
              <HeldSoda />
              <HeldPizza />
              <HeldBook />
            </group>
          </group>

          {/* sprout / leaf */}
          {config.hairStyle !== 2 && config.hat === 0 && (
            <group ref={J('sprout')} position={[0, R * 0.94, 0]}>
              {config.hairStyle === 0 ? (
                <>
                  <mesh material={mats.sprout}>
                    <cylinderGeometry args={[0.02, 0.028, 0.16, 8]} />
                  </mesh>
                  <mesh material={mats.sprout} position={[0.05, 0.1, 0]} rotation={[0, 0, -1.2]}>
                    <torusGeometry args={[0.06, 0.02, 8, 14, Math.PI * 1.4]} />
                  </mesh>
                </>
              ) : (
                <>
                  <mesh material={mats.sprout} position={[0, 0.04, 0]}>
                    <cylinderGeometry args={[0.018, 0.024, 0.1, 8]} />
                  </mesh>
                  <mesh material={mats.sprout} position={[0.07, 0.11, 0]} rotation={[0, 0, -0.7]} scale={[1, 0.4, 0.6]}>
                    <sphereGeometry args={[0.09, 10, 8]} />
                  </mesh>
                  <mesh material={mats.sprout} position={[-0.07, 0.11, 0]} rotation={[0, 0, 0.7]} scale={[1, 0.4, 0.6]}>
                    <sphereGeometry args={[0.09, 10, 8]} />
                  </mesh>
                </>
              )}
            </group>
          )}

          {/* hats */}
          {config.hat === 1 && (
            <group position={[0, R * 0.72, 0]} rotation={[0.08, 0, 0]}>
              <mesh material={mats.hat} castShadow={castShadow}>
                <sphereGeometry args={[R * 0.72, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.42]} />
              </mesh>
              <mesh material={mats.hat} position={[0, 0.02, R * 0.62]} rotation={[-0.15, 0, 0]}>
                <cylinderGeometry args={[0.22, 0.24, 0.03, 14]} />
              </mesh>
            </group>
          )}
          {config.hat === 2 && (
            <mesh material={mats.hat} position={[0, R * 0.66, 0]} castShadow={castShadow}>
              <sphereGeometry args={[R * 0.78, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            </mesh>
          )}
          {config.hat === 3 && (
            <group position={[0, R * 0.92, 0]} rotation={[0, 0, 0.06]}>
              <mesh material={mats.hat} castShadow={castShadow}>
                <cylinderGeometry args={[0.19, 0.2, 0.3, 16]} />
              </mesh>
              <mesh material={mats.hat} position={[0, -0.13, 0]}>
                <cylinderGeometry args={[0.33, 0.33, 0.03, 18]} />
              </mesh>
            </group>
          )}

          {/* glasses */}
          {config.glasses && (
            <group position={[0, 0.15, R * 0.92]}>
              <mesh material={mats.glass} position={[-0.13, 0, 0]}>
                <torusGeometry args={[0.07, 0.012, 6, 16]} />
              </mesh>
              <mesh material={mats.glass} position={[0.13, 0, 0]}>
                <torusGeometry args={[0.07, 0.012, 6, 16]} />
              </mesh>
              <mesh material={mats.glass}>
                <boxGeometry args={[0.12, 0.014, 0.014]} />
              </mesh>
            </group>
          )}
        </group>
      </group>

      {/* soft contact shadow (works even with shadow maps off) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <circleGeometry args={[0.34, 18]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      {/* nametag */}
      <sprite position={[0, 1.42, 0]} scale={[1.28, 0.32, 1]}>
        <spriteMaterial map={nameTex} transparent depthWrite={false} />
      </sprite>
      {/* speaking indicator */}
      <sprite ref={speakRef} position={[0, 1.66, 0]} scale={[0.15, 0.15, 1]} visible={false}>
        <spriteMaterial map={speakingTexture()} transparent depthWrite={false} />
      </sprite>
    </group>
  );
});

// ── Held item meshes (scaled for stubby dango arms) ─────────────────────────
function HeldCoffee() {
  return (
    <group rotation={[0.3, 0, 0]} scale={0.9}>
      <mesh>
        <cylinderGeometry args={[0.04, 0.033, 0.1, 12]} />
        <meshStandardMaterial color="#f5f0e8" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.052, 0]}>
        <cylinderGeometry args={[0.041, 0.041, 0.012, 12]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
      </mesh>
    </group>
  );
}
function HeldSoda() {
  return (
    <mesh rotation={[0.3, 0, 0]} scale={0.9}>
      <cylinderGeometry args={[0.032, 0.032, 0.12, 12]} />
      <meshStandardMaterial color="#c0392b" roughness={0.3} metalness={0.7} />
    </mesh>
  );
}
function HeldPizza() {
  return (
    <group rotation={[1.1, 0, 0]} scale={0.9}>
      <mesh>
        <cylinderGeometry args={[0.09, 0.09, 0.015, 3]} />
        <meshStandardMaterial color="#e8b84a" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.008, 3]} />
        <meshStandardMaterial color="#c0392b" roughness={0.85} />
      </mesh>
    </group>
  );
}
function HeldBook() {
  return (
    <mesh rotation={[0.5, 0.3, 0]} scale={0.9}>
      <boxGeometry args={[0.1, 0.14, 0.025]} />
      <meshStandardMaterial color="#7d3b5e" roughness={0.7} />
    </mesh>
  );
}

let speakTex: THREE.Texture | null = null;
function speakingTexture(): THREE.Texture {
  if (speakTex) return speakTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#38d9c3';
  ctx.beginPath();
  ctx.arc(32, 32, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 217, 195, 0.5)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.stroke();
  speakTex = new THREE.CanvasTexture(c);
  return speakTex;
}
