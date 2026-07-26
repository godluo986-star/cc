/**
 * Outdoor & public-space props — 赛璐璐日漫画风 (cel-shaded anime look).
 * Everything is real modeled geometry composed from primitives — no image
 * textures standing in for shape. 造型走吉卜力/京阿尼式的柔软圆润:
 * 棉花糖树冠 + 反转外壳描边、粉彩小花 (InstancedMesh)、卡通喷泉波纹。
 * 随机全部用固定种子 LCG(与 textures.ts 同一惯例),零外部资源。
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useWorld, useSettings } from '../../state/stores';
import { currentTod, sampleEnv } from '../env/daynight';
import { MeshReflectorMaterial } from '@react-three/drei';
import { hot } from '../../state/hot';

/* ─── Pastel palette(键名保持不变,值统一压到低饱和粉彩) ────────────── */
export const M = {
  wood: '#a3805f', woodDark: '#7b5f45', metal: '#8d97a6', metalDark: '#5a6472',
  stone: '#c6c0b6', stoneDark: '#a09a90', leaf: '#7fb35f', leafDark: '#5c8f4d',
  trunk: '#8a6749',
};

/* ─── 共享 toon 基建(与 Avatar.tsx 的团子角色同一手法) ─────────────── */

/** 固定种子 LCG — 与 textures.ts 相同的确定性伪随机惯例. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 4 阶灰度 toon gradientMap(NearestFilter → 硬色阶,赛璐璐色块感). */
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

/** 哑光 toon 材质工厂. */
function toonMat(color: THREE.ColorRepresentation, opts: Partial<THREE.MeshToonMaterialParameters> = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

/** 平移/缩放/绕 Z 微转的组合矩阵(树干弯曲、树冠椭球用). */
function mat4(x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** 把若干带矩阵/颜色的几何体合并为一份(顶点色烘进 color attribute)。
 *  合并后整棵树冠/树干各只占 1 个 draw call;传入的几何体会被消费并 dispose. */
function mergeParts(parts: { geo: THREE.BufferGeometry; m?: THREE.Matrix4; color?: string }[]): THREE.BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const hasColor = parts.some((p) => p.color !== undefined);
  const c = new THREE.Color();
  for (const part of parts) {
    const g = part.geo;
    if (part.m) g.applyMatrix4(part.m); // applyMatrix4 会用 normalMatrix 修正法线
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const base = position.length / 3;
    if (hasColor) c.set(part.color ?? '#ffffff');
    for (let i = 0; i < pos.count; i++) {
      position.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normal.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (hasColor) color.push(c.r, c.g, c.b);
    }
    const idx = g.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) index.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) index.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  if (hasColor) out.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  out.setIndex(index);
  return out;
}

/* 共享材质(模块级创建一次,所有实例复用 → 不随组件卸载 dispose) */
const VERT_TOON = new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true, gradientMap: toonGradient() });
const WOOD_TOON = toonMat(M.wood);
const IRON_TOON = toonMat('#5a626e');
const STONE_TOON = toonMat('#cfc8bc');

/* ─── Street lamp (auto-on at night) ─────────────────────────────────────── */
const LAMP_POLE = toonMat('#5f6b78');
const LAMP_BASE = toonMat('#4b5563');

export function StreetLamp({ position }: { position: [number, number, number] }) {
  const bulbRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const env = useWorld((s) => s.env);
  useFrame(() => {
    const s = sampleEnv(currentTod(env), env.weather);
    if (bulbRef.current) bulbRef.current.emissiveIntensity = s.lampsOn ? 2.4 : 0.0;
    if (lightRef.current) lightRef.current.intensity = s.lampsOn ? 14 : 0;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]} castShadow material={LAMP_BASE}>
        <cylinderGeometry args={[0.18, 0.24, 0.16, 10]} />
      </mesh>
      <mesh position={[0, 1.9, 0]} castShadow material={LAMP_POLE}>
        <cylinderGeometry args={[0.045, 0.06, 3.7, 8]} />
      </mesh>
      <mesh position={[0, 3.8, 0]} material={LAMP_POLE}>
        <cylinderGeometry args={[0.16, 0.05, 0.24, 8]} />
      </mesh>
      <mesh position={[0, 3.68, 0]}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial ref={bulbRef} color="#fff2cc" emissive="#ffd98a" emissiveIntensity={0} roughness={0.3} />
      </mesh>
      <pointLight ref={lightRef} position={[0, 3.55, 0]} distance={13} decay={1.8} color="#ffd9a0" intensity={0} />
    </group>
  );
}

