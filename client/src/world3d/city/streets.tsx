/**
 * 「黄昏街区」路网渲染(工单 P3-1,总纲 §2/§4/§5)。
 *
 * 数据全部来自 shared/src/cityplan.ts(P2 精排),本模块只按数据渲染:
 * - 沥青路面:ENV.roadAsphalt + 程序化雨渍/修补斑块 canvas 贴图(512px,种子确定);
 * - 人行道砖:冷灰砖纹贴图 + 路缘石(合并几何,顶点色);
 * - 斑马线:白条 alpha 贴花(磨损缺角),中央路口另有对角线菱形贴花;
 * - 井盖/排水篦:props2 提供网格资源,这里按路段种子散布(InstancedMesh)。
 * 整个路网合并为 ≤ 8 个 draw call(路面/人行道/路缘/斑马线/路口贴花/井盖/排水篦)。
 *
 * 同时导出被 buildings/foreground 复用的通用构建工具(MergeBag / 色彩抖动 /
 * canvas 贴图辅助),避免三个模块各写一份。
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom } from '@nexuspark/shared';
import { ROADS, CROSSING, CROSSWALKS, SIDEWALKS } from '@nexuspark/shared/src/cityplan';
import { ENV } from './palette';
import { toonMat } from './toon';
import type { BuildQueue } from './progressive';
import { manholeResources, drainResources } from './props2';

// ═══ 通用构建工具(streets/buildings/foreground 共用)═══════════════════════

/** 色板颜色派生:亮度/色相/饱和偏移(全场颜色仍以 palette 为根,禁止新魔法色)。 */
export function shade(base: THREE.ColorRepresentation, dl: number, dh = 0, ds = 0): THREE.Color {
  return new THREE.Color(base).offsetHSL(dh, ds, dl);
}

/** shade() 的 css 字符串版(canvas 绘制用)。 */
export function cssShade(base: THREE.ColorRepresentation, dl: number, dh = 0, ds = 0): string {
  return `#${shade(base, dl, dh, ds).getHexString()}`;
}

/** §5 重复物体变化:色相 ±3%(≈±0.01 hue)/明度 ±6% 种子抖动。 */
export function jitterColor(base: THREE.ColorRepresentation, rnd: () => number): THREE.Color {
  return new THREE.Color(base).offsetHSL((rnd() * 2 - 1) * 0.01, 0, (rnd() * 2 - 1) * 0.06);
}

/**
 * 合并袋:把大量小几何(附世界变换 + 每件顶点色)合并成 1 个 BufferGeometry
 * → 1 个 draw call。所有静态城市体块(路缘/建筑体/护栏…)经此合并。
 */
export class MergeBag {
  private parts: THREE.BufferGeometry[] = [];

  /** 加入一件:src 不会被修改(内部 clone);color 写入顶点色。 */
  add(
    src: THREE.BufferGeometry,
    opts: {
      x: number; y: number; z: number;
      rx?: number; ry?: number; rz?: number;
      sx?: number; sy?: number; sz?: number;
      color: THREE.ColorRepresentation;
    }
  ): this {
    const g = src.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(opts.x, opts.y, opts.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0)),
      new THREE.Vector3(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1)
    );
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    const c = new THREE.Color(opts.color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
    return this;
  }

  /** 便捷:单位盒子(中心在 y 中点)。 */
  box(x: number, y: number, z: number, w: number, h: number, d: number,
    color: THREE.ColorRepresentation, ry = 0): this {
    return this.add(unitBox(), { x, y, z, sx: w, sy: h, sz: d, ry, color });
  }

  get size(): number { return this.parts.length; }

  /** 合并并清空;空袋返回 null。 */
  build(): THREE.BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    return merged;
  }
}

// 共享单位几何(MergeBag.add 会 clone,不会污染)
let _unitBox: THREE.BoxGeometry | null = null;
export function unitBox(): THREE.BoxGeometry {
  if (!_unitBox) _unitBox = new THREE.BoxGeometry(1, 1, 1);
  return _unitBox;
}
let _unitCyl: THREE.CylinderGeometry | null = null;
/** 单位圆柱(r=0.5, h=1,8 边低模,城市杆件用)。 */
export function unitCylinder(): THREE.CylinderGeometry {
  if (!_unitCyl) _unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  return _unitCyl;
}

// 顶点色 toon 材质(合并网格共用;白色仅作顶点色中性乘数,非场景色)
const vcMatCache = new Map<string, THREE.MeshToonMaterial>();
export function vertexToonMat(steps: 2 | 4 = 4): THREE.MeshToonMaterial {
  const key = `vc${steps}`;
  let m = vcMatCache.get(key);
  if (!m) {
    m = toonMat(0xffffff, { steps });
    m.vertexColors = true;
    vcMatCache.set(key, m);
  }
  return m;
}

