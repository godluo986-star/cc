/**
 * 「黄昏街区」城市道具库(工单 P3-3,总纲 §2/§4.3/§5)。
 *
 * - c_* 全套道具组件(经 spaces/registry.tsx 按 layout prop type 挂载):
 *   钠灯 / 售货机 / 长椅 / 施工围栏 / 自行车 / 垃圾袋堆+乌鸦 / 旧海报 /
 *   空调外机 / 悬垂电缆 / 红绿灯 / 电话亭 / 储物柜 / 井盖 / 消防栓 / 花坛;
 * - 封闭地铁口 StationEntrance(下沉台阶 + 拉闸 + 还亮着的灯箱,§4.1);
 * - 高架天桥 Overpass(桥面/栏杆/桥墩/坡道,栏杆实例化,§4.1)。
 *
 * 全部程序化、全走 palette/toon/outline;重复道具几何模块级缓存共享,
 * 每实例只做种子化旋转/缩放抖动(§5 重复物体变化)。
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom } from '@nexuspark/shared';
import { hot } from '../../state/hot';
import { STATION, OVERPASS } from '@nexuspark/shared/src/cityplan';
import { ENV, ACCENT } from './palette';
import { toonMat } from './toon';
import { addOutline } from './outline';
import {
  MergeBag, unitBox, unitCylinder, vertexToonMat, makeInstanced, makeCanvas,
  canvasTexture, shade, cssShade, jitterColor,
} from './streets';

type P3 = [number, number, number];

/** 位置派生的确定性种子(同一位置每次进图外观一致)。 */
function posSeed(p: P3): number {
  return Math.abs(Math.round(p[0] * 131.71 + p[2] * 517.13 + p[1] * 31)) + 7;
}

/** 单实例 §5 抖动:旋转 ±4°、尺寸 ±8%。 */
function useJitter(position: P3): { ry: number; s: number; rnd: () => number } {
  return useMemo(() => {
    const rnd = seededRandom(posSeed(position));
    return { ry: (rnd() * 2 - 1) * 0.07, s: 1 + (rnd() * 2 - 1) * 0.08, rnd };
  }, [position[0], position[1], position[2]]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** 两点之间放一根圆柱(杆件/车架管)。 */
function cylBetween(
  bag: MergeBag, ax: number, ay: number, az: number,
  bx: number, by: number, bz: number, r: number, color: THREE.ColorRepresentation
): void {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  if (len < 1e-4) return;
  const e = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  );
  bag.add(unitCylinder(), {
    x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2,
    rx: e.x, ry: e.y, rz: e.z, sx: r * 2, sy: len, sz: r * 2, color,
  });
}

/** 由 MergeBag 出网格并挂描边(近/中景道具统一入口)。 */
function bagMesh(bag: MergeBag, outline = true, steps: 2 | 4 = 4): THREE.Mesh {
  const geo = bag.build() ?? new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(geo, vertexToonMat(steps));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (outline) addOutline(mesh);
  return mesh;
}

// ── 通用光晕/光斑贴图 ───────────────────────────────────────────────────────
let _haloTex: THREE.CanvasTexture | null = null;
function haloTexture(): THREE.CanvasTexture {
  if (_haloTex) return _haloTex;
  const [c, ctx] = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _haloTex = canvasTexture(c, false);
  return _haloTex;
}

const haloMatCache = new Map<string, THREE.MeshToonMaterial>();
/** 光晕面片材质(贴图自发光假光,§3;不受雾影响以保持灯芯可读)。 */
function haloMat(color: string, intensity: number): THREE.MeshToonMaterial {
  const key = `${color}@${intensity}`;
  let m = haloMatCache.get(key);
  if (!m) {
    m = toonMat(color, {
      emissive: color, emissiveIntensity: intensity,
      map: haloTexture(), emissiveMap: haloTexture(),
      transparent: true, side: THREE.DoubleSide, fog: false,
    });
    m.depthWrite = false;
    haloMatCache.set(key, m);
  }
  return m;
}

let _crossGeo: THREE.BufferGeometry | null = null;
/** 单位交叉双面片几何(两片合并 = 1 draw call)。 */
function crossPlaneGeo(): THREE.BufferGeometry {
  if (!_crossGeo) {
    const a = new THREE.PlaneGeometry(1, 1);
    const b = new THREE.PlaneGeometry(1, 1);
    b.rotateY(Math.PI / 2);
    _crossGeo = mergeGeometries([a, b]) ?? a;
    if (_crossGeo !== a) { a.dispose(); b.dispose(); }
  }
  return _crossGeo;
}

/** 交叉双面片光晕(免 billboard,任意角度可读;合并为单网格)。 */
function crossHalo(size: number, color: string, intensity: number): THREE.Mesh {
  const m = new THREE.Mesh(crossPlaneGeo(), haloMat(color, intensity));
  m.scale.setScalar(size);
  m.raycast = () => { /* 光晕不可拾取 */ };
  return m;
}

let _plane: THREE.PlaneGeometry | null = null;
function sharedPlane(): THREE.PlaneGeometry {
  if (!_plane) _plane = new THREE.PlaneGeometry(1, 1);
  return _plane;
}

// ═══ 井盖 / 排水篦(streets 摆放;c_manhole 单摆也用)═══════════════════════

let _manholeRes: { geo: THREE.BufferGeometry; mat: THREE.Material } | null = null;
export function manholeResources(): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  if (_manholeRes) return _manholeRes;
  const [c, ctx] = makeCanvas(128);
  ctx.fillStyle = cssShade(ENV.metal, -0.015);
  ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = cssShade(ENV.metal, -0.07);
  ctx.lineWidth = 3;
  for (const r of [56, 44, 30]) { ctx.beginPath(); ctx.arc(64, 64, r, 0, Math.PI * 2); ctx.stroke(); }
  // 放射纹
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30);
    ctx.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56);
    ctx.stroke();
  }
  const tex = canvasTexture(c, false);
  const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 20);
  const mat = toonMat(0xffffff, { map: tex });
  (mat as THREE.MeshToonMaterial).vertexColors = false;
  _manholeRes = { geo, mat };
  return _manholeRes;
}

let _drainRes: { geo: THREE.BufferGeometry; mat: THREE.Material } | null = null;
export function drainResources(): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  if (_drainRes) return _drainRes;
  const [c, ctx] = makeCanvas(128);
  ctx.fillStyle = cssShade(ENV.metal, -0.04);
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = cssShade(ENV.outline, 0.01);
  for (let i = 0; i < 6; i++) ctx.fillRect(10 + i * 20, 14, 10, 100); // 篦条缝
  const tex = canvasTexture(c, false);
  const geo = new THREE.BoxGeometry(0.95, 0.04, 0.45);
  const mat = toonMat(0xffffff, { map: tex });
  _drainRes = { geo, mat };
  return _drainRes;
}

// ═══ c_lamp 钠灯路灯(带光晕面片 + 地面光斑假光)════════════════════════════

let _lampGeo: THREE.BufferGeometry | null = null;
function lampGeo(): THREE.BufferGeometry {
  if (_lampGeo) return _lampGeo;
  const bag = new MergeBag();
  const metal = shade(ENV.metal, -0.01);
  bag.add(unitCylinder(), { x: 0, y: 2.3, z: 0, sx: 0.16, sy: 4.6, sz: 0.16, color: metal });
  bag.add(unitCylinder(), { x: 0, y: 0.06, z: 0, sx: 0.34, sy: 0.12, sz: 0.34, color: shade(ENV.metal, -0.04) });
  // 弯臂 + 灯头
  cylBetween(bag, 0, 4.55, 0, 0, 4.95, 0.75, 0.055, metal);
  bag.box(0, 4.96, 0.85, 0.3, 0.16, 0.72, shade(ENV.metal, 0.02));
  // 灯罩内发光面(暖色顶点色,配合光晕)
  bag.box(0, 4.87, 0.85, 0.22, 0.03, 0.6, shade(ACCENT.lampSodium, 0.05));
  _lampGeo = bag.build() ?? new THREE.BufferGeometry();
  return _lampGeo;
}

