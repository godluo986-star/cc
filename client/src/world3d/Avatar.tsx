/**
 * Dango avatar —《CLANNAD》"团子大家族"造型还原.
 * 设计规范 (用户验收基准):
 *  - 宽高比 ~1.42:1, 顶部大圆弧, 两侧外鼓, 底部近水平微软弧, 重心极低
 *  - 面部只有两条平行的黑色【竖】线眼 (长 ≈ 身高 12.5%, 间距 ≈ 身宽 16%,
 *    位于中心略偏上), 无嘴/眉/鼻/腮红/高光/眼白
 *  - 无手/脚/耳/尾/头发/衣服/帽子等一切附加部件
 *  - 哑光年糕质感: 2 阶 toon + 轻微纸纹颗粒, 无高光无反射
 *  - 描边: 深暖灰棕 (非纯黑) 反转外壳; 底部柔和接触阴影
 * 几何为参数化 lathe 轮廓 (非标准球体) + 微量非对称扰动去 CG 感.
 * AvatarConfig 兼容: 只消费 shirt (身体主色), 其余字段保留但不再渲染.
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

// ── 可调参数 (验收要求提供) ────────────────────────────────────────────────
export const DANGO_PARAMS = {
  bodyWidth: 0.88,     // 正面全宽
  bodyHeight: 0.62,    // 总高 → 宽高比 0.88/0.62 ≈ 1.42 : 1
  bodyDepth: 0.80,     // 前后厚度 (侧面饱满, 非纸片)
  bottomFlatten: 0.55, // 底部水平段占最大半径的比例 (0=尖底, 1=全平)
  eyeLength: 0.078,    // 竖线眼总长 ≈ 身高 12.6%
  eyeSpacing: 0.145,   // 两眼中心距 ≈ 身宽 16.5%
  eyeHeight: 0.355,    // 眼中心离地高度 ≈ 身高 57% (中心略偏上)
  squashAmount: 0.05,  // 移动挤压幅度上限
  bounceAmount: 0.045, // 移动浮沉幅度上限 (缓慢柔软, 非高频弹跳)
} as const;

const W2 = DANGO_PARAMS.bodyWidth / 2;              // 最大半径 0.44
const BODY_H = DANGO_PARAMS.bodyHeight;
const DEPTH_SCALE = DANGO_PARAMS.bodyDepth / DANGO_PARAMS.bodyWidth; // z 向压薄
/** Body center height when standing on the ground. */
export const DANGO_BODY_Y = BODY_H / 2; // 0.31
export const DANGO_EYE_HEIGHT = DANGO_PARAMS.eyeHeight;