/* ─── Park bench(结构不变,配色转粉彩 toon) ──────────────────────────── */
export function Bench({ position, rotation }: { position: [number, number, number]; rotation: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-0.15, 0, 0.15].map((z, i) => (
        <mesh key={i} position={[0, 0.44, z * -1 + 0.05]} castShadow material={WOOD_TOON}>
          <boxGeometry args={[1.8, 0.045, 0.13]} />
        </mesh>
      ))}
      {[0.28, 0.45].map((y, i) => (
        <mesh key={i} position={[0, y + 0.28, -0.26]} rotation={[-0.22, 0, 0]} castShadow material={WOOD_TOON}>
          <boxGeometry args={[1.8, 0.05, 0.12]} />
        </mesh>
      ))}
      {[-0.78, 0.78].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0.22, 0.12]} material={IRON_TOON} castShadow>
            <boxGeometry args={[0.06, 0.44, 0.08]} />
          </mesh>
          <mesh position={[0, 0.5, -0.2]} rotation={[-0.24, 0, 0]} material={IRON_TOON} castShadow>
            <boxGeometry args={[0.06, 0.62, 0.08]} />
          </mesh>
          <mesh position={[0, 0.44, -0.03]} material={IRON_TOON}>
            <boxGeometry args={[0.06, 0.05, 0.42]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ─── Trees:棉花糖树冠 + 反转外壳描边 ────────────────────────────────── */
// 树冠 = 2-4 个重叠椭球合并成 1 份几何,黄绿→深绿双层顶点色;
// 描边 = 同一份几何 BackSide 放大 ~1.04(与团子角色一致的 inverted hull)。
const LEAF_LIGHT = '#a9cb76';
const LEAF_MID = '#7fb35f';
const LEAF_DARK = '#5c8f4d';

function canopyGeo(puffs: { p: [number, number, number]; s: [number, number, number]; c: string }[]): THREE.BufferGeometry {
  return mergeParts(puffs.map(({ p, s, c }) => ({
    geo: new THREE.SphereGeometry(1, 16, 12),
    m: mat4(p[0], p[1], p[2], s[0], s[1], s[2]),
    color: c,
  })));
}

const CANOPIES: { geo: THREE.BufferGeometry; y: number }[] = [
  { // variant 0: 圆蓬蓬棉花糖
    y: 2.7,
    geo: canopyGeo([
      { p: [0, 0, 0], s: [1.25, 1.02, 1.25], c: LEAF_MID },
      { p: [-0.88, -0.32, 0.12], s: [0.82, 0.68, 0.82], c: LEAF_DARK },
      { p: [0.84, -0.28, -0.18], s: [0.78, 0.64, 0.78], c: LEAF_DARK },
      { p: [0.04, 0.72, -0.05], s: [0.72, 0.6, 0.72], c: LEAF_LIGHT },
    ]),
  },
  { // variant 1: 高塔三球(取代旧锥形松树的高瘦剪影)
    y: 2.6,
    geo: canopyGeo([
      { p: [0, 0, 0], s: [1.08, 0.82, 1.08], c: '#4f8556' },
      { p: [0.05, 0.68, 0.02], s: [0.86, 0.7, 0.86], c: '#6da35f' },
      { p: [-0.04, 1.34, 0], s: [0.62, 0.54, 0.62], c: '#93bd74' },
    ]),
  },
  { // variant 2: 歪脖小圆树
    y: 2.95,
    geo: canopyGeo([
      { p: [0, 0, 0], s: [1.08, 0.88, 1.08], c: LEAF_MID },
      { p: [0.95, 0.42, 0.12], s: [0.62, 0.5, 0.62], c: LEAF_LIGHT },
      { p: [-0.65, 0.28, -0.22], s: [0.58, 0.48, 0.58], c: LEAF_DARK },
    ]),
  },
];

// 树干:3 段微倾斜圆柱合成的微弯曲暖棕树干(1 份几何,顶点色由深到浅)
const TRUNK_GEO = mergeParts([
  { geo: new THREE.CylinderGeometry(0.2, 0.28, 0.95, 9), m: mat4(0, 0.45, 0), color: '#7c5a40' },
  { geo: new THREE.CylinderGeometry(0.155, 0.2, 0.9, 9), m: mat4(0.05, 1.24, 0, 1, 1, 1, -0.09), color: '#87644a' },
  { geo: new THREE.CylinderGeometry(0.11, 0.155, 0.85, 9), m: mat4(0.15, 2.0, 0, 1, 1, 1, -0.16), color: '#94714f' },
]);

const CANOPY_OUTLINE = new THREE.MeshBasicMaterial({ color: '#3d6b41', side: THREE.BackSide });
const TRUNK_OUTLINE = new THREE.MeshBasicMaterial({ color: '#553f2e', side: THREE.BackSide });

export function Tree({ position, variant = 0, scale = 1 }: { position: [number, number, number]; variant?: number; scale?: number }) {
  const v = CANOPIES[((variant % CANOPIES.length) + CANOPIES.length) % CANOPIES.length];
  // 由摆放坐标确定性地转个角度,同种树不会看起来完全一样
  const ry = useMemo(() => (Math.abs(position[0] * 12.9898 + position[2] * 78.233) % (Math.PI * 2)), [position]);
  return (
    <group position={position} rotation={[0, ry, 0]} scale={scale}>
      <mesh geometry={TRUNK_GEO} material={VERT_TOON} castShadow />
      <mesh geometry={TRUNK_GEO} material={TRUNK_OUTLINE} scale={[1.14, 1.015, 1.14]} />
      <mesh geometry={v.geo} material={VERT_TOON} position={[0, v.y, 0]} castShadow />
      <mesh geometry={v.geo} material={CANOPY_OUTLINE} position={[0, v.y, 0]} scale={1.04} />
    </group>
  );
}

/* ─── Grass tufts(交叉弯曲叶片,InstancedMesh 一次画完) ─────────────── */
// 3 片弯曲三角叶片交叉成一丛,顶点色根部深→叶尖黄绿。
function buildTuftGeometry(): THREE.BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const base = new THREE.Color('#6f9a50');
  const mid = new THREE.Color('#8ab364');
  const tip = new THREE.Color('#b2cf7e');
  const blade = (ry: number, lean: number, h: number) => {
    const cosR = Math.cos(ry), sinR = Math.sin(ry);
    const v = (x: number, y: number, z: number, c: THREE.Color) => {
      position.push(x * cosR + z * sinR, y, -x * sinR + z * cosR);
      color.push(c.r, c.g, c.b);
    };
    const s = position.length / 3;
    v(-0.03, 0, 0, base); v(0.03, 0, 0, base);
    v(-0.02, h * 0.55, lean * 0.45, mid); v(0.02, h * 0.55, lean * 0.45, mid);
    v(0, h, lean, tip);
    index.push(s, s + 1, s + 2, s + 1, s + 3, s + 2, s + 2, s + 3, s + 4);
  };
  blade(0, 0.05, 0.22);
  blade(2.1, 0.07, 0.17);
  blade(4.2, 0.06, 0.2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
const TUFT_GEO = buildTuftGeometry();
const TUFT_MAT = new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true, gradientMap: toonGradient(), side: THREE.DoubleSide });