let _poolTex: THREE.CanvasTexture | null = null;
function lightPoolTexture(): THREE.CanvasTexture {
  if (_poolTex) return _poolTex;
  const [c, ctx] = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.34)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _poolTex = canvasTexture(c, false);
  return _poolTex;
}

let _poolMat: THREE.MeshToonMaterial | null = null;
function poolMat(): THREE.MeshToonMaterial {
  if (!_poolMat) {
    _poolMat = toonMat(ACCENT.lampSodium, {
      emissive: ACCENT.lampSodium, emissiveIntensity: 0.55,
      map: lightPoolTexture(), emissiveMap: lightPoolTexture(), transparent: true,
    });
    _poolMat.depthWrite = false;
  }
  return _poolMat;
}

export function CLamp({ position, ry = 0 }: { position: P3; ry?: number }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(lampGeo(), vertexToonMat(4));
    body.castShadow = true;
    addOutline(body);
    g.add(body);
    const halo = crossHalo(1.5, ACCENT.lampSodium, 0.8);
    halo.position.set(0, 4.87, 0.85);
    g.add(halo);
    const pool = new THREE.Mesh(sharedPlane(), poolMat());
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.085, 0.85);
    pool.scale.setScalar(7);
    pool.raycast = () => { /* 光斑不可拾取 */ };
    g.add(pool);
    return g;
  }, []);
  return (
    <primitive
      object={group}
      position={position}
      rotation={[0, ry + j.ry, 0]}
      scale={[j.s, j.s, j.s]}
    />
  );
}

// ═══ c_vend 自动售货机(红/蓝两款,可互动外观)═══════════════════════════════

function vendFrontTexture(kind: 'red' | 'blue'): THREE.CanvasTexture {
  const base = kind === 'red' ? ACCENT.vendingRed : ACCENT.vendingBlue;
  const rnd = seededRandom(kind === 'red' ? 4101 : 4102);
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = cssShade(base, -0.04);
  ctx.fillRect(0, 0, 256, 256);
  // 展示窗(上 2/3):暗底 + 三排饮料
  ctx.fillStyle = cssShade(ENV.outline, 0.02);
  ctx.fillRect(18, 14, 220, 150);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      const colors = [ACCENT.windowWarm, ACCENT.konbiniSign, ACCENT.vendingRed, ACCENT.vendingBlue, ENV.wallPale];
      ctx.fillStyle = cssShade(colors[Math.floor(rnd() * colors.length)], -0.05);
      ctx.fillRect(28 + i * 36, 26 + row * 48, 22, 34);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(30 + i * 36, 28 + row * 48, 5, 30); // 高光
    }
    // 层板
    ctx.fillStyle = cssShade(ENV.metal, 0.05);
    ctx.fillRect(18, 62 + row * 48, 220, 4);
  }
  // 出货口 + 投币面板
  ctx.fillStyle = cssShade(ENV.outline, 0.04);
  ctx.fillRect(18, 190, 140, 52);
  ctx.strokeStyle = cssShade(base, 0.1);
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 190, 140, 52);
  ctx.fillStyle = cssShade(base, 0.14);
  ctx.fillRect(176, 178, 62, 64);
  ctx.fillStyle = cssShade(ENV.outline, 0.02);
  ctx.fillRect(196, 186, 22, 4);   // 投币口
  ctx.fillRect(188, 200, 38, 26);  // 按钮区
  // 品牌横条
  ctx.fillStyle = cssShade(base, 0.12);
  ctx.fillRect(0, 166, 256, 16);
  return canvasTexture(c, false);
}

const vendMatCache = new Map<string, THREE.MeshToonMaterial>();
function vendFrontMat(kind: 'red' | 'blue'): THREE.MeshToonMaterial {
  let m = vendMatCache.get(kind);
  if (!m) {
    const tex = vendFrontTexture(kind);
    m = toonMat(0xffffff, { map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.32 });
    vendMatCache.set(kind, m);
  }
  return m;
}

export function CVend({ position, ry = 0, kind = 'red' }: { position: P3; ry?: number; kind?: 'red' | 'blue' }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    const base = kind === 'red' ? ACCENT.vendingRed : ACCENT.vendingBlue;
    const g = new THREE.Group();
    const bag = new MergeBag();
    bag.box(0, 0.95, 0, 1.1, 1.9, 0.78, shade(base, -0.02));
    bag.box(0, 0.05, 0, 1.14, 0.1, 0.82, shade(ENV.metal, -0.03));
    bag.box(0, 1.92, 0, 1.14, 0.06, 0.82, shade(base, -0.08));
    const body = bagMesh(bag);
    g.add(body);
    const front = new THREE.Mesh(sharedPlane(), vendFrontMat(kind));
    front.position.set(0, 1.0, 0.395);
    front.scale.set(1.02, 1.7, 1);
    g.add(front);
    // 门口微光晕(生活感锚点,§4.3)
    const halo = crossHalo(1.0, base, 0.35);
    halo.position.set(0, 1.1, 0.55);
    g.add(halo);
    return g;
  }, [kind]);
  return <primitive object={group} position={position} rotation={[0, ry + j.ry, 0]} scale={[j.s, j.s, j.s]} />;
}

// ═══ c_bench 街头长椅 ═══════════════════════════════════════════════════════

let _benchGeo: THREE.BufferGeometry | null = null;
function benchGeo(): THREE.BufferGeometry {
  if (_benchGeo) return _benchGeo;
  const bag = new MergeBag();
  const wood = shade(ENV.wallB, -0.06, 0.01);
  for (let i = 0; i < 3; i++) bag.box(0, 0.42 + i * 0.001, -0.12 + i * 0.14, 1.7, 0.05, 0.11, shade(wood, i * 0.012));
  for (let i = 0; i < 2; i++) bag.box(0, 0.62 + i * 0.14, -0.24 - i * 0.045, 1.7, 0.05, 0.1, shade(wood, 0.02 + i * 0.012), 0);
  for (const sx of [-0.72, 0.72]) {
    bag.box(sx, 0.21, 0, 0.07, 0.42, 0.5, ENV.metal);
    bag.box(sx, 0.55, -0.26, 0.07, 0.5, 0.07, ENV.metal);
  }
  _benchGeo = bag.build() ?? new THREE.BufferGeometry();
  return _benchGeo;
}

export function CBench({ position, ry = 0 }: { position: P3; ry?: number }) {
  const j = useJitter(position);
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(benchGeo(), vertexToonMat(4));
    m.castShadow = true; m.receiveShadow = true;
    addOutline(m);
    return m;
  }, []);
  return <primitive object={mesh} position={position} rotation={[0, ry + j.ry, 0]} scale={[j.s, j.s, j.s]} />;
}

// ═══ c_fence 施工围栏(黄黑条)═══════════════════════════════════════════════