// ── 轮廓: 平底软圆角 → 低位最大外鼓 → 一整段柔和大圆弧收顶 ────────────────
function buildProfile(): THREE.Vector2[] {
  const flat = W2 * DANGO_PARAMS.bottomFlatten;      // 底部水平段
  const pts: [number, number][] = [
    [0, 0], [flat * 0.55, 0], [flat, 0.004],          // 近水平的软底
    [W2 * 0.86, 0.022], [W2 * 0.975, 0.07],           // 圆角泛起
    [W2, 0.145],                                      // 最大外鼓 (低位, 重心低)
    [W2 * 0.985, 0.225], [W2 * 0.94, 0.31],           // 侧面圆润
    [W2 * 0.855, 0.395], [W2 * 0.73, 0.475],          // 大圆弧
    [W2 * 0.565, 0.543], [W2 * 0.375, 0.592],
    [W2 * 0.18, 0.617], [0, BODY_H],                  // 饱满顶
  ];
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

/** 微量非对称扰动 (种子固定): 去掉车削几何的机器完美感. */
function organicJitter(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  let seed = 20260726;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const phase1 = rnd() * Math.PI * 2;
  const phase2 = rnd() * Math.PI * 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const a = Math.atan2(z, x);
    // 低频周向起伏 ±0.5%, 底部不动 (保持贴地)
    const k = (Math.sin(a * 2 + phase1) * 0.0035 + Math.sin(a * 3 + phase2 + y * 2) * 0.0022)
      * Math.min(1, y / 0.1);
    pos.setX(i, x * (1 + k));
    pos.setZ(i, z * (1 + k));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** 共享 lathe 几何(身体 + 描边外壳复用同一份; z 向在 mesh 上压薄). */
const bodyGeometry = organicJitter(new THREE.LatheGeometry(buildProfile(), 64));

/** 2 阶灰度 toon gradientMap: 只保留一级暗部, 动画平涂感. */
let toonGrad: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (toonGrad) return toonGrad;
  const data = new Uint8Array([213, 255]); // 极淡的一级暗部, 接近平涂
  toonGrad = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  toonGrad.minFilter = THREE.NearestFilter;
  toonGrad.magFilter = THREE.NearestFilter;
  toonGrad.needsUpdate = true;
  return toonGrad;
}

/** 轻微纸张/手绘颗粒 (近白色乘算贴图, 4% 以内的明度扰动). */
let grainTex: THREE.CanvasTexture | null = null;
function grainTexture(): THREE.CanvasTexture {
  if (grainTex) return grainTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  let seed = 8873;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const img = ctx.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 246 + Math.floor(rnd() * 10); // 246..255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  // 几块极淡的水彩晕斑
  for (let i = 0; i < 5; i++) {
    const g = ctx.createRadialGradient(rnd() * 128, rnd() * 128, 4, rnd() * 128, rnd() * 128, 26 + rnd() * 22);
    g.addColorStop(0, 'rgba(235,230,225,0.10)');
    g.addColorStop(1, 'rgba(235,230,225,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  grainTex = new THREE.CanvasTexture(c);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  return grainTex;
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
    // 哑光年糕: 2 阶 toon + 纸纹, 零金属零高光
    body: new THREE.MeshToonMaterial({ color: bodyColor, gradientMap: toonGradient(), map: grainTexture() }),
    // 描边: 深暖灰棕的主体色深版 (非纯黑)
    outline: new THREE.MeshBasicMaterial({
      color: new THREE.Color(bodyColor).lerp(new THREE.Color('#4a4440'), 0.78).multiplyScalar(0.66),
      side: THREE.BackSide,
    }),
    eye: new THREE.MeshBasicMaterial({ color: '#262220' }),
  }), [bodyColor]);

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

  const eyeCyl = Math.max(0.01, DANGO_PARAMS.eyeLength - 0.026); // 胶囊圆柱段
  const eyeX = DANGO_PARAMS.eyeSpacing / 2;
  const eyeLocalY = DANGO_PARAMS.eyeHeight - DANGO_BODY_Y;

  return (
    <group ref={groupRef}>
      <group ref={J('root')}>
        {/* 契约空组: 无脚/无臂造型下保住 DangoRefs (不渲染任何几何) */}
        <group ref={J('footL')} position={[0.14, 0.02, 0.1]} />
        <group ref={J('footR')} position={[-0.14, 0.02, 0.1]} />

        {/* 压扁软团子身体 */}
        <group ref={J('body')} position={[0, DANGO_BODY_Y, 0]}>
          <mesh
            geometry={bodyGeometry} material={mats.body} castShadow={castShadow}
            position={[0, -DANGO_BODY_Y, 0]} scale={[1, 1, DEPTH_SCALE]}
          />
          {/* 反转外壳描边 (细而稳定) */}
          <mesh
            geometry={bodyGeometry} material={mats.outline}
            position={[0, -DANGO_BODY_Y - 0.006, 0]} scale={[1.035, 1.035, DEPTH_SCALE * 1.035]}
          />

          {/* 面部: 仅两条平行的竖线眼 (无嘴/无腮红/无任何其他五官) */}
          <group ref={J('face')} position={[0, eyeLocalY, 0]}>
            <group ref={J('eyes')}>
              <mesh material={mats.eye} position={[-eyeX, 0, 0.35]}>
                <capsuleGeometry args={[0.013, eyeCyl, 4, 8]} />
              </mesh>
              <mesh material={mats.eye} position={[eyeX, 0, 0.35]}>
                <capsuleGeometry args={[0.013, eyeCyl, 4, 8]} />
              </mesh>
            </group>
            {/* 契约空组: 默认无嘴 */}
            <group ref={(el) => { if (el) (joints.current as Record<string, THREE.Object3D>).mouth = el; }} />
          </group>

          {/* 契约空组 (无手臂造型); held 物品贴在身体右前下侧 */}
          <group ref={J('armL')} position={[0.4, -0.06, 0]} />
          <group ref={J('armR')} position={[-0.4, -0.06, 0]}>
            <group ref={heldRef} position={[-0.06, -0.1, 0.28]} visible={false}>
              <HeldCoffee />
              <HeldSoda />
              <HeldPizza />
              <HeldBook />
            </group>
          </group>
        </group>
      </group>

      {/* 柔和接触阴影: 被自重轻压在地面上的感觉 (羽化圆) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0.012]}>
        <circleGeometry args={[0.415, 24]} />
        <meshBasicMaterial map={contactShadowTexture()} transparent depthWrite={false} />
      </mesh>
      {/* nametag */}
      <sprite position={[0, 0.84, 0]} scale={[1.05, 0.26, 1]}>
        <spriteMaterial map={nameTex} transparent depthWrite={false} />
      </sprite>
      {/* speaking indicator */}
      <sprite ref={speakRef} position={[0, 1.04, 0]} scale={[0.15, 0.15, 1]} visible={false}>
        <spriteMaterial map={speakingTexture()} transparent depthWrite={false} />
      </sprite>
    </group>
  );
});

/** 羽化接触阴影贴图 (灰紫, 边缘柔和). */
let shadowTex: THREE.CanvasTexture | null = null;
function contactShadowTexture(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(58,52,64,0.38)');
  g.addColorStop(0.62, 'rgba(58,52,64,0.24)');
  g.addColorStop(1, 'rgba(58,52,64,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

// ── Held item meshes (道具是手持物, 非身体部件; 贴在身侧) ────────────────────
function HeldCoffee() {
  return (
    <group rotation={[0.3, 0, 0]} scale={0.9}>
      <mesh>
        <cylinderGeometry args={[0.04, 0.033, 0.1, 12]} />
        <meshStandardMaterial color="#f5f0e8" roughness={0.9} />
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
      <meshStandardMaterial color="#b0413e" roughness={0.8} />
    </mesh>
  );
}
function HeldPizza() {
  return (
    <group rotation={[1.1, 0, 0]} scale={0.9}>
      <mesh>
        <cylinderGeometry args={[0.09, 0.09, 0.015, 3]} />
        <meshStandardMaterial color="#e8b84a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.008, 3]} />
        <meshStandardMaterial color="#b0413e" roughness={0.9} />
      </mesh>
    </group>
  );
}
function HeldBook() {
  return (
    <mesh rotation={[0.5, 0.3, 0]} scale={0.9}>
      <boxGeometry args={[0.1, 0.14, 0.025]} />
      <meshStandardMaterial color="#7d3b5e" roughness={0.9} />
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