/**
 * 可复用草丛:单个 InstancedMesh(1 draw call)。
 * 用法一:传 positions 显式摆放(世界局部坐标)。
 * 用法二:不传 positions,则按 seed 在 innerRadius~radius 的圆环内确定性散布
 *         count 丛,并自动避开 |x|<2.8 / |z|<2.8 的主干道十字。
 */
export function GrassTufts({
  positions, count = 150, seed = 4242, radius = 58, innerRadius = 15,
}: {
  positions?: [number, number, number][];
  count?: number;
  seed?: number;
  radius?: number;
  innerRadius?: number;
}) {
  const mesh = useMemo(() => {
    const rnd = lcg(seed);
    let pts: [number, number, number][];
    if (positions) {
      pts = positions;
    } else {
      pts = [];
      let guard = 0;
      while (pts.length < count && guard++ < count * 30) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * radius;
        if (r < innerRadius) continue;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (Math.abs(x) < 2.8 || Math.abs(z) < 2.8) continue; // 让开主路十字
        pts.push([x, 0, z]);
      }
    }
    const inst = new THREE.InstancedMesh(TUFT_GEO, TUFT_MAT, pts.length);
    inst.frustumCulled = false; // 实例散布范围远超几何包围球,禁用剔除
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const [x, y, z] = pts[i];
      q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0));
      const sc = 0.7 + rnd() * 0.8;
      m.compose(p.set(x, y, z), q, s.set(sc, 0.8 + rnd() * 0.7, sc));
      inst.setMatrixAt(i, m);
    }
    return inst;
  }, [positions, count, seed, radius, innerRadius]);
  return <primitive object={mesh} />;
}