let _fenceTex: THREE.CanvasTexture | null = null;
function fenceTexture(): THREE.CanvasTexture {
  if (_fenceTex) return _fenceTex;
  const rnd = seededRandom(4321);
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = cssShade(ACCENT.lampSodium, 0.04, 0, 0.1); // 工地黄(钠灯黄派生)
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = ENV.outline;
  ctx.save();
  ctx.translate(128, 128);
  ctx.rotate(-Math.PI / 4);
  for (let i = -4; i <= 4; i++) ctx.fillRect(i * 64 - 16, -220, 32, 440);
  ctx.restore();
  // 脏渍磨损
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.12 + rnd() * 0.12;
    ctx.fillStyle = cssShade(ENV.metal, -0.03);
    ctx.beginPath();
    ctx.ellipse(rnd() * 256, rnd() * 256, 4 + rnd() * 16, 3 + rnd() * 8, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  _fenceTex = canvasTexture(c);
  return _fenceTex;
}

let _fenceMat: THREE.MeshToonMaterial | null = null;
/** 施工围栏:w = 总宽(米),按 1.8m 一片居中排开,逐片微歪(§4.3 禁止整齐)。 */
export function CFence({ position, ry = 0, w = 1.8 }: { position: P3; ry?: number; w?: number }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    if (!_fenceMat) _fenceMat = toonMat(0xffffff, { map: fenceTexture(), side: THREE.DoubleSide });
    const g = new THREE.Group();
    const rnd = seededRandom(posSeed(position) + 5);
    const count = Math.max(1, Math.round(w / 1.8));
    for (let i = 0; i < count; i++) {
      const seg = new THREE.Group();
      const panel = new THREE.Mesh(sharedPlane(), _fenceMat);
      panel.scale.set(1.76, 0.95, 1);
      panel.position.y = 0.62;
      panel.castShadow = true;
      seg.add(panel);
      const feet = new MergeBag();
      for (const sx of [-0.8, 0.8]) {
        feet.add(unitCylinder(), { x: sx, y: 0.55, z: 0, sx: 0.09, sy: 1.1, sz: 0.09, color: ENV.metal });
        feet.box(sx, 0.03, 0, 0.4, 0.06, 0.4, shade(ENV.metal, -0.04));
      }
      seg.add(bagMesh(feet, false));
      seg.position.set((i - (count - 1) / 2) * 1.8, 0, (rnd() - 0.5) * 0.1);
      seg.rotation.y = (rnd() - 0.5) * 0.1;
      g.add(seg);
    }
    return g;
  }, [w]); // eslint-disable-line react-hooks/exhaustive-deps
  return <primitive object={group} position={position} rotation={[0, ry + j.ry * 0.3, 0]} scale={[j.s, j.s, j.s]} />;
}

// ═══ c_bike 自行车(含倒地 variant)═════════════════════════════════════════

let _bikeGeo: THREE.BufferGeometry | null = null;
let _wheelGeo: THREE.TorusGeometry | null = null;
function bikeParts(): { frame: THREE.BufferGeometry; wheel: THREE.TorusGeometry } {
  if (!_bikeGeo || !_wheelGeo) {
    const bag = new MergeBag();
    const fc = shade(ENV.metal, 0.03, 0.01);
    // 车架三角 + 前叉 + 座杆 + 把手
    cylBetween(bag, -0.42, 0.32, 0, 0.1, 0.62, 0, 0.022, fc);
    cylBetween(bag, -0.42, 0.32, 0, -0.05, 0.6, 0, 0.022, fc);
    cylBetween(bag, -0.05, 0.6, 0, 0.1, 0.62, 0, 0.02, fc);
    cylBetween(bag, 0.1, 0.62, 0, 0.44, 0.32, 0, 0.02, fc);
    cylBetween(bag, -0.05, 0.6, 0, -0.42, 0.32, 0, 0.02, fc);
    cylBetween(bag, -0.09, 0.72, 0, -0.02, 0.6, 0, 0.02, fc); // 座杆
    bag.box(-0.1, 0.75, 0, 0.24, 0.05, 0.08, shade(ENV.outline, 0.04)); // 车座
    cylBetween(bag, 0.44, 0.32, 0, 0.36, 0.78, 0, 0.02, fc); // 前叉→把
    bag.box(0.36, 0.8, 0, 0.05, 0.04, 0.42, fc); // 横把
    // 车筐
    bag.box(0.42, 0.62, 0, 0.24, 0.18, 0.26, shade(ENV.metal, -0.02));
    _bikeGeo = bag.build() ?? new THREE.BufferGeometry();
    _wheelGeo = new THREE.TorusGeometry(0.3, 0.024, 8, 20);
  }
  return { frame: _bikeGeo, wheel: _wheelGeo };
}

let _wheelMat: THREE.MeshToonMaterial | null = null;
export function CBike({ position, ry = 0, fallen = false }: { position: P3; ry?: number; fallen?: boolean }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    const { frame, wheel } = bikeParts();
    if (!_wheelMat) _wheelMat = toonMat(shade(ENV.outline, 0.05));
    const g = new THREE.Group();
    const fm = new THREE.Mesh(frame, vertexToonMat(4));
    fm.castShadow = true;
    addOutline(fm);
    g.add(fm);
    for (const wx of [-0.42, 0.44]) {
      const w = new THREE.Mesh(wheel, _wheelMat);
      w.position.set(wx, 0.31, 0);
      w.castShadow = true;
      g.add(w);
    }
    if (fallen) {
      g.rotation.z = 0;
      g.rotation.x = Math.PI / 2 - 0.12;
      g.position.y = 0.09;
    } else {
      g.rotation.z = 0.09; // 斜靠
    }
    return g;
  }, [fallen]);
  return (
    <group position={position} rotation={[0, ry + j.ry, 0]} scale={[j.s, j.s, j.s]}>
      <primitive object={group} />
    </group>
  );
}

// ═══ c_trash 垃圾袋堆 + 乌鸦(受惊起飞)═════════════════════════════════════

let _bagSphere: THREE.SphereGeometry | null = null;
function bagSphere(): THREE.SphereGeometry {
  if (!_bagSphere) _bagSphere = new THREE.SphereGeometry(0.5, 10, 8);
  return _bagSphere;
}

let _triGeo: THREE.BufferGeometry | null = null;
/** 乌鸦翅膀:单三角面片(两枚镜像使用)。 */
function wingTri(): THREE.BufferGeometry {
  if (_triGeo) return _triGeo;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 0.34, 0.02, -0.1, 0.3, 0.02, 0.12,
  ]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1]), 2));
  _triGeo = g;
  return g;
}

let _crowMat: THREE.MeshToonMaterial | null = null;
function crowMat(): THREE.MeshToonMaterial {
  if (!_crowMat) _crowMat = toonMat(shade(ENV.outline, 0.015), { side: THREE.DoubleSide });
  return _crowMat;
}

function Crow({ offset }: { offset: P3 }) {
  const root = useRef<THREE.Group>(null);
  const wingL = useRef<THREE.Mesh>(null);
  const wingR = useRef<THREE.Mesh>(null);
  const st = useRef({ mode: 'idle' as 'idle' | 'fly' | 'gone', t: 0, wx: 0, wz: 0, dir: new THREE.Vector3() });
  const body = useMemo(() => {
    const bag = new MergeBag();
    const c = shade(ENV.outline, 0.015);
    bag.add(bagSphere(), { x: 0, y: 0.1, z: 0, sx: 0.24, sy: 0.2, sz: 0.4, color: c });
    bag.add(bagSphere(), { x: 0, y: 0.2, z: 0.16, sx: 0.14, sy: 0.13, sz: 0.14, color: c });
    bag.box(0, 0.19, 0.26, 0.035, 0.03, 0.1, shade(ACCENT.lampSodium, -0.12)); // 喙
    bag.add(bagSphere(), { x: 0, y: 0.1, z: -0.24, sx: 0.05, sy: 0.03, sz: 0.26, color: c }); // 尾
    return bag.build() ?? new THREE.BufferGeometry();
  }, []);

  useFrame((state, dt) => {
    const g = root.current;
    if (!g) return;
    const s = st.current;
    if (s.wx === 0 && s.wz === 0) {
      const wp = new THREE.Vector3();
      g.getWorldPosition(wp);
      s.wx = wp.x; s.wz = wp.z;
    }
    if (s.mode === 'idle') {
      const d = Math.hypot(hot.local.x - s.wx, hot.local.z - s.wz);
      if (d < 3.4) {
        s.mode = 'fly';
        s.t = 0;
        s.dir.set(s.wx - hot.local.x, 0, s.wz - hot.local.z);
        if (s.dir.lengthSq() < 1e-4) s.dir.set(1, 0, 0);
        s.dir.normalize();
        g.visible = true;
      }
    } else if (s.mode === 'fly') {
      s.t += dt;
      const t = s.t;
      g.position.set(offset[0] + s.dir.x * t * 4.5, offset[1] + t * t * 2.2 + t * 1.2, offset[2] + s.dir.z * t * 4.5);
      g.rotation.y = Math.atan2(s.dir.x, s.dir.z);
      const flap = Math.sin(t * 22) * 0.95;
      if (wingL.current) wingL.current.rotation.z = 0.25 + flap;
      if (wingR.current) wingR.current.rotation.z = -0.25 - flap;
      if (t > 4) { s.mode = 'gone'; s.t = 0; g.visible = false; }
    } else {
      s.t += dt;
      if (s.t > 45) { // 风头过了,乌鸦落回原位
        s.mode = 'idle';
        g.position.set(offset[0], offset[1], offset[2]);
        g.rotation.y = 0;
        g.visible = true;
        if (wingL.current) wingL.current.rotation.z = 0.1;
        if (wingR.current) wingR.current.rotation.z = -0.1;
      }
    }
  });

  return (
    <group ref={root} position={offset}>
      <mesh geometry={body} material={vertexToonMat(4)} castShadow />
      <mesh ref={wingL} geometry={wingTri()} material={crowMat()} position={[0.06, 0.16, -0.02]} rotation={[0, 0, 0.1]} />
      <mesh ref={wingR} geometry={wingTri()} material={crowMat()} position={[-0.06, 0.16, -0.02]} rotation={[0, Math.PI, -0.1]} />
    </group>
  );
}

