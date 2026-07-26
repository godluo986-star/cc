/** The outdoor plaza: terrain, paths, all layout props and interactables. */
import { useMemo } from 'react';
import * as THREE from 'three';
import { LAYOUTS, SPACE, seededRandom } from '@nexuspark/shared';
import { renderProp, renderInteractable, BeachBall } from './registry';
import { GrassTufts } from '../prefabs/props';
import { grassTexture, pavingTexture } from './textures';

/* ═══ 二次元远景 & 地面点缀(纯视觉装饰,零碰撞、零 gameplay 坐标)═════════
 *  吉卜力/京阿尼式粉彩远山三层景深 + 赛璐璐草丛小花 + 远方小屋剪影。
 *  全部程序化:共享几何 + InstancedMesh,合计 ~11 个新增 draw call。
 *  确定性种子散布(seededRandom),与 layouts.ts 的碰撞体系零耦合。 */

let _ramp: THREE.DataTexture | null = null;
/** 4 阶赛璐璐渐变(toon gradientMap,module 级缓存,所有远景材质共享)。 */
function toonRamp(): THREE.DataTexture {
  if (_ramp) return _ramp;
  const t = new THREE.DataTexture(new Uint8Array([120, 176, 224, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  _ramp = t;
  return t;
}

interface Inst {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  rx?: number; ry?: number; rz?: number;
  color?: THREE.Color;
}

function makeInstanced(
  geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[], receiveShadow = false,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  items.forEach((it, i) => {
    e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    q.setFromEuler(e);
    p.set(it.x, it.y, it.z);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // 实例包围球不含实例位移,关掉剔除(户外全程可见,代价可忽略)
  mesh.frustumCulled = false;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

// ── 地面散布的排除区(粗略镜像 layouts.ts 的广场布置;只做视觉避让)──────
const PATH_RECTS = [
  { x: 0, z: -25, w: 5, d: 24 }, { x: 0, z: 34, w: 5, d: 44 },
  { x: -22, z: 0, w: 20, d: 5 }, { x: 22, z: 0, w: 20, d: 5 },
  { x: -30, z: -13, w: 8, d: 5 }, { x: 30, z: -14, w: 8, d: 5 },
  { x: 32, z: 10, w: 6, d: 5 }, { x: -32, z: 10, w: 6, d: 5 },
  { x: 16, z: 22, w: 5, d: 14 }, { x: -16, z: 24, w: 5, d: 16 },
];
const BUILDING_RECTS = [
  { x: -30, z: -22, w: 14, d: 11 }, { x: 30, z: -24, w: 18, d: 13 },
  { x: 36, z: 10, w: 13, d: 11 }, { x: -36, z: 10, w: 13, d: 11 },
  { x: 0, z: -43, w: 16, d: 12 },
];
const AVOID_CIRCLES: Array<[number, number, number]> = [
  [16, 30, 9.5],   // 池塘两瓣 + 木桥
  [-16, 27, 3.2],  // 野餐桌
  [-6, 34, 2.6], [26, 40, 2.6], [-30, 24, 2.6], // 花坛
  [-10, 22, 1.5], [6, 24, 1.5], [24, 24, 1.5], [-22, 38, 1.5], // 公园长椅
  [-18, -14, 0.7], [18, -14, 0.7], [-20, 14, 0.7], [20, 14, 0.7], // 路灯
  [-8, 30, 0.7], [8, 44, 0.7], [-26, 34, 0.7], [28, 34, 0.7],
];

function blocked(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r < 15.2 || r > 55.5) return true; // 中央铺装/喷泉圈 与 树篱以外
  for (const p of PATH_RECTS) {
    if (Math.abs(x - p.x) < p.w / 2 + 0.9 && Math.abs(z - p.z) < p.d / 2 + 0.9) return true;
  }
  for (const b of BUILDING_RECTS) {
    if (Math.abs(x - b.x) < b.w / 2 + 1.6 && Math.abs(z - b.z) < b.d / 2 + 1.6) return true;
  }
  for (const [cx, cz, cr] of AVOID_CIRCLES) {
    if (Math.hypot(x - cx, z - cz) < cr) return true;
  }
  return false;
}

// ── 丘陵环:三层景深(近黄绿 → 中青绿 → 远蓝紫灰,空气透视)────────────
const GAPS = [0.65, 2.5, 4.5];        // 山谷缺口中心角(弧度)
const GAP_HALF = [0.3, 0.22, 0.26];
function inGap(a: number): boolean {
  for (let i = 0; i < GAPS.length; i++) {
    let d = Math.abs((a - GAPS[i]) % (Math.PI * 2));
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < GAP_HALF[i]) return true;
  }
  return false;
}

const HILL_LAYERS = [
  { count: 11, r0: 57, r1: 64, sx: [10, 16] as const, sy: [3.2, 5.2] as const, color: '#a6c07c', y: -0.6, gap: true },
  { count: 9, r0: 67, r1: 76, sx: [15, 23] as const, sy: [5.0, 8.0] as const, color: '#83b39a', y: -0.9, gap: true },
  { count: 9, r0: 79, r1: 90, sx: [22, 32] as const, sy: [7.5, 11.5] as const, color: '#9aa1c6', y: -1.3, gap: false },
];
const HILL_TREE_COLORS = ['#7aa768', '#719f8d'];
const FLOWER_COLORS = ['#f4b9c8', '#f6d98a', '#f4efe2', '#cdb7e6', '#f7bb92'];

/** 一次性构建全部远景/点缀 Object3D + 草丛落点(在 useMemo 里调用一次)。 */
function buildBackdrop(): { objects: THREE.Object3D[]; tuftPts: [number, number, number][] } {
  const ramp = toonRamp();
  const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: ramp });
  const out: THREE.Object3D[] = [];

  // 共享几何
  const hillGeo = new THREE.SphereGeometry(1, 24, 16);
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.13, 1, 5); trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = new THREE.SphereGeometry(1, 9, 7);
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.03, 1, 4); stemGeo.translate(0, 0.5, 0);
  const headGeo = new THREE.SphereGeometry(0.075, 8, 6);
  const houseGeo = new THREE.BoxGeometry(1, 1, 1); houseGeo.translate(0, 0.5, 0);
  const roofGeo = new THREE.ConeGeometry(1, 1, 4); roofGeo.rotateY(Math.PI / 4); roofGeo.translate(0, 0.5, 0);

  // 1) 丘陵环(每层一个 InstancedMesh)+ 远景树落点采集
  const hRnd = seededRandom(8888);
  interface HillRec { x: number; z: number; y: number; sx: number; sy: number; sz: number; layer: number }
  const hillRecs: HillRec[] = [];
  HILL_LAYERS.forEach((L, li) => {
    const items: Inst[] = [];
    for (let i = 0; i < L.count; i++) {
      const a = (i / L.count) * Math.PI * 2 + (hRnd() - 0.5) * 0.35;
      if (L.gap && inGap(a)) continue; // 缺口:留出山谷
      const r = L.r0 + hRnd() * (L.r1 - L.r0);
      const sx = L.sx[0] + hRnd() * (L.sx[1] - L.sx[0]);
      const sy = L.sy[0] + hRnd() * (L.sy[1] - L.sy[0]);
      const sz = sx * (0.62 + hRnd() * 0.3);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      items.push({ x, y: L.y, z, sx, sy, sz });
      hillRecs.push({ x, z, y: L.y, sx, sy, sz, layer: li });
    }
    out.push(makeInstanced(hillGeo, toon(L.color), items));
  });

  // 2) 丘陵上的极简远景树(纯色圆球 + 杆,不描边;近/中两层)
  const tRnd = seededRandom(3210);
  const trunks: Inst[] = [];
  const canopies: Inst[] = [];
  for (const h of hillRecs) {
    if (h.layer > 1 || canopies.length >= 14 || tRnd() > 0.6) continue;
    const n = 1 + Math.floor(tRnd() * 2);
    for (let k = 0; k < n && canopies.length < 14; k++) {
      const fx = (tRnd() - 0.5) * 1.0;
      const fz = (tRnd() - 0.5) * 0.8;
      const surfY = h.y + h.sy * Math.sqrt(Math.max(0.08, 1 - fx * fx - fz * fz));
      const far = h.layer === 1;
      const trunkH = (far ? 1.8 : 1.4) + tRnd() * 0.7;
      const can = (far ? 1.8 : 1.4) + tRnd() * 0.7;
      const x = h.x + fx * h.sx;
      const z = h.z + fz * h.sz;
      trunks.push({ x, y: surfY - 0.15, z, sx: far ? 1.3 : 1, sy: trunkH + can * 0.3, sz: far ? 1.3 : 1 });
      canopies.push({
        x, y: surfY + trunkH + can * 0.55, z, sx: can, sy: can * 0.88, sz: can,
        color: new THREE.Color(HILL_TREE_COLORS[h.layer]),
      });
    }
  }
  out.push(makeInstanced(trunkGeo, toon('#907a67'), trunks));
  out.push(makeInstanced(canopyGeo, toon('#ffffff'), canopies));

  // 3) 远方小屋剪影(极浅色,躲在两个山谷缺口里;体 + 顶各 1 个 draw call)
  const sRnd = seededRandom(6060);
  const bodies: Inst[] = [];
  const roofs: Inst[] = [];
  for (const [gi, cnt] of [[0, 3], [2, 2]] as const) {
    for (let k = 0; k < cnt; k++) {
      const a = GAPS[gi] + (sRnd() - 0.5) * 0.32;
      const r = 72 + sRnd() * 8;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const w = 3 + sRnd() * 1.4;
      const bodyH = 2.1 + sRnd() * 0.8;
      const roofH = 1.3 + sRnd() * 0.6;
      const ry = -a + (sRnd() - 0.5) * 0.6;
      bodies.push({ x, y: -0.35, z, sx: w, sy: bodyH, sz: w * 0.85, ry });
      roofs.push({ x, y: bodyH - 0.38, z, sx: w * 0.8, sy: roofH, sz: w * 0.68, ry });
    }
  }
  out.push(makeInstanced(houseGeo, toon('#e9e3d7'), bodies));
  out.push(makeInstanced(roofGeo, toon('#cfa8a2'), roofs));

  // 4) 草丛落点(几何/材质交给 props 的 GrassTufts,叶片造型更像真草)
  const gRnd = seededRandom(90210);
  const tuftPts: [number, number, number][] = [];
  let guard = 0;
  while (tuftPts.length < 190 && guard++ < 4000) {
    const a = gRnd() * Math.PI * 2;
    const r = Math.sqrt(15.5 * 15.5 + (55.5 * 55.5 - 15.5 * 15.5) * gRnd()); // 面积均匀
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
    tuftPts.push([x, 0, z]);
  }

  // 5) 小花(茎 + 花头各 1 个 draw call;粉彩五色)
  const fRnd = seededRandom(4649);
  const stems: Inst[] = [];
  const heads: Inst[] = [];
  guard = 0;
  while (heads.length < 70 && guard++ < 2500) {
    const a = fRnd() * Math.PI * 2;
    const r = Math.sqrt(15.5 * 15.5 + (55.5 * 55.5 - 15.5 * 15.5) * fRnd());
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
    const stemH = 0.22 + fRnd() * 0.16;
    const hs = 0.9 + fRnd() * 0.4;
    stems.push({ x, y: 0, z, sx: 1, sy: stemH, sz: 1 });
    heads.push({
      x, y: stemH + 0.02, z, sx: hs, sy: hs * 0.85, sz: hs, ry: fRnd() * Math.PI * 2,
      color: new THREE.Color(FLOWER_COLORS[Math.floor(fRnd() * FLOWER_COLORS.length)]),
    });
  }
  out.push(makeInstanced(stemGeo, toon('#6d9861'), stems));
  out.push(makeInstanced(headGeo, toon('#ffffff'), heads));

  return { objects: out, tuftPts };
}