/* ─── Fountain:卡通水面 + 缓慢扩散的环形波纹 ────────────────────────── */
const FOUNTAIN_WATER = new THREE.MeshToonMaterial({ color: '#a7d7e6', gradientMap: toonGradient(), transparent: true, opacity: 0.92 });
const FOUNTAIN_WATER_HI = new THREE.MeshToonMaterial({ color: '#b7e0ec', gradientMap: toonGradient(), transparent: true, opacity: 0.92 });
const RING_GEO = (() => {
  const g = new THREE.RingGeometry(0.8, 1, 40);
  g.rotateX(-Math.PI / 2);
  return g;
})();

export function Fountain() {
  const sprayRef = useRef<THREE.Points>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringMats = useMemo(
    () => [0, 1, 2].map(() => new THREE.MeshToonMaterial({
      color: '#eef8fb', gradientMap: toonGradient(), transparent: true, opacity: 0, depthWrite: false,
    })),
    []
  );
  const particles = useMemo(() => {
    const n = 130;
    const arr = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    const rnd = lcg(20260726);
    for (let i = 0; i < n; i++) seeds[i] = rnd();
    return { arr, seeds, n };
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // 2-3 圈波纹:从中柱向池边缓慢扩散,边扩边淡出
    ringMats.forEach((mat, i) => {
      const mesh = ringRefs.current[i];
      if (!mesh) return;
      const phase = (t * 0.32 + i / 3) % 1;
      const r = 0.9 + phase * 2.9;
      mesh.scale.set(r, 1, r);
      mat.opacity = 0.5 * (1 - phase) * Math.min(1, phase * 8);
    });
    const pts = sprayRef.current;
    if (pts) {
      const pos = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < particles.n; i++) {
        const phase = ((t * 0.9 + particles.seeds[i]) % 1);
        const ang = particles.seeds[i] * Math.PI * 2;
        const r = 0.25 + phase * 1.1;
        pos.setXYZ(i, Math.cos(ang) * r, 2.35 + Math.sin(phase * Math.PI) * 1.15 - phase * 0.4, Math.sin(ang) * r);
      }
      pos.needsUpdate = true;
    }
  });
  return (
    <group>
      <mesh position={[0, 0.35, 0]} receiveShadow castShadow material={STONE_TOON}>
        <cylinderGeometry args={[4.5, 4.7, 0.7, 28]} />
      </mesh>
      <mesh position={[0, 0.72, 0]} material={FOUNTAIN_WATER}>
        <cylinderGeometry args={[4.15, 4.15, 0.06, 28]} />
      </mesh>
      {ringMats.map((mat, i) => (
        <mesh
          key={i}
          ref={(el) => { ringRefs.current[i] = el; }}
          geometry={RING_GEO}
          material={mat}
          position={[0, 0.765, 0]}
          renderOrder={2}
        />
      ))}
      <mesh position={[0, 0.9, 0]} castShadow material={STONE_TOON}>
        <cylinderGeometry args={[0.55, 0.8, 1.3, 14]} />
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow material={STONE_TOON}>
        <cylinderGeometry args={[1.5, 1.65, 0.28, 20]} />
      </mesh>
      <mesh position={[0, 1.78, 0]} material={FOUNTAIN_WATER_HI}>
        <cylinderGeometry args={[1.35, 1.35, 0.05, 20]} />
      </mesh>
      <mesh position={[0, 2.05, 0]} castShadow material={STONE_TOON}>
        <cylinderGeometry args={[0.28, 0.42, 0.7, 12]} />
      </mesh>
      <points ref={sprayRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles.arr, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#f2fbff" size={0.09} transparent opacity={0.75} depthWrite={false} />
      </points>
    </group>
  );
}

/* ─── Pond + bridge(结构不变,水与石头转粉彩) ──────────────────────── */
const POND_WATER = new THREE.MeshToonMaterial({ color: '#7ab8d4', gradientMap: toonGradient(), transparent: true, opacity: 0.9 });
const ROCK_GEO = new THREE.DodecahedronGeometry(1);
const ROCK_MAT = toonMat('#b4b9b1');

