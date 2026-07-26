/**
 * Dango avatar: a squishy steamed-bun / mochi character (Clannad「团子大家族」
 * 风格,程序化几何,无外部资产). 扁扁的馒头形身体 (LatheGeometry)、
 * 眯眯眼线条脸、蜡笔感 toon 渲染 + 反转外壳描边、头顶双叶小芽。
 *
 * AvatarConfig field mapping for dango:
 *   shirt → body color        pants → scarf color      shoes → (feet, hidden)
 *   hair  → sprout color      hairStyle → 0 curl, 1 twin-leaf, 2 none
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

/** 馒头身体总高 / 最大半径 (宽高比 ≈ 0.93 : 0.60 ≈ 1.55 : 1). */
const BODY_H = 0.6;
/** Body center height when standing on the ground. */
export const DANGO_BODY_Y = BODY_H / 2; // 0.30
export const DANGO_EYE_HEIGHT = 0.37;   // 眼睛世界高度 ≈ 身体高度 62%

// ── 馒头轮廓 (lathe profile, 自底向上): 底部微微外扩 → 收圆 → 顶部圆润略平 ──
const BODY_PROFILE: THREE.Vector2[] = [
  [0.0, 0.0], [0.16, 0.002], [0.3, 0.008], [0.4, 0.02], [0.45, 0.045],
  [0.465, 0.08], [0.46, 0.13], [0.445, 0.19], [0.42, 0.26], [0.385, 0.33],
  [0.34, 0.4], [0.28, 0.47], [0.21, 0.53], [0.13, 0.575], [0.055, 0.595],
  [0.0, BODY_H],
].map(([x, y]) => new THREE.Vector2(x, y));

/** 共享 lathe 几何(身体 + 描边外壳复用同一份). */
const bodyGeometry = new THREE.LatheGeometry(BODY_PROFILE, 64);

/** 3 阶灰度 toon gradientMap(NearestFilter → 硬色阶,蜡笔/水彩感). */
let toonGrad: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (toonGrad) return toonGrad;
  const data = new Uint8Array([150, 200, 235, 255]);
  toonGrad = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  toonGrad.minFilter = THREE.NearestFilter;
  toonGrad.magFilter = THREE.NearestFilter;
  toonGrad.needsUpdate = true;
  return toonGrad;
}