/** 远景 + 点缀总组:一块外圈草环兜底(遮住丘陵脚下的虚空),其余全实例化。 */
function ScenicBackdrop() {
  const { objects, tuftPts } = useMemo(() => buildBackdrop(), []);
  const ramp = useMemo(() => toonRamp(), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]}>
        <ringGeometry args={[46, 130, 48]} />
        <meshToonMaterial color="#9cb87b" gradientMap={ramp} />
      </mesh>
      {objects.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
      <GrassTufts positions={tuftPts} />
    </group>
  );
}

export default function Plaza() {
  const layout = LAYOUTS[SPACE.PLAZA];
  const grass = useMemo(() => grassTexture(), []);
  const paving = useMemo(() => pavingTexture(), []);

  return (
    <group>
      {/* grass base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[62, 48]} />
        <meshStandardMaterial map={grass} roughness={0.95} />
      </mesh>
      {/* plaza center paving */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} receiveShadow>
        <circleGeometry args={[13.5, 40]} />
        <meshStandardMaterial map={paving} roughness={0.85} />
      </mesh>
      {/* paths: N-S and E-W cross + building aprons */}
      {[
        { x: 0, z: -25, w: 5, d: 24 },
        { x: 0, z: 34, w: 5, d: 44 },
        { x: -22, z: 0, w: 20, d: 5 },
        { x: 22, z: 0, w: 20, d: 5 },
        { x: -30, z: -13, w: 8, d: 5 },
        { x: 30, z: -14, w: 8, d: 5 },
        { x: 32, z: 10, w: 6, d: 5 },
        { x: -32, z: 10, w: 6, d: 5 },
        { x: 16, z: 22, w: 5, d: 14 },
        { x: -16, z: 24, w: 5, d: 16 },
      ].map((p, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.005, p.z]} receiveShadow>
          <planeGeometry args={[p.w, p.d]} />
          <meshStandardMaterial map={paving} roughness={0.85} />
        </mesh>
      ))}

      {layout.props.map((p, i) => renderProp(p, i))}
      {layout.interactables.map((it) => renderInteractable(it, it.id))}
      <BeachBall />

      {/* 二次元远景丘陵环 + 草丛小花点缀(纯视觉,零碰撞) */}
      <ScenicBackdrop />
    </group>
  );
}