export function Pond({ position }: { position: [number, number, number] }) {
  const reflections = useSettings((s) => s.reflections);
  const rocks = useMemo(() => {
    const arr: { x: number; z: number; s: number; rx: number; rz: number }[] = [];
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      const x = Math.cos(a) * 8.3;
      const z = Math.sin(a) * 4.05;
      // leave the bridge crossing open (bridge runs along Z at local x≈0)
      if (Math.abs(x) < 1.6) continue;
      arr.push({ x, z, s: 0.2 + ((i * 7) % 3) * 0.07, rx: (i * 1.3) % 3, rz: (i * 2.1) % 3 });
    }
    return arr;
  }, []);
  return (
    <group position={position}>
      <group position={[0, 0.02, 0]}>
        {reflections && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
            <planeGeometry args={[8.2, 5]} />
            <MeshReflectorMaterial
              blur={[300, 100]} resolution={512} mixBlur={1} mixStrength={0.4}
              roughness={0.5} depthScale={0.35} color="#8fc3d8" metalness={0.15} mirror={0.3}
              transparent opacity={0.9}
            />
          </mesh>
        )}
        <mesh position={[-4.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={POND_WATER}>
          <circleGeometry args={[4.0, 26]} />
        </mesh>
        <mesh position={[4.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={POND_WATER}>
          <circleGeometry args={[4.0, 26]} />
        </mesh>
        {!reflections && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} material={POND_WATER}>
            <planeGeometry args={[9, 5]} />
          </mesh>
        )}
      </group>
      {rocks.map((r, i) => (
        <mesh key={i} position={[r.x, 0.1, r.z]} rotation={[r.rx, r.rz, 0]} scale={r.s} castShadow geometry={ROCK_GEO} material={ROCK_MAT} />
      ))}
    </group>
  );
}

export function Bridge({ position }: { position: [number, number, number] }) {
  const planks = useMemo(() => Array.from({ length: 15 }, (_, i) => i), []);
  return (
    <group position={position}>
      {planks.map((i) => {
        const z = -4.4 + i * 0.63;
        const t = z / 4.6;
        const y = Math.max(0, 0.55 * (1 - t * t));
        const tilt = -2 * 0.55 * t / 4.6;
        return (
          <mesh key={i} position={[0, y + 0.03, z]} rotation={[Math.atan(tilt), 0, 0]} castShadow receiveShadow material={WOOD_TOON}>
            <boxGeometry args={[2.1, 0.06, 0.6]} />
          </mesh>
        );
      })}
      {[-0.95, 0.95].map((x, side) => (
        <group key={side}>
          {[-4, -2, 0, 2, 4].map((z, i) => {
            const t = z / 4.6;
            const y = Math.max(0, 0.55 * (1 - t * t));
            return (
              <mesh key={i} position={[x, y + 0.45, z]} castShadow material={WOOD_TOON}>
                <boxGeometry args={[0.07, 0.8, 0.07]} />
              </mesh>
            );
          })}
          <mesh position={[x, 1.05, 0]} rotation={[0, 0, 0]} castShadow material={WOOD_TOON}>
            <boxGeometry args={[0.06, 0.06, 9]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ─── Picnic table ───────────────────────────────────────────────────────── */
export function Picnic({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.72, 0]} castShadow material={WOOD_TOON}><boxGeometry args={[1.4, 0.06, 1.0]} /></mesh>
      {[-0.95, 0.95].map((x, i) => (
        <mesh key={i} position={[x, 0.44, 0]} castShadow material={WOOD_TOON}><boxGeometry args={[0.32, 0.05, 1.0]} /></mesh>
      ))}
      {[-0.5, 0.5].map((x, i) => (
        <mesh key={i} position={[x, 0.36, 0]} rotation={[0, 0, x > 0 ? -0.5 : 0.5]} castShadow material={WOOD_TOON}>
          <boxGeometry args={[0.08, 0.78, 0.8]} />
        </mesh>
      ))}
    </group>
  );
}

/* ─── Flowerbed:5 瓣圆花瓣 + 黄芯小花,InstancedMesh 成簇 ───────────── */
// 花头 = 6 片椭圆花瓣合并成 1 份几何;花色用 instanceColor(粉/黄/白 3 色)
// → 每个花坛只有 花头/花芯/花茎 3 个 draw call。
const FLOWER_HEAD_GEO = (() => {
  const parts: { geo: THREE.BufferGeometry; m?: THREE.Matrix4 }[] = [];
  for (let i = 0; i < 6; i++) {
    const petal = new THREE.CircleGeometry(0.05, 8);
    petal.scale(0.62, 1, 1);              // 椭圆花瓣
    petal.translate(0, 0.045, 0);         // 花瓣根部靠向花芯
    petal.rotateX(-Math.PI / 2 + 0.32);   // 放平 + 微微上翘(碗状)
    petal.rotateY((i / 6) * Math.PI * 2);
    parts.push({ geo: petal });
  }
  return mergeParts(parts);
})();
const FLOWER_CENTER_GEO = (() => {
  const g = new THREE.SphereGeometry(0.032, 8, 6);
  g.scale(1, 0.65, 1);
  g.translate(0, 0.014, 0);
  return g;
})();
const STEM_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.009, 0.012, 1, 5);
  g.translate(0, 0.5, 0); // 底部落在 y=0,方便按茎高缩放
  return g;
})();
const PETAL_MAT = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGradient(), side: THREE.DoubleSide });
const CENTER_MAT = toonMat('#f3c45c');
const STEM_MAT = toonMat('#5f8f4a');
const FLOWER_COLORS = ['#f2a7bb', '#f6d98a', '#faf5ec']; // 粉 / 奶黄 / 白
const POT_MAT = toonMat('#b08768');
const SOIL_MAT = toonMat('#5d4a3c');