export function CTrash({ position, ry = 0, crow = true }: { position: P3; ry?: number; crow?: boolean }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    const rnd = seededRandom(posSeed(position) + 11);
    const bag = new MergeBag();
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const s = 0.4 + rnd() * 0.32;
      const x = (rnd() - 0.5) * 1.4;
      const z = (rnd() - 0.5) * 1.0;
      const c = jitterColor(shade(ENV.skyTopDusk, -0.025), rnd); // 半透明黑袋的冷蓝黑
      bag.add(bagSphere(), { x, y: s * 0.36, z, sx: s, sy: s * 0.72, sz: s, ry: rnd() * Math.PI, color: c });
      bag.add(bagSphere(), { x, y: s * 0.72, z, sx: s * 0.16, sy: s * 0.14, sz: s * 0.16, color: shade(ENV.skyTopDusk, -0.05) }); // 扎口
    }
    // 散落纸屑
    for (let i = 0; i < 4; i++) {
      bag.box((rnd() - 0.5) * 2.2, 0.012, (rnd() - 0.5) * 1.8, 0.18, 0.005, 0.24, shade(ENV.wallPale, 0.08), rnd() * Math.PI);
    }
    return bagMesh(bag);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group position={position} rotation={[0, ry + j.ry, 0]} scale={[j.s, j.s, j.s]}>
      <primitive object={group} />
      {crow && <Crow offset={[0.3, 0.62, 0.1]} />}
    </group>
  );
}

// ═══ c_poster 旧海报(边角微摆顶点动画)═════════════════════════════════════

const POSTER_ACCENTS = [ACCENT.cinemaSign, ACCENT.netcafeSign, ACCENT.konbiniSign, ACCENT.mahjongLantern];