/** 实例化摆放描述。 */
export interface InstanceItem {
  x: number; y: number; z: number;
  ry?: number; rx?: number; rz?: number;
  s?: number;
  color?: THREE.Color;
}

/**
 * InstancedMesh 构建(种子抖动由调用方写进 items)。
 * 实例包围球不含实例位移 → 关剔除(工单第 5 条)。
 */
export function makeInstanced(
  geo: THREE.BufferGeometry, mat: THREE.Material, items: InstanceItem[]
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  items.forEach((it, i) => {
    e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3().setScalar(it.s ?? 1));
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** 512px 程序化 canvas(§5 手绘质感统一入口)。 */
export function makeCanvas(size = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  return [c, ctx];
}

export function canvasTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

// ═══ 路面贴图(种子确定,512px)═════════════════════════════════════════════

let _asphaltTex: THREE.CanvasTexture | null = null;
/** 沥青:ENV.roadAsphalt 底 + 雨渍水印 + 修补斑块 + 细裂缝(贴图 1 tile ≈ 8m)。 */
export function asphaltTexture(): THREE.CanvasTexture {
  if (_asphaltTex) return _asphaltTex;
  const rnd = seededRandom(20260701);
  const [c, ctx] = makeCanvas(512);
  ctx.fillStyle = ENV.roadAsphalt;
  ctx.fillRect(0, 0, 512, 512);
  // 雨渍:大块低透明深色湿斑(手绘水印感)
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = 0.1 + rnd() * 0.1;
    ctx.fillStyle = cssShade(ENV.roadAsphalt, -0.035 - rnd() * 0.02, 0.004, 0.02);
    ctx.beginPath();
    ctx.ellipse(rnd() * 512, rnd() * 512, 50 + rnd() * 120, 30 + rnd() * 80, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 磨亮车辙:浅色纵向条带
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = cssShade(ENV.roadAsphalt, 0.035);
    ctx.fillRect(rnd() * 512, 0, 26 + rnd() * 40, 512);
  }
  // 修补斑块:色差矩形 + 深色描界
  for (let i = 0; i < 6; i++) {
    const x = rnd() * 460, y = rnd() * 460, w = 36 + rnd() * 90, h = 24 + rnd() * 70;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((rnd() - 0.5) * 0.3);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = cssShade(ENV.roadAsphalt, rnd() > 0.5 ? -0.045 : 0.028);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = cssShade(ENV.roadAsphalt, -0.07);
    ctx.lineWidth = 3;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  // 细裂缝
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = cssShade(ENV.roadAsphalt, -0.06);
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    let x = rnd() * 512, y = rnd() * 512;
    ctx.moveTo(x, y);
    const seg = 3 + Math.floor(rnd() * 4);
    for (let k = 0; k < seg; k++) {
      x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 颗粒噪点
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = 0.05 + rnd() * 0.06;
    ctx.fillStyle = rnd() > 0.5 ? cssShade(ENV.roadAsphalt, 0.06) : cssShade(ENV.roadAsphalt, -0.06);
    ctx.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
  ctx.globalAlpha = 1;
  _asphaltTex = canvasTexture(c);
  return _asphaltTex;
}

let _sidewalkTex: THREE.CanvasTexture | null = null;
/** 人行道砖:冷灰砖格 + 砖缝 ENV.sidewalkSeam + 逐砖明度抖动(1 tile ≈ 4m)。 */
export function sidewalkTexture(): THREE.CanvasTexture {
  if (_sidewalkTex) return _sidewalkTex;
  const rnd = seededRandom(20260702);
  const [c, ctx] = makeCanvas(512);
  ctx.fillStyle = ENV.sidewalk;
  ctx.fillRect(0, 0, 512, 512);
  const cell = 64; // 8×8 砖 → 0.5m 砖
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = cssShade(ENV.sidewalk, (rnd() * 2 - 1) * 0.028);
      ctx.fillRect(bx * cell + 2, by * cell + 2, cell - 4, cell - 4);
    }
  }
  // 砖缝
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ENV.sidewalkSeam;
  ctx.lineWidth = 3;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(512, i * cell); ctx.stroke();
  }
  // 湿渍
  for (let i = 0; i < 5; i++) {
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = cssShade(ENV.sidewalk, -0.045, 0.003);
    ctx.beginPath();
    ctx.ellipse(rnd() * 512, rnd() * 512, 40 + rnd() * 80, 28 + rnd() * 60, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  _sidewalkTex = canvasTexture(c);
  return _sidewalkTex;
}

let _crosswalkTex: THREE.CanvasTexture | null = null;
/** 斑马线:透明底白条(近白由 wallPale 提亮派生)+ 磨损缺角(1 tile = 4 个条纹周期)。 */
export function crosswalkTexture(): THREE.CanvasTexture {
  if (_crosswalkTex) return _crosswalkTex;
  const rnd = seededRandom(20260703);
  const [c, ctx] = makeCanvas(256);
  ctx.clearRect(0, 0, 256, 256);
  const stripe = cssShade(ENV.wallPale, 0.3, 0, -0.12);
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = stripe;
    ctx.fillRect(i * 64 + 6, 4, 34, 248);
  }
  // 磨损:destination-out 抠去边角与随机缺口
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.5 + rnd() * 0.5;
    const onEdge = rnd() > 0.4;
    const x = Math.floor(rnd() * 4) * 64 + 6 + (onEdge ? (rnd() > 0.5 ? -2 : 30) : rnd() * 30);
    const y = rnd() > 0.5 ? rnd() * 30 : 226 + rnd() * 30 - (rnd() * 220) * (rnd() > 0.7 ? 1 : 0);
    ctx.beginPath();
    ctx.ellipse(x + 4, Math.max(0, Math.min(256, y)), 3 + rnd() * 9, 2 + rnd() * 6, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  _crosswalkTex = canvasTexture(c);
  return _crosswalkTex;
}

let _crossingTex: THREE.CanvasTexture | null = null;
/** 中央路口贴花:外框虚线 + 对角线(§4.1「斑马线×4 中央菱形」),透明底磨损白线。 */
export function crossingTexture(): THREE.CanvasTexture {
  if (_crossingTex) return _crossingTex;
  const rnd = seededRandom(20260704);
  const [c, ctx] = makeCanvas(512);
  ctx.clearRect(0, 0, 512, 512);
  const line = cssShade(ENV.wallPale, 0.3, 0, -0.12);
  ctx.strokeStyle = line;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 10;
  ctx.setLineDash([34, 22]);
  ctx.strokeRect(26, 26, 460, 460);
  // 对角线菱形
  ctx.beginPath();
  ctx.moveTo(256, 40); ctx.lineTo(472, 256); ctx.lineTo(256, 472); ctx.lineTo(40, 256); ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  // 磨损
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = 0.4 + rnd() * 0.6;
    ctx.beginPath();
    ctx.ellipse(rnd() * 512, rnd() * 512, 4 + rnd() * 14, 3 + rnd() * 8, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  _crossingTex = canvasTexture(c, false);
  return _crossingTex;
}

// ═══ 路网构建(BuildQueue 分帧)═════════════════════════════════════════════

interface Rect { x: number; z: number; w: number; d: number }

/** 水平矩形面片(rotateX(-90)),uv 按世界尺寸缩放(贴图 tile 米数)。 */
function groundPlane(r: Rect, y: number, tileMeters: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(r.w, r.d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (r.w / tileMeters), uv.getY(i) * (r.d / tileMeters));
  }
  g.rotateX(-Math.PI / 2);
  g.translate(r.x, y, r.z);
  return g;
}

const ROAD_Y = 0.01;
const SIDEWALK_Y = 0.05;   // 视觉抬高(玩家 y=0 行走,只做薄抬避免陷脚)
const CURB_H = 0.06;

let streetsGroup: THREE.Group | null = null;

/** 把路网构建任务挂进队列(幂等:只构建一次,City 重入直接复用)。 */
export function enqueueStreets(queue: BuildQueue): THREE.Group {
  if (streetsGroup) return streetsGroup;
  const group = new THREE.Group();
  group.name = 'city-streets';
  streetsGroup = group;

  // 1) 沥青路面(路口四臂 + 中央区)→ 1 mesh
  queue.add('路面', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const r of ROADS) parts.push(groundPlane(r, ROAD_Y, 8));
    parts.push(groundPlane(CROSSING, ROAD_Y, 8));
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, toonMat(0xffffff, { map: asphaltTexture() }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }, 90);

  // 2) 人行道砖面 + 路缘石 → 2 mesh
  queue.add('人行道', () => {
    const parts: THREE.BufferGeometry[] = [];
    const curbs = new MergeBag();
    const curbColor = shade(ENV.sidewalk, -0.05);
    for (const s of SIDEWALKS) {
      parts.push(groundPlane(s, SIDEWALK_Y, 4));
      // 路缘石:四边薄框(0.24 宽),顶面略高于砖面
      const t = 0.24;
      curbs.box(s.x, CURB_H / 2, s.z - s.d / 2 + t / 2, s.w, CURB_H, t, curbColor);
      curbs.box(s.x, CURB_H / 2, s.z + s.d / 2 - t / 2, s.w, CURB_H, t, curbColor);
      curbs.box(s.x - s.w / 2 + t / 2, CURB_H / 2, s.z, t, CURB_H, s.d - 2 * t, curbColor);
      curbs.box(s.x + s.w / 2 - t / 2, CURB_H / 2, s.z, t, CURB_H, s.d - 2 * t, curbColor);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    if (merged) {
      const mesh = new THREE.Mesh(merged, toonMat(0xffffff, { map: sidewalkTexture() }));
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const curbGeo = curbs.build();
    if (curbGeo) {
      const curbMesh = new THREE.Mesh(curbGeo, vertexToonMat(4));
      curbMesh.receiveShadow = true;
      group.add(curbMesh);
    }
  }, 88);

  // 3) 斑马线贴花 + 中央路口贴花 → 2 mesh
  queue.add('斑马线', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const cw of CROSSWALKS) {
      // 条纹沿行走方向重复:贴图 1 tile = 4 周期 ≈ 4.2m
      const len = cw.dir === 'x' ? cw.w : cw.d;
      const wid = cw.dir === 'x' ? cw.d : cw.w;
      const g = new THREE.PlaneGeometry(len, wid);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / 4.2), uv.getY(i));
      g.rotateX(-Math.PI / 2);
      if (cw.dir === 'z') g.rotateY(Math.PI / 2);
      g.translate(cw.x, ROAD_Y + 0.015, cw.z);
      parts.push(g);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    if (merged) {
      const mat = toonMat(0xffffff, { map: crosswalkTexture(), transparent: true });
      mat.depthWrite = false;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      group.add(new THREE.Mesh(merged, mat));
    }
    const cg = groundPlane(CROSSING, ROAD_Y + 0.012, Math.max(CROSSING.w, CROSSING.d));
    const cmat = toonMat(0xffffff, { map: crossingTexture(), transparent: true });
    cmat.depthWrite = false;
    cmat.polygonOffset = true;
    cmat.polygonOffsetFactor = -1;
    group.add(new THREE.Mesh(cg, cmat));
  }, 86);

  // 4) 井盖 + 排水篦(props2 网格,按路段种子散布)→ 2 instanced mesh
  queue.add('街面细节', () => {
    const rnd = seededRandom(20260710);
    const manholes: InstanceItem[] = [];
    const drains: InstanceItem[] = [];
    for (const r of ROADS) {
      const horizontal = r.w >= r.d;
      const L = horizontal ? r.w : r.d;
      const T = horizontal ? r.d : r.w;
      const put = (along: number, cross: number): [number, number] =>
        horizontal ? [r.x + along, r.z + cross] : [r.x + cross, r.z + along];
      // 井盖:~26m 一个,靠近路中线,轻微散布
      const n = Math.max(1, Math.floor(L / 26));
      for (let i = 0; i < n; i++) {
        const along = -L / 2 + ((i + 0.5) / n) * L + (rnd() - 0.5) * 8;
        const [x, z] = put(along, (rnd() - 0.5) * T * 0.35);
        manholes.push({
          x, y: ROAD_Y + 0.012, z,
          ry: rnd() * Math.PI * 2, s: 0.92 + rnd() * 0.16,
          color: jitterColor(ENV.metal, rnd),
        });
      }
      // 排水篦:沿两侧路缘,~20m 一个
      const n2 = Math.max(1, Math.floor(L / 20));
      for (let i = 0; i < n2; i++) {
        const along = -L / 2 + ((i + 0.5) / n2) * L + (rnd() - 0.5) * 6;
        const side = (rnd() > 0.5 ? 1 : -1) * (T / 2 - 0.6);
        const [x, z] = put(along, side);
        drains.push({
          x, y: ROAD_Y + 0.01, z,
          ry: (horizontal ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.07,
          s: 0.92 + rnd() * 0.16,
          color: jitterColor(shade(ENV.metal, -0.03), rnd),
        });
      }
    }
    const mh = manholeResources();
    const dr = drainResources();
    group.add(makeInstanced(mh.geo, mh.mat, manholes));
    group.add(makeInstanced(dr.geo, dr.mat, drains));
  }, 84);

  return group;
}

/** 路网组件:挂载合并组(构建由 City 的 BuildQueue 分帧执行;组模块级缓存,重进秒开)。 */
export function Streets({ queue }: { queue: BuildQueue }) {
  const group = useMemo(() => enqueueStreets(queue), [queue]);
  return <primitive object={group} />;
}