/** 哑光 toon 材质工厂(所有主要部件统一画风). */
function toonMat(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
}

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
    body: toonMat(bodyColor),
    bodyDark: toonMat(new THREE.Color(bodyColor).multiplyScalar(0.88)),
    // 描边: 身体色调深并偏暖棕,柔和蜡笔轮廓
    outline: new THREE.MeshBasicMaterial({
      color: new THREE.Color(bodyColor).lerp(new THREE.Color('#6b5b4f'), 0.55).multiplyScalar(0.72),
      side: THREE.BackSide,
    }),
    scarf: toonMat(config.pants),
    sprout: toonMat(config.hair),
    hat: toonMat(config.hatColor),
    eye: new THREE.MeshBasicMaterial({ color: '#3a3230' }),
    mouth: new THREE.MeshBasicMaterial({ color: '#4a403c' }),
    blush: new THREE.MeshBasicMaterial({ color: config.skin, transparent: true, opacity: 0.3, depthWrite: false }),
    glass: toonMat('#3a3230'),
  }), [bodyColor, config.pants, config.hair, config.hatColor, config.skin]);

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

  return (
    <group ref={groupRef}>
      <group ref={J('root')}>
        {/* feet: 参考图团子没有明显手脚 — 空 group 保住 ref 契约, 不渲染 */}
        <group ref={J('footL')} position={[0.14, 0.02, 0.1]} />
        <group ref={J('footR')} position={[-0.14, 0.02, 0.1]} />

        {/* squishy steamed-bun body */}
        <group ref={J('body')} position={[0, DANGO_BODY_Y, 0]}>
          <mesh geometry={bodyGeometry} material={mats.body} castShadow={castShadow} position={[0, -DANGO_BODY_Y, 0]} />
          {/* 反转外壳描边 (inverted-hull outline) */}
          <mesh geometry={bodyGeometry} material={mats.outline} position={[0, -DANGO_BODY_Y - 0.008, 0]} scale={1.04} />

          {/* scarf: 很细的一圈, 贴在底部, 不抢造型 */}
          <mesh material={mats.scarf} position={[0, -0.245, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.445, 0.03, 8, 40]} />
          </mesh>

          {/* face */}
          <group ref={J('face')} position={[0, 0.07, 0]}>
            {/* 眼睛: 两条细细的水平短线 (横放圆头胶囊), 眯眯眼满足表情 */}
            <group ref={J('eyes')}>
              <mesh material={mats.eye} position={[-0.13, 0, 0.34]} rotation={[0, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.012, 0.1, 4, 8]} />
              </mesh>
              <mesh material={mats.eye} position={[0.13, 0, 0.34]} rotation={[0, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.012, 0.1, 4, 8]} />
              </mesh>
            </group>
            {/* 嘴: 极小的一条短线, 若有若无; animator scale.y 张嘴时变成小圆 */}
            <mesh ref={(el) => { if (el) (joints.current as Record<string, THREE.Object3D>).mouth = el; }}
              material={mats.mouth} position={[0, -0.09, 0.41]} rotation={[0, 0, Math.PI / 2]}>
              <capsuleGeometry args={[0.008, 0.018, 4, 8]} />
            </mesh>
            {/* 腮红: 很淡的椭圆, 贴面 */}
            <mesh material={mats.blush} position={[-0.245, -0.045, 0.31]} rotation={[0, -0.6, 0]} scale={[1, 0.72, 1]}>
              <circleGeometry args={[0.06, 12]} />
            </mesh>
            <mesh material={mats.blush} position={[0.245, -0.045, 0.31]} rotation={[0, 0.6, 0]} scale={[1, 0.72, 1]}>
              <circleGeometry args={[0.06, 12]} />
            </mesh>
          </group>

          {/* arms: 极小的圆凸起, 平时几乎藏进身体, 挥手/鼓掌时由 armL/armR 旋转伸出 */}
          <group ref={J('armL')} position={[0.43, -0.06, 0]}>
            <mesh material={mats.bodyDark} castShadow={castShadow} position={[0.02, 0, 0]}>
              <sphereGeometry args={[0.055, 10, 8]} />
            </mesh>
          </group>
          <group ref={J('armR')} position={[-0.43, -0.06, 0]}>
            <mesh material={mats.bodyDark} castShadow={castShadow} position={[-0.02, 0, 0]}>
              <sphereGeometry args={[0.055, 10, 8]} />
            </mesh>
            {/* held 物品锚点: 贴右侧凸起 */}
            <group ref={heldRef} position={[-0.07, -0.08, 0.06]} visible={false}>
              <HeldCoffee />
              <HeldSoda />
              <HeldPizza />
              <HeldBook />
            </group>
          </group>

          {/* sprout: 0 = 卷卷芽, 1 = 参考图双叶小芽 (细茎 + 两片圆叶) */}
          {config.hairStyle !== 2 && config.hat === 0 && (
            <group ref={J('sprout')} position={[0, 0.295, 0]}>
              {config.hairStyle === 0 ? (
                <>
                  <mesh material={mats.sprout}>
                    <cylinderGeometry args={[0.016, 0.022, 0.13, 8]} />
                  </mesh>
                  <mesh material={mats.sprout} position={[0.045, 0.09, 0]} rotation={[0, 0, -1.2]}>
                    <torusGeometry args={[0.05, 0.016, 8, 14, Math.PI * 1.4]} />
                  </mesh>
                </>
              ) : (
                <>
                  {/* 细茎 */}
                  <mesh material={mats.sprout} position={[0, 0.06, 0]}>
                    <cylinderGeometry args={[0.008, 0.011, 0.13, 8]} />
                  </mesh>
                  {/* 两片圆润小叶: 压扁的 sphere */}
                  <mesh material={mats.sprout} position={[0.065, 0.13, 0]} rotation={[0, 0, -0.55]} scale={[1, 0.42, 0.55]}>
                    <sphereGeometry args={[0.075, 12, 10]} />
                  </mesh>
                  <mesh material={mats.sprout} position={[-0.065, 0.13, 0]} rotation={[0, 0, 0.55]} scale={[1, 0.42, 0.55]}>
                    <sphereGeometry args={[0.075, 12, 10]} />
                  </mesh>
                </>
              )}
            </group>
          )}

          {/* hats: 贴合矮宽头顶 */}
          {config.hat === 1 && (
            <group position={[0, 0.1, 0]} rotation={[0.08, 0, 0]}>
              <mesh material={mats.hat} castShadow={castShadow} scale={[1, 0.62, 1]}>
                <sphereGeometry args={[0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.46]} />
              </mesh>
              <mesh material={mats.hat} position={[0, 0.05, 0.38]} rotation={[-0.18, 0, 0]}>
                <cylinderGeometry args={[0.2, 0.22, 0.025, 14]} />
              </mesh>
            </group>
          )}
          {config.hat === 2 && (
            <mesh material={mats.hat} position={[0, 0.06, 0]} scale={[1, 0.56, 1]} castShadow={castShadow}>
              <sphereGeometry args={[0.46, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            </mesh>
          )}
          {config.hat === 3 && (
            <group position={[0, 0.28, 0]} rotation={[0, 0, 0.06]}>
              <mesh material={mats.hat} castShadow={castShadow}>
                <cylinderGeometry args={[0.16, 0.17, 0.24, 16]} />
              </mesh>
              <mesh material={mats.hat} position={[0, -0.1, 0]}>
                <cylinderGeometry args={[0.29, 0.29, 0.025, 18]} />
              </mesh>
            </group>
          )}

          {/* glasses: 围绕线眼的两个细圆环 */}
          {config.glasses && (
            <group position={[0, 0.07, 0.35]}>
              <mesh material={mats.glass} position={[-0.13, 0, 0]}>
                <torusGeometry args={[0.055, 0.008, 6, 18]} />
              </mesh>
              <mesh material={mats.glass} position={[0.13, 0, 0]}>
                <torusGeometry args={[0.055, 0.008, 6, 18]} />
              </mesh>
              <mesh material={mats.glass}>
                <boxGeometry args={[0.1, 0.01, 0.01]} />
              </mesh>
            </group>
          )}
        </group>
      </group>

      {/* soft contact shadow (works even with shadow maps off) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <circleGeometry args={[0.42, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      {/* nametag */}
      <sprite position={[0, 0.88, 0]} scale={[1.05, 0.26, 1]}>
        <spriteMaterial map={nameTex} transparent depthWrite={false} />
      </sprite>
      {/* speaking indicator */}
      <sprite ref={speakRef} position={[0, 1.08, 0]} scale={[0.15, 0.15, 1]} visible={false}>
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