function posterTexture(variant: number): THREE.CanvasTexture {
  const rnd = seededRandom(5000 + variant);
  const accent = POSTER_ACCENTS[variant % POSTER_ACCENTS.length];
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = cssShade(ENV.wallPale, 0.14, 0, -0.05); // 褪色纸
  ctx.fillRect(0, 0, 256, 256);
  // 标题条 + 图形块 + 文本行(抽象排版,不成文字)
  ctx.fillStyle = cssShade(accent, -0.08, 0, -0.15);
  ctx.fillRect(20, 18, 216, 42);
  ctx.fillStyle = cssShade(accent, 0.02, 0.02, -0.2);
  ctx.fillRect(20, 74, 216, 96);
  ctx.fillStyle = cssShade(ENV.outline, 0.12);
  for (let i = 0; i < 5; i++) ctx.fillRect(24, 184 + i * 13, 100 + rnd() * 110, 6);
  // 泛黄水渍
  for (let i = 0; i < 6; i++) {
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = cssShade(ACCENT.lampSodium, -0.1, 0, -0.2);
    ctx.beginPath();
    ctx.ellipse(rnd() * 256, rnd() * 256, 20 + rnd() * 50, 14 + rnd() * 34, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 撕裂边
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 14; i++) {
    const edge = Math.floor(rnd() * 4);
    const x = edge === 0 ? 0 : edge === 1 ? 256 : rnd() * 256;
    const y = edge === 2 ? 0 : edge === 3 ? 256 : rnd() * 256;
    ctx.beginPath();
    ctx.ellipse(x, y, 4 + rnd() * 12, 3 + rnd() * 8, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvasTexture(c, false);
}

/** 全部海报共享一个时间 uniform(任一实例的 useFrame 更新即可)。 */
const posterTime = { value: 0 };
const posterMatCache = new Map<number, THREE.MeshToonMaterial>();
function posterMat(variant: number): THREE.MeshToonMaterial {
  let m = posterMatCache.get(variant);
  if (!m) {
    m = toonMat(0xffffff, { map: posterTexture(variant), transparent: true, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uPosterTime = posterTime as unknown as THREE.IUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uPosterTime;')
        .replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            '// 旧海报边角微摆(§4.3):越靠右缘/下缘摆幅越大',
            'float posterEdge = pow(uv.x, 2.0) * 0.7 + pow(1.0 - uv.y, 2.0) * 0.3;',
            'transformed.z += sin(uPosterTime * 1.7 + uv.y * 5.0 + uv.x * 3.0) * posterEdge * 0.045;',
          ].join('\n')
        );
    };
    posterMatCache.set(variant, m);
  }
  return m;
}

let _posterGeo: THREE.PlaneGeometry | null = null;
export function CPoster({ position, ry = 0, variant = 0 }: { position: P3; ry?: number; variant?: number }) {
  const j = useJitter(position);
  if (!_posterGeo) _posterGeo = new THREE.PlaneGeometry(0.85, 1.15, 6, 8);
  useFrame((state) => { posterTime.value = state.clock.elapsedTime; });
  return (
    <mesh
      geometry={_posterGeo}
      material={posterMat(variant)}
      position={position}
      rotation={[0, ry, (j.ry * 0.6)]}
      scale={[j.s, j.s, j.s]}
    />
  );
}

// ═══ c_ac 空调外机(滴水渍 decal)═══════════════════════════════════════════

let _acFrontTex: THREE.CanvasTexture | null = null;
function acFrontTexture(): THREE.CanvasTexture {
  if (_acFrontTex) return _acFrontTex;
  const [c, ctx] = makeCanvas(128);
  ctx.fillStyle = cssShade(ENV.metal, 0.05);
  ctx.fillRect(0, 0, 128, 128);
  // 风扇圆 + 格栅
  ctx.strokeStyle = cssShade(ENV.metal, -0.06);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(44, 64, 34, 0, Math.PI * 2); ctx.stroke();
  for (let r = 8; r <= 30; r += 7) { ctx.beginPath(); ctx.arc(44, 64, r, 0, Math.PI * 2); ctx.stroke(); }
  for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(92, 16 + i * 14); ctx.lineTo(120, 16 + i * 14); ctx.stroke(); }
  // 锈渍
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = cssShade(ACCENT.mahjongLantern, -0.18, 0, -0.15);
  ctx.fillRect(0, 108, 128, 20);
  ctx.globalAlpha = 1;
  _acFrontTex = canvasTexture(c, false);
  return _acFrontTex;
}

let _dripTex: THREE.CanvasTexture | null = null;
function dripTexture(): THREE.CanvasTexture {
  if (_dripTex) return _dripTex;
  const rnd = seededRandom(6001);
  const [c, ctx] = makeCanvas(128);
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 5; i++) {
    const x = 24 + rnd() * 80;
    const w = 3 + rnd() * 7;
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(20,24,36,0.4)');
    grad.addColorStop(1, 'rgba(20,24,36,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, w, 60 + rnd() * 68);
  }
  _dripTex = canvasTexture(c, false);
  return _dripTex;
}

let _acFrontMat: THREE.MeshToonMaterial | null = null;
let _dripMat: THREE.MeshToonMaterial | null = null;
export function CAc({ position, ry = 0 }: { position: P3; ry?: number }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    if (!_acFrontMat) _acFrontMat = toonMat(0xffffff, { map: acFrontTexture() });
    if (!_dripMat) {
      _dripMat = toonMat(0xffffff, { map: dripTexture(), transparent: true });
      _dripMat.depthWrite = false;
    }
    const g = new THREE.Group();
    const bag = new MergeBag();
    bag.box(0, 0, 0, 0.78, 0.56, 0.3, jitterColor(ENV.metal, seededRandom(posSeed(position) + 3)));
    // 托架
    bag.box(0, -0.34, -0.06, 0.7, 0.05, 0.2, shade(ENV.metal, -0.05));
    for (const sx of [-0.3, 0.3]) bag.box(sx, -0.45, -0.13, 0.05, 0.3, 0.05, shade(ENV.metal, -0.05));
    const body = bagMesh(bag);
    g.add(body);
    const front = new THREE.Mesh(sharedPlane(), _acFrontMat);
    front.position.set(0, 0, 0.155);
    front.scale.set(0.74, 0.52, 1);
    g.add(front);
    // 滴水渍:贴在下方墙面(local -z 是墙)
    const drip = new THREE.Mesh(sharedPlane(), _dripMat);
    drip.position.set(0.1, -0.85, -0.145);
    drip.scale.set(0.7, 1.1, 1);
    g.add(drip);
    return g;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <primitive object={group} position={position} rotation={[0, ry, 0]} scale={[j.s, j.s, j.s]} />;
}

// ═══ c_wires 悬垂电缆(CatmullRom 弧线,缓慢摆动)════════════════════════════

let _wireMat: THREE.MeshToonMaterial | null = null;
export function CWires({
  position, ry = 0, to, len = 12, sag = 1.0, strands = 2,
}: { position: P3; ry?: number; to?: P3; len?: number; sag?: number; strands?: number }) {
  const group = useMemo(() => {
    if (!_wireMat) _wireMat = toonMat(shade(ENV.outline, 0.03));
    const g = new THREE.Group();
    // 挂点:prop 位置在地面时默认从 5.2m 高处挂出;有明确 y 时以其为端点
    const hangY = position[1] > 1.5 ? 0 : 5.2;
    const start = new THREE.Vector3(0, hangY, 0);
    const end = to
      ? new THREE.Vector3(to[0] - position[0], to[1] - position[1], to[2] - position[2])
      : new THREE.Vector3(Math.sin(ry) * len, hangY, Math.cos(ry) * len);
    const rnd = seededRandom(posSeed(position) + 21);
    for (let s = 0; s < strands; s++) {
      const off = (s - (strands - 1) / 2) * 0.14;
      const a = start.clone(); a.x += off;
      const b = end.clone(); b.x += off;
      const drop = sag * (0.85 + rnd() * 0.35);
      const q1 = a.clone().lerp(b, 0.25); q1.y -= drop * 0.68;
      const mid = a.clone().lerp(b, 0.5); mid.y -= drop;
      const q3 = a.clone().lerp(b, 0.75); q3.y -= drop * 0.68;
      const curve = new THREE.CatmullRomCurve3([a, q1, mid, q3, b]);
      const tube = new THREE.TubeGeometry(curve, 20, 0.018 + rnd() * 0.008, 5, false);
      g.add(new THREE.Mesh(tube, _wireMat));
    }
    return g;
  }, [position[0], position[1], position[2], ry, to, len, sag, strands]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<THREE.Group>(null);
  const phase = useMemo(() => posSeed(position) % 7, [position]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((state) => {
    if (ref.current) {
      // 缓慢摆动(整束绕挂线轴微转,§4.3)
      ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.45 + phase) * 0.012;
    }
  });
  return (
    <group ref={ref} position={position}>
      <primitive object={group} />
    </group>
  );
}

// ═══ c_signal 红绿灯(慢循环,ACCENT 红/绿)══════════════════════════════════

let _lampCircle: THREE.CylinderGeometry | null = null;
function lampCircleGeo(): THREE.CylinderGeometry {
  // 灯面圆盘:轴向 x(灯箱朝 +x 面对来车方向)
  if (!_lampCircle) _lampCircle = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12).rotateZ(Math.PI / 2);
  return _lampCircle;
}

export function CSignal({ position, ry = 0 }: { position: P3; ry?: number }) {
  const j = useJitter(position);
  const redMat = useMemo(() => toonMat(shade(ACCENT.trafficRed, -0.12), {
    emissive: ACCENT.trafficRed, emissiveIntensity: 0, fog: false,
  }), []);
  const greenMat = useMemo(() => toonMat(shade(ACCENT.trafficGreen, -0.14), {
    emissive: ACCENT.trafficGreen, emissiveIntensity: 0, fog: false,
  }), []);
  const haloRef = useRef<THREE.Group>(null);
  const statics = useMemo(() => {
    const bag = new MergeBag();
    const metal = shade(ENV.metal, -0.02);
    bag.add(unitCylinder(), { x: 0, y: 2.6, z: 0, sx: 0.18, sy: 5.2, sz: 0.18, color: metal });
    bag.add(unitCylinder(), { x: 0, y: 0.06, z: 0, sx: 0.4, sy: 0.12, sz: 0.4, color: shade(ENV.metal, -0.05) });
    cylBetween(bag, 0, 5.1, 0, 0, 5.35, 2.6, 0.06, metal); // 悬臂伸向路面上方
    bag.box(0, 5.32, 2.9, 0.3, 0.42, 0.92, shade(ENV.metal, 0.015)); // 灯箱(纵排两灯,面向 +x)
    bag.box(0.18, 5.55, 2.9, 0.2, 0.06, 1.0, shade(ENV.outline, 0.03)); // 遮光檐
    const body = new THREE.Mesh(bag.build() ?? new THREE.BufferGeometry(), vertexToonMat(4));
    body.castShadow = true;
    addOutline(body);
    const haloRed = crossHalo(0.55, ACCENT.trafficRed, 0.7);
    haloRed.position.set(0.3, 5.32, 2.62);
    const haloGreen = crossHalo(0.55, ACCENT.trafficGreen, 0.65);
    haloGreen.position.set(0.3, 5.32, 3.18);
    return { body, haloRed, haloGreen };
  }, []);
  const phase = useMemo(() => (posSeed(position) % 17), [position]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => {
    const t = (state.clock.elapsedTime + phase) % 17;
    // 0-7 绿,7-9 绿闪,9-17 红(慢周期,§2.2)
    let green = 0, red = 0;
    if (t < 7) green = 1;
    else if (t < 9) green = Math.sin(t * Math.PI * 3) > 0 ? 1 : 0;
    else red = 1;
    redMat.emissiveIntensity = red * 0.95;
    greenMat.emissiveIntensity = green * 0.9;
    statics.haloRed.visible = red > 0.5;
    statics.haloGreen.visible = green > 0.5;
  });

  return (
    <group position={position} rotation={[0, ry + j.ry * 0.3, 0]} scale={[j.s, j.s, j.s]}>
      <primitive object={statics.body} />
      <mesh geometry={lampCircleGeo()} material={redMat} position={[0.16, 5.32, 2.62]} />
      <mesh geometry={lampCircleGeo()} material={greenMat} position={[0.16, 5.32, 3.18]} />
      <group ref={haloRef}>
        <primitive object={statics.haloRed} />
        <primitive object={statics.haloGreen} />
      </group>
    </group>
  );
}

// ═══ c_phone 公用电话亭 ═════════════════════════════════════════════════════

function phoneSignTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128);
  ctx.fillStyle = cssShade(ACCENT.konbiniSign, -0.28, 0, -0.2);
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = cssShade(ACCENT.konbiniSign, 0.12);
  ctx.font = 'bold 64px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = cssShade(ACCENT.konbiniSign, 0.1);
  ctx.shadowBlur = 12;
  ctx.fillText('電話', 64, 66);
  return canvasTexture(c, false);
}

