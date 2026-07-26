/**
 * 「黄昏街区」近景遮挡层(工单 P3-4,总纲 §4.2 前景)。
 *
 * 相机常穿过的前景物,全部从 cityplan 数据推导摆放(不自造坐标系):
 * - 沿人行道路缘的防护栏段(成组出现、留缺口,禁止等距满铺);
 * - 电线杆 + 沿街/横跨街道的电缆束(CatmullRom 弧垂,静态合并);
 * - 悬挂店招(shopfront 立面伸出的小灯箱,4 款 canvas 变体合并渲染)。
 * 规则(§4.2):玩家 3m 内常有一件前景遮挡物可入画;Low 档密度减半(§10)。
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom } from '@nexuspark/shared';
import { ROADS, SIDEWALKS, BUILDINGS } from '@nexuspark/shared/src/cityplan';
import { ENV, ACCENT } from './palette';
import { toonMat } from './toon';
import { autoDetectTier, TIER_BUDGET } from './quality';
import type { BuildQueue } from './progressive';
import {
  MergeBag, unitCylinder, vertexToonMat, makeInstanced, makeCanvas,
  canvasTexture, shade, cssShade, jitterColor,
} from './streets';
import type { InstanceItem } from './streets';

// ── 护栏单元(1.8m:两立柱 + 双横杆 + 下折弯),实例化 ────────────────────────
let _railGeo: THREE.BufferGeometry | null = null;
function railGeo(): THREE.BufferGeometry {
  if (_railGeo) return _railGeo;
  const bag = new MergeBag();
  const m = ENV.metal;
  for (const sx of [-0.85, 0.85]) {
    bag.add(unitCylinder(), { x: sx, y: 0.42, z: 0, sx: 0.07, sy: 0.84, sz: 0.07, color: m });
  }
  bag.box(0, 0.8, 0, 1.8, 0.06, 0.06, shade(m, 0.025));
  bag.box(0, 0.45, 0, 1.8, 0.05, 0.05, shade(m, 0.01));
  // 下沿折弯板(常见日式白钢护栏的横带)
  bag.box(0, 0.18, 0, 1.7, 0.16, 0.03, shade(m, -0.03));
  _railGeo = bag.build() ?? new THREE.BufferGeometry();
  return _railGeo;
}

/** 人行道最靠近哪条路 → 护栏挂在那条边上;返回边中线与走向。 */
function guardEdge(s: { x: number; z: number; w: number; d: number }): { alongX: boolean; ex: number; ez: number } | null {
  let best = Infinity;
  let dirX = 0, dirZ = 0;
  for (const r of ROADS) {
    const cx = Math.max(r.x - r.w / 2, Math.min(s.x, r.x + r.w / 2));
    const cz = Math.max(r.z - r.d / 2, Math.min(s.z, r.z + r.d / 2));
    const dd = (cx - s.x) ** 2 + (cz - s.z) ** 2;
    if (dd < best) { best = dd; dirX = cx - s.x; dirZ = cz - s.z; }
  }
  if (dirX === 0 && dirZ === 0) return null;
  if (Math.abs(dirX) > Math.abs(dirZ)) {
    return { alongX: false, ex: s.x + Math.sign(dirX) * (s.w / 2 - 0.18), ez: s.z };
  }
  return { alongX: true, ex: s.x, ez: s.z + Math.sign(dirZ) * (s.d / 2 - 0.18) };
}

// ── 悬挂店招贴图(4 款通用小灯箱,不构成完整店名)────────────────────────────
const HANG_SIGNS: { text: string; color: string }[] = [
  { text: '呑', color: ACCENT.mahjongLantern },
  { text: '歌', color: ACCENT.cinemaSign },
  { text: '薬', color: ACCENT.konbiniSign },
  { text: '麺', color: ACCENT.netcafeSign },
];