export function Flowerbed({ position }: { position: [number, number, number] }) {
  const flowers = useMemo(() => {
    // 种子由摆放坐标决定 → 每个花坛花型不同但每次加载一致
    const rnd = lcg(Math.abs(Math.round(position[0] * 131 + position[2] * 37)) + 7);
    const n = 24;
    const heads = new THREE.InstancedMesh(FLOWER_HEAD_GEO, PETAL_MAT, n);
    const centers = new THREE.InstancedMesh(FLOWER_CENTER_GEO, CENTER_MAT, n);
    const stems = new THREE.InstancedMesh(STEM_GEO, STEM_MAT, n);
    heads.frustumCulled = centers.frustumCulled = stems.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const noRot = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 1.12;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const h = 0.14 + rnd() * 0.16;
      m.compose(p.set(x, 0.2, z), noRot, s.set(1, h, 1));
      stems.setMatrixAt(i, m);
      q.setFromEuler(e.set((rnd() - 0.5) * 0.35, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.35));
      const hs = 0.85 + rnd() * 0.45;
      m.compose(p.set(x, 0.2 + h + 0.01, z), q, s.set(hs, hs, hs));
      heads.setMatrixAt(i, m);
      centers.setMatrixAt(i, m);
      heads.setColorAt(i, c.set(FLOWER_COLORS[i % FLOWER_COLORS.length]));
    }
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    return { heads, centers, stems };
  }, [position]);
  return (
    <group position={position}>
      <mesh position={[0, 0.09, 0]} receiveShadow castShadow material={POT_MAT}>
        <cylinderGeometry args={[1.45, 1.55, 0.18, 18]} />
      </mesh>
      <mesh position={[0, 0.19, 0]} material={SOIL_MAT}>
        <cylinderGeometry args={[1.35, 1.35, 0.04, 18]} />
      </mesh>
      <primitive object={flowers.stems} />
      <primitive object={flowers.heads} />
      <primitive object={flowers.centers} />
    </group>
  );
}

/* ─── Beach ball (server-simulated,粉彩条纹) ────────────────────────── */
export function BeachBall() {
  const ref = useRef<THREE.Group>(null);
  const mats = useMemo(
    () => ['#ef8f8f', '#faf3e8', '#8ab6e0', '#faf3e8', '#f4d488', '#faf3e8'].map((c) => toonMat(c)),
    []
  );
  const inner = useMemo(() => toonMat('#faf3e8'), []);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    g.visible = hot.ball.active;
    if (!g.visible) return;
    const k = Math.min(1, dt * 18);
    g.position.x += (hot.ball.x - g.position.x) * k;
    g.position.y += (hot.ball.y - g.position.y) * k;
    g.position.z += (hot.ball.z - g.position.z) * k;
    g.rotation.x += (hot.ball.rz - g.rotation.x) * k;
    g.rotation.z -= (hot.ball.rx - -g.rotation.z) * k;
  });
  return (
    <group ref={ref}>
      {mats.map((mat, i) => (
        <mesh key={i} rotation={[0, (i / 6) * Math.PI * 2, 0]} castShadow material={mat}>
          <sphereGeometry args={[0.36, 10, 12, 0, Math.PI / 3]} />
        </mesh>
      ))}
      <mesh castShadow material={inner}>
        <sphereGeometry args={[0.352, 14, 12]} />
      </mesh>
    </group>
  );
}