let _phoneSignMat: THREE.MeshToonMaterial | null = null;
let _glassMat: THREE.MeshToonMaterial | null = null;
export function CPhone({ position, ry = 0 }: { position: P3; ry?: number }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    if (!_phoneSignMat) {
      const tex = phoneSignTexture();
      _phoneSignMat = toonMat(0xffffff, { map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5, fog: false });
    }
    if (!_glassMat) {
      _glassMat = toonMat(shade(ENV.skyTopDusk, 0.06), { transparent: true, opacity: 0.28, side: THREE.DoubleSide });
      _glassMat.depthWrite = false;
    }
    const g = new THREE.Group();
    const bag = new MergeBag();
    const frame = shade(ENV.wallC, -0.02);
    // 四角柱 + 顶盒 + 底座
    for (const [sx, sz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]] as const) {
      bag.box(sx, 1.15, sz, 0.1, 2.3, 0.1, frame);
    }
    bag.box(0, 2.42, 0, 1.3, 0.24, 1.3, shade(frame, -0.03));
    bag.box(0, 0.04, 0, 1.24, 0.08, 1.24, shade(ENV.metal, -0.04));
    // 内部话机
    bag.box(0, 1.35, -0.48, 0.34, 0.5, 0.12, shade(ENV.metal, 0.04));
    bag.box(0.12, 1.3, -0.4, 0.07, 0.24, 0.07, shade(ENV.outline, 0.05));
    bag.box(0, 0.95, -0.42, 0.5, 0.06, 0.3, frame); // 小台
    const bodyMesh = bagMesh(bag);
    g.add(bodyMesh);
    // 玻璃(三面)
    for (const [x, z, r] of [[0, 0.55, 0], [-0.55, 0, Math.PI / 2], [0.55, 0, Math.PI / 2]] as const) {
      const p = new THREE.Mesh(sharedPlane(), _glassMat);
      p.position.set(x, 1.25, z);
      p.rotation.y = r;
      p.scale.set(1.0, 2.0, 1);
      g.add(p);
    }
    // 顶部灯箱(还亮着)
    const sign = new THREE.Mesh(sharedPlane(), _phoneSignMat);
    sign.position.set(0, 2.42, 0.66);
    sign.scale.set(0.9, 0.22, 1);
    g.add(sign);
    return g;
  }, []);
  return <primitive object={group} position={position} rotation={[0, ry + j.ry * 0.4, 0]} scale={[j.s, j.s, j.s]} />;
}

// ═══ c_locker 投币储物柜 ════════════════════════════════════════════════════

let _lockerTex: THREE.CanvasTexture | null = null;
function lockerTexture(): THREE.CanvasTexture {
  if (_lockerTex) return _lockerTex;
  const rnd = seededRandom(6100);
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = cssShade(ENV.wallC, 0.03);
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = cssShade(ENV.outline, 0.06);
  ctx.lineWidth = 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 8 + col * 61, y = 8 + row * 82;
      ctx.globalAlpha = 1;
      ctx.strokeRect(x, y, 55, 76);
      ctx.fillStyle = cssShade(ENV.wallC, 0.03 + (rnd() - 0.5) * 0.04);
      ctx.fillRect(x + 2, y + 2, 51, 72);
      // 锁孔 + 编号牌
      ctx.fillStyle = cssShade(ENV.metal, -0.06);
      ctx.fillRect(x + 38, y + 30, 10, 14);
      ctx.fillStyle = cssShade(ACCENT.lampSodium, 0.1, 0, -0.25);
      ctx.fillRect(x + 8, y + 8, 20, 10);
    }
  }
  _lockerTex = canvasTexture(c, false);
  return _lockerTex;
}

let _lockerFrontMat: THREE.MeshToonMaterial | null = null;
export function CLocker({ position, ry = 0 }: { position: P3; ry?: number }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    if (!_lockerFrontMat) _lockerFrontMat = toonMat(0xffffff, { map: lockerTexture() });
    const g = new THREE.Group();
    const bag = new MergeBag();
    bag.box(0, 0.93, 0, 1.5, 1.86, 0.55, shade(ENV.wallC, 0.0));
    bag.box(0, 0.03, 0, 1.54, 0.06, 0.6, shade(ENV.metal, -0.04));
    g.add(bagMesh(bag));
    const front = new THREE.Mesh(sharedPlane(), _lockerFrontMat);
    front.position.set(0, 0.98, 0.28);
    front.scale.set(1.44, 1.7, 1);
    g.add(front);
    return g;
  }, []);
  return <primitive object={group} position={position} rotation={[0, ry + j.ry * 0.3, 0]} scale={[j.s, j.s, j.s]} />;
}

// ═══ c_manhole / c_hydrant / c_planter ══════════════════════════════════════

export function CManhole({ position }: { position: P3 }) {
  const j = useJitter(position);
  const res = manholeResources();
  return (
    <mesh
      geometry={res.geo} material={res.mat}
      position={[position[0], position[1] + 0.02, position[2]]}
      rotation={[0, j.ry * 20, 0]} scale={[j.s, 1, j.s]}
      receiveShadow
    />
  );
}

let _hydrantGeo: THREE.BufferGeometry | null = null;
function hydrantGeo(): THREE.BufferGeometry {
  if (_hydrantGeo) return _hydrantGeo;
  const bag = new MergeBag();
  const red = shade(ACCENT.vendingRed, -0.06, 0, -0.08);
  bag.add(unitCylinder(), { x: 0, y: 0.05, z: 0, sx: 0.44, sy: 0.1, sz: 0.44, color: shade(ENV.metal, -0.03) });
  bag.add(unitCylinder(), { x: 0, y: 0.42, z: 0, sx: 0.3, sy: 0.74, sz: 0.3, color: red });
  bag.add(unitCylinder(), { x: 0, y: 0.82, z: 0, sx: 0.2, sy: 0.12, sz: 0.2, color: shade(red, 0.04) });
  bag.add(unitCylinder(), { x: 0, y: 0.9, z: 0, sx: 0.1, sy: 0.08, sz: 0.1, color: shade(red, 0.07) });
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    bag.add(unitCylinder(), {
      x: Math.sin(a) * 0.17, y: 0.5, z: Math.cos(a) * 0.17,
      rx: Math.PI / 2, ry: a, sx: 0.12, sy: 0.1, sz: 0.12, color: shade(red, -0.05),
    });
  }
  _hydrantGeo = bag.build() ?? new THREE.BufferGeometry();
  return _hydrantGeo;
}

export function CHydrant({ position, ry = 0 }: { position: P3; ry?: number }) {
  const j = useJitter(position);
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(hydrantGeo(), vertexToonMat(4));
    m.castShadow = true;
    addOutline(m);
    return m;
  }, []);
  return <primitive object={mesh} position={position} rotation={[0, ry + j.ry * 3, 0]} scale={[j.s, j.s, j.s]} />;
}