function hangSignTexture(i: number): THREE.CanvasTexture {
  const v = HANG_SIGNS[i % HANG_SIGNS.length];
  const [c, ctx] = makeCanvas(128);
  ctx.fillStyle = cssShade(ENV.outline, 0.02);
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = cssShade(v.color, -0.06);
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, 116, 116);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 76px "Noto Sans SC", serif';
  ctx.shadowColor = v.color;
  ctx.fillStyle = cssShade(v.color, 0.1);
  ctx.shadowBlur = 18;
  ctx.fillText(v.text, 64, 68);
  ctx.shadowBlur = 5;
  ctx.fillText(v.text, 64, 68);
  return canvasTexture(c, false);
}

let foregroundGroup: THREE.Group | null = null;

export function enqueueForeground(queue: BuildQueue): THREE.Group {
  if (foregroundGroup) return foregroundGroup;
  const group = new THREE.Group();
  group.name = 'city-foreground';
  foregroundGroup = group;
  const density = TIER_BUDGET[autoDetectTier()].propDensity; // Low 档前景减半(§10)

  // 1) 护栏段:沿人行道靠路一侧,成组 + 缺口
  queue.add('前景·护栏', () => {
    const rnd = seededRandom(950_001);
    const items: InstanceItem[] = [];
    for (const s of SIDEWALKS) {
      const edge = guardEdge(s);
      if (!edge) continue;
      const L = edge.alongX ? s.w : s.d;
      if (L < 8) continue;
      let along = -L / 2 + 2 + rnd() * 4;
      while (along < L / 2 - 2) {
        const run = 3 + Math.floor(rnd() * 3); // 3-5 连
        for (let k = 0; k < run && along < L / 2 - 2; k++) {
          if (rnd() < density) {
            items.push({
              x: edge.ex + (edge.alongX ? along : 0),
              y: 0.05,
              z: edge.ez + (edge.alongX ? 0 : along),
              ry: (edge.alongX ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.06,
              s: 1 + (rnd() - 0.5) * 0.05,
              color: jitterColor(ENV.metal, rnd),
            });
          }
          along += 1.82;
        }
        along += 4 + rnd() * 7; // 缺口(禁止等距满铺,§4.3)
      }
    }
    group.add(makeInstanced(railGeo(), vertexToonMat(4), items));
  }, 22);

  // 2) 电线杆 + 电缆束(两条最长主街)
  queue.add('前景·电线', () => {
    const rnd = seededRandom(950_002);
    const roads = [...ROADS].sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d)).slice(0, 2);
    const poleItems: InstanceItem[] = [];
    const cableParts: THREE.BufferGeometry[] = [];
    const addCable = (a: THREE.Vector3, b: THREE.Vector3, sag: number): void => {
      const mid = a.clone().lerp(b, 0.5); mid.y -= sag;
      const q1 = a.clone().lerp(b, 0.25); q1.y -= sag * 0.7;
      const q3 = a.clone().lerp(b, 0.75); q3.y -= sag * 0.7;
      const curve = new THREE.CatmullRomCurve3([a, q1, mid, q3, b]);
      cableParts.push(new THREE.TubeGeometry(curve, 16, 0.02, 4, false));
    };
    for (const r of roads) {
      const alongX = r.w >= r.d;
      const L = alongX ? r.w : r.d;
      const T = alongX ? r.d : r.w;
      const n = Math.max(2, Math.floor(L / 26));
      const prev: Record<string, THREE.Vector3 | null> = { '-1': null, '1': null };
      for (let i = 0; i <= n; i++) {
        const along = -L / 2 + (i / n) * (L - 2) + 1 + (rnd() - 0.5) * 3;
        for (const side of [-1, 1]) {
          if (i % 2 !== (side === 1 ? 0 : 1)) continue; // 两侧交错
          const cross = side * (T / 2 + 1.1);
          const px = r.x + (alongX ? along : cross);
          const pz = r.z + (alongX ? cross : along);
          if (rnd() > density) continue;
          poleItems.push({
            x: px, y: 0, z: pz,
            ry: rnd() * Math.PI * 2, s: 1 + (rnd() - 0.5) * 0.06,
            color: jitterColor(shade(ENV.metal, -0.015), rnd),
          });
          const top = new THREE.Vector3(px, 7.0, pz);
          const p = prev[String(side)];
          if (p) { addCable(p, top, 1.0 + rnd() * 0.5); addCable(p.clone().add(new THREE.Vector3(0, -0.3, 0)), top.clone().add(new THREE.Vector3(0, -0.3, 0)), 1.2 + rnd() * 0.5); }
          prev[String(side)] = top;
          // 横跨街道的电缆(§4.3):约 1/3 的杆位拉一束过街线到对侧
          if (rnd() < 0.35) {
            const across = new THREE.Vector3(
              alongX ? px + (rnd() - 0.5) * 4 : r.x - side * (T / 2 + 1.1),
              6.6,
              alongX ? r.z - side * (T / 2 + 1.1) : pz + (rnd() - 0.5) * 4
            );
            addCable(top, across, 1.4 + rnd() * 0.6);
          }
        }
      }
    }
    // 电线杆单元:杆 + 双横担 + 绝缘子
    const poleBag = new MergeBag();
    poleBag.add(unitCylinder(), { x: 0, y: 3.75, z: 0, sx: 0.24, sy: 7.5, sz: 0.24, color: shade(ENV.metal, -0.01) });
    poleBag.box(0, 6.9, 0, 1.9, 0.1, 0.1, shade(ENV.metal, -0.03));
    poleBag.box(0, 6.35, 0, 1.4, 0.09, 0.09, shade(ENV.metal, -0.03));
    for (const ix of [-0.7, 0, 0.7]) poleBag.box(ix, 7.02, 0, 0.08, 0.14, 0.08, shade(ENV.wallPale, -0.06));
    const poleGeo = poleBag.build() ?? new THREE.BufferGeometry();
    group.add(makeInstanced(poleGeo, vertexToonMat(4), poleItems));
    const cableGeo = cableParts.length > 0 ? mergeGeometries(cableParts) : null;
    cableParts.forEach((p) => p.dispose());
    if (cableGeo) {
      const mesh = new THREE.Mesh(cableGeo, toonMat(shade(ENV.outline, 0.03)));
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }, 21);

  // 3) 悬挂店招:shopfront 立面垂直伸出的小灯箱(4 款变体各合并 1 mesh)
  queue.add('前景·店招', () => {
    const rnd = seededRandom(950_003);
    const variantBags = HANG_SIGNS.map(() => new MergeBag());
    const brackets = new MergeBag();
    for (const b of BUILDINGS) {
      if (b.style !== 'shopfront') continue;
      if (rnd() > 0.45 * density) continue;
      // 立面朝向:has ry 用 ry,否则粗略面向最近的路(与 buildings 相同推导,不精确无妨——纯视觉)
      const ry = b.ry ?? 0;
      const c = Math.cos(ry), s = Math.sin(ry);
      const lx = (rnd() - 0.5) * b.w * 0.7;
      const ly = 3.0 + rnd() * 1.6;
      const lz = b.d / 2 + 0.5;
      const x = b.x + lx * c + lz * s;
      const z = b.z - lx * s + lz * c;
      const vi = Math.floor(rnd() * HANG_SIGNS.length);
      // 灯箱垂直于立面(可读向街道两个方向)
      variantBags[vi].box(x, ly, z, 0.1, 0.62, 0.62, jitterColor(shade(ENV.wallPale, 0.02), rnd), ry);
      brackets.box(x, ly + 0.42, z - 0.28 * c, 0.06, 0.06, 0.6, ENV.metal, ry);
    }
    variantBags.forEach((bag, i) => {
      const geo = bag.build();
      if (!geo) return;
      const tex = hangSignTexture(i);
      const m = toonMat(0xffffff, { map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.6, fog: false });
      m.vertexColors = true;
      group.add(new THREE.Mesh(geo, m));
    });
    const brGeo = brackets.build();
    if (brGeo) group.add(new THREE.Mesh(brGeo, vertexToonMat(4)));
  }, 20);

  return group;
}

export function Foreground({ queue }: { queue: BuildQueue }) {
  const group = useMemo(() => enqueueForeground(queue), [queue]);
  return <primitive object={group} />;
}