export function CPlanter({ position, ry = 0 }: { position: P3; ry?: number }) {
  const j = useJitter(position);
  const group = useMemo(() => {
    const rnd = seededRandom(posSeed(position) + 31);
    const bag = new MergeBag();
    bag.box(0, 0.26, 0, 1.4, 0.52, 0.6, jitterColor(ENV.sidewalk, rnd));
    bag.box(0, 0.5, 0, 1.32, 0.05, 0.52, shade(ENV.skyTopDusk, -0.02)); // 土
    // 夜色下的灌木(暗青偏绿派生)
    const bush = shade(ENV.wallC, -0.045, 0.09, 0.06);
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const s = 0.3 + rnd() * 0.26;
      bag.add(bagSphere(), {
        x: (rnd() - 0.5) * 1.0, y: 0.52 + s * 0.55, z: (rnd() - 0.5) * 0.3,
        sx: s * 1.2, sy: s, sz: s * 1.1, ry: rnd() * Math.PI, color: jitterColor(bush, rnd),
      });
    }
    return bagMesh(bag);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <primitive object={group} position={position} rotation={[0, ry + j.ry, 0]} scale={[j.s, j.s, j.s]} />;
}

// ═══ c_pier 天桥桥墩(位置由 layout 落点,与碰撞圆一致)═════════════════════

let _pierGeo: THREE.BufferGeometry | null = null;
function pierGeo(): THREE.BufferGeometry {
  if (_pierGeo) return _pierGeo;
  const bag = new MergeBag();
  const h = OVERPASS.deck.y - 0.4; // 到桥板底
  bag.add(unitCylinder(), { x: 0, y: h / 2, z: 0, sx: 0.9, sy: h, sz: 0.9, color: shade(ENV.sidewalk, -0.05) });
  bag.add(unitCylinder(), { x: 0, y: 0.14, z: 0, sx: 1.15, sy: 0.28, sz: 1.15, color: shade(ENV.sidewalk, -0.075) });
  bag.box(0, h - 0.25, 0, 1.25, 0.5, 1.25, shade(ENV.sidewalk, -0.065));
  _pierGeo = bag.build() ?? new THREE.BufferGeometry();
  return _pierGeo;
}

export function CPier({ position }: { position: P3 }) {
  const j = useJitter(position);
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(pierGeo(), vertexToonMat(4));
    m.castShadow = true;
    m.receiveShadow = true;
    addOutline(m);
    return m;
  }, []);
  return <primitive object={mesh} position={position} rotation={[0, j.ry * 8, 0]} scale={[j.s, 1, j.s]} />;
}

// ═══ 封闭地铁口(§4.1:下沉台阶 + 拉闸 + 还亮着的灯箱)═══════════════════════

/**
 * 地铁口在地面上开的洞(City.tsx 用它给地面 Shape 挖孔)。
 * 洞略小于坑体外壁(壁厚盖住洞缘,不露出地面板厚度);cz 为洞中心的局部 z 偏移
 * (楼梯向 -z 下行,坑体不以 STATION 原点为中心)。
 */
export const STATION_PIT = { w: 4.0, d: 5.6, cz: -0.65 };

function stationSignTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = cssShade(ENV.outline, 0.02);
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = cssShade(ACCENT.windowWarm, 0.02);
  ctx.fillRect(10, 88, 236, 80);
  ctx.fillStyle = cssShade(ENV.outline, 0.0);
  ctx.font = 'bold 52px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('地下鉄', 128, 118);
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('M E T R O', 128, 152);
  return canvasTexture(c, false);
}

let _shutterTexClosed: THREE.CanvasTexture | null = null;
/** 卷帘门横纹(地铁拉闸/店面卷帘共用)。 */
export function shutterTexture(): THREE.CanvasTexture {
  if (_shutterTexClosed) return _shutterTexClosed;
  const rnd = seededRandom(6200);
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = cssShade(ENV.wallC, 0.0);
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    ctx.fillStyle = cssShade(ENV.wallC, -0.045);
    ctx.fillRect(0, y + 12, 256, 4);
    ctx.fillStyle = cssShade(ENV.wallC, 0.035);
    ctx.fillRect(0, y, 256, 2);
  }
  // 锈痕
  for (let i = 0; i < 8; i++) {
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = cssShade(ACCENT.mahjongLantern, -0.16, 0, -0.2);
    ctx.fillRect(rnd() * 256, rnd() * 200, 3 + rnd() * 10, 40 + rnd() * 100);
  }
  ctx.globalAlpha = 1;
  _shutterTexClosed = canvasTexture(c);
  return _shutterTexClosed;
}

export function StationEntrance() {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const bag = new MergeBag();
    const wallC = shade(ENV.sidewalk, -0.02);
    const W = 3.6;               // 楼梯净宽
    const depth = 1.5;           // 下沉深度(6 级 × 0.25)
    const runL = 4.4;            // 台阶总进深
    // 6 级下行台阶(-z 方向下行)
    for (let i = 0; i < 6; i++) {
      const stepD = runL / 6;
      bag.box(0, -depth * ((i + 0.5) / 6), -runL / 2 + (5 - i + 0.5) * stepD,
        W, depth / 6, stepD, shade(ENV.sidewalk, -0.01 - i * 0.008));
    }
    // 坑壁三面 + 底部平台
    bag.box(-W / 2 - 0.15, -depth / 2 + 0.45, 0, 0.3, depth + 0.9, runL + 1.4, wallC);
    bag.box(W / 2 + 0.15, -depth / 2 + 0.45, 0, 0.3, depth + 0.9, runL + 1.4, wallC);
    bag.box(0, -depth + 0.02, -runL / 2 - 0.55, W, 0.16, 1.3, shade(ENV.sidewalk, -0.035));
    bag.box(0, -depth / 2 + 0.45, -runL / 2 - 1.25, W + 0.6, depth + 0.9, 0.3, wallC);
    // 地面护沿(防跌矮墙)
    for (const sx of [-1, 1]) {
      bag.box(sx * (W / 2 + 0.32), 0.45, 0.2, 0.16, 0.9, runL + 0.8, shade(ENV.sidewalk, 0.015));
      bag.box(sx * (W / 2 + 0.32), 0.94, 0.2, 0.22, 0.08, runL + 0.9, ENV.metal); // 扶手
    }
    // 入口门架 + 顶棚
    bag.box(0, 1.45, runL / 2 + 0.1, W + 0.9, 0.18, 0.4, shade(ENV.wallA, -0.02));
    for (const sx of [-1, 1]) bag.box(sx * (W / 2 + 0.28), 0.72, runL / 2 + 0.1, 0.24, 1.46, 0.24, shade(ENV.wallA, -0.04));
    bag.box(0, 1.62, -0.4, W + 0.9, 0.14, runL + 1.6, shade(ENV.wallA, -0.06)); // 顶棚盖住坑
    // 中央扶手
    bag.box(0, 0.55, 0.3, 0.06, 0.06, runL * 0.8, ENV.metal);
    for (const zz of [-1.2, 0.4, 1.8]) bag.box(0, 0.24, zz, 0.05, 0.62, 0.05, ENV.metal);
    const body = bagMesh(bag);
    g.add(body);

    // 拉闸(下到底后被封住):横纹卷帘 + 挂锁横杆
    const shutter = new THREE.Mesh(sharedPlane(), toonMat(0xffffff, { map: shutterTexture() }));
    shutter.position.set(0, -depth + 1.05, -runL / 2 - 1.05);
    shutter.scale.set(W - 0.1, 2.0, 1);
    g.add(shutter);
    const barBag = new MergeBag();
    barBag.box(0, -depth + 0.55, -runL / 2 - 0.98, W - 0.2, 0.07, 0.07, shade(ENV.metal, 0.04));
    g.add(bagMesh(barBag, false));

    // 还亮着的灯箱(异常感来源,§4.1):挂在闸门上方
    const signTex = stationSignTexture();
    const sign = new THREE.Mesh(sharedPlane(), toonMat(0xffffff, {
      map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.75, fog: false,
    }));
    sign.position.set(0, 1.05, runL / 2 + 0.32);
    sign.scale.set(2.4, 0.7, 1);
    g.add(sign);
    const glow = crossHalo(1.4, ACCENT.windowWarm, 0.4);
    glow.position.set(0, 0.4, runL / 2 + 0.5);
    g.add(glow);
    // 阶梯深处的冷光(灯还亮着,人却进不去)
    const innerGlow = crossHalo(1.6, ACCENT.windowWarm, 0.5);
    innerGlow.position.set(0, -depth + 1.6, -runL / 2 - 0.7);
    g.add(innerGlow);
    return g;
  }, []);
  return (
    <primitive
      object={group}
      position={[STATION.x, 0, STATION.z]}
      rotation={[0, STATION.ry, 0]}
    />
  );
}

// ═══ 高架人行天桥(§4.1:桥面/栏杆/桥墩/坡道;栏杆实例化)════════════════════

let _railPostGeo: THREE.BufferGeometry | null = null;
function railPostGeo(): THREE.BufferGeometry {
  if (_railPostGeo) return _railPostGeo;
  const bag = new MergeBag();
  bag.box(0, 0.55, 0, 0.07, 1.1, 0.07, ENV.metal);
  _railPostGeo = bag.build() ?? new THREE.BufferGeometry();
  return _railPostGeo;
}

let _railPostMat: THREE.MeshToonMaterial | null = null;

export function Overpass() {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const { deck, ramps } = OVERPASS;
    const surfaceY = deck.y;           // 契约:deck.y = 5.2(行走面)
    const slabT = 0.4;
    const bag = new MergeBag();
    const deckColor = shade(ENV.sidewalk, -0.015);
    const posts: { x: number; y: number; z: number; ry?: number; s?: number; color?: THREE.Color }[] = [];
    const rnd = seededRandom(9300);
    if (!_railPostMat) _railPostMat = toonMat(ENV.metal);

    // 桥面板 + 侧沿
    bag.box(deck.x, surfaceY - slabT / 2, deck.z, deck.w, slabT, deck.d, deckColor);
    const alongX = deck.w >= deck.d;
    const L = alongX ? deck.w : deck.d;
    const T = alongX ? deck.d : deck.w;
    const edgeColor = shade(ENV.sidewalk, -0.06);
    if (alongX) {
      bag.box(deck.x, surfaceY - slabT - 0.12, deck.z - T / 2 + 0.2, L, 0.28, 0.4, edgeColor);
      bag.box(deck.x, surfaceY - slabT - 0.12, deck.z + T / 2 - 0.2, L, 0.28, 0.4, edgeColor);
    } else {
      bag.box(deck.x - T / 2 + 0.2, surfaceY - slabT - 0.12, deck.z, 0.4, 0.28, L, edgeColor);
      bag.box(deck.x + T / 2 - 0.2, surfaceY - slabT - 0.12, deck.z, 0.4, 0.28, L, edgeColor);
    }

    // 桥面栏杆:两长边,立柱实例化 + 上下横杆合并
    const nPosts = Math.max(2, Math.floor(L / 1.5));
    for (let i = 0; i <= nPosts; i++) {
      const along = -L / 2 + (i / nPosts) * L;
      for (const side of [-1, 1]) {
        const cross = side * (T / 2 - 0.12);
        posts.push({
          x: deck.x + (alongX ? along : cross),
          y: surfaceY,
          z: deck.z + (alongX ? cross : along),
          ry: (rnd() - 0.5) * 0.03,
          s: 1 + (rnd() - 0.5) * 0.02,
          color: jitterColor(ENV.metal, rnd),
        });
      }
    }
    for (const side of [-1, 1]) {
      const cross = side * (T / 2 - 0.12);
      for (const hy of [1.08, 0.62]) {
        if (alongX) bag.box(deck.x, surfaceY + hy, deck.z + cross, L, 0.07, 0.07, shade(ENV.metal, 0.02));
        else bag.box(deck.x + cross, surfaceY + hy, deck.z, 0.07, 0.07, L, shade(ENV.metal, 0.02));
      }
      // 防抛网薄板(半高,压暗)
      if (alongX) bag.box(deck.x, surfaceY + 0.32, deck.z + cross, L, 0.56, 0.02, shade(ENV.metal, -0.05));
      else bag.box(deck.x + cross, surfaceY + 0.32, deck.z, 0.02, 0.56, L, shade(ENV.metal, -0.05));
    }

    // 桥墩由 layout 的 c_pier prop 落点(与碰撞圆一致),此处不再自摆(见 CPier)

    // 坡道:由桥面端头下到地面(方向按 ramp 相对 deck 的位置推断,dir 字段兜底)
    for (const ramp of ramps) {
      const dx = ramp.x - deck.x;
      const dz = ramp.z - deck.z;
      const rAlongX = Math.abs(dx) > Math.abs(dz)
        ? true
        : Math.abs(dz) > Math.abs(dx)
          ? false
          : (ramp.dir === 'e' || ramp.dir === 'w');
      const rLen = rAlongX ? ramp.w : ramp.d;
      const rWid = rAlongX ? ramp.d : ramp.w;
      // 远离桥面一侧下坡:+axis 方向 = 离开桥面方向时 sign 为正
      const sign = rAlongX
        ? (dx !== 0 ? Math.sign(dx) : (ramp.dir === 'e' ? 1 : -1))
        : (dz !== 0 ? Math.sign(dz) : (ramp.dir === 's' ? 1 : -1));
      const slope = Math.atan2(surfaceY, rLen);
      const slabLen = Math.hypot(rLen, surfaceY);
      // 倾斜坡板:绕水平轴旋转(alongX 用 rz,alongZ 用 rx;方向推导见实现说明)
      const rz = rAlongX ? -sign * slope : 0;
      const rx = rAlongX ? 0 : sign * slope;
      bag.add(unitBox(), {
        x: ramp.x, y: surfaceY / 2 - (slabT / 2) * Math.cos(slope), z: ramp.z,
        rx, rz,
        sx: rAlongX ? slabLen : rWid, sy: slabT, sz: rAlongX ? rWid : slabLen,
        color: shade(ENV.sidewalk, -0.025),
      });
      // 侧栏实心矮墙(坡道栏杆简化,§10 预算):随坡板同角度倾斜
      for (const side of [-1, 1]) {
        const cross = side * (rWid / 2 - 0.1);
        bag.add(unitBox(), {
          x: ramp.x + (rAlongX ? 0 : cross),
          y: surfaceY / 2 + 0.5 * Math.cos(slope),
          z: ramp.z + (rAlongX ? cross : 0),
          rx, rz,
          sx: rAlongX ? slabLen : 0.14, sy: 1.0, sz: rAlongX ? 0.14 : slabLen,
          color: shade(ENV.metal, -0.02),
        });
      }
      // 坡下支撑短柱
      const nSup = 3;
      for (let i = 1; i <= nSup; i++) {
        const f = i / (nSup + 1);
        const along = -rLen / 2 + f * rLen;
        const sy = surfaceY * (sign > 0 ? 0.5 - along / rLen : 0.5 + along / rLen) - slabT;
        if (sy < 0.4) continue;
        bag.add(unitCylinder(), {
          x: ramp.x + (rAlongX ? along : 0), y: sy / 2, z: ramp.z + (rAlongX ? 0 : along),
          sx: 0.5, sy, sz: 0.5, color: shade(ENV.sidewalk, -0.06),
        });
      }
    }

    const bodyGeo = bag.build();
    if (bodyGeo) {
      const mesh = new THREE.Mesh(bodyGeo, vertexToonMat(4));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      addOutline(mesh);
      g.add(mesh);
    }
    g.add(makeInstanced(railPostGeo(), _railPostMat, posts));
    return g;
  }, []);
  return <primitive object={group} />;
}
