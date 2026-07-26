/**
 * 黄昏街区超自然异常(P4,总纲 §6)—— 全部低频、克制、纯视觉,零 gameplay 影响。
 *
 * 本文件实现六项中的四项:
 * - 黑色碎片(异常点 A,西南巷口):6-10 片缓慢上浮的黑片,速度不一致,常驻;
 * - 墨迹扩散(异常点 B,东南巷底):墙面墨渍 decal 缓慢生长又缩回,周期 45s;
 * - 逆重力纸张(站前广场):3-4 张传单向上飘,到 2m 处消散,~60s 一次;
 * - 灯闪 + 环境色污染(所有异常点半径内):环境光被 lerp 0.2 拉向蓝紫、
 *   一盏低亮度蓝紫点光低频闪烁(§3.5:概率性 8% 亮度抖动),离开即恢复。
 *
 * 环境色污染通过模块级 anomalyPollution(0..1)导出,由 SkySystem 在采样后
 * 对 hemisphere/雾色做 lerp —— 灯光系统本体不归本文件管。
 * 挂载:Scene.tsx 的户外分支 <CityAnomalies />(City.tsx 归 P3,不动)。
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ANOMALY_POINTS, STATION, seededRandom } from '@nexuspark/shared';
import { ENV, ACCENT } from './palette';
import { hot } from '../../state/hot';

/** 环境色污染强度 0..1(玩家离最近异常点的归一化接近度,已阻尼)。SkySystem 读取。 */
export const anomalyPollution = { current: 0 };

const PT_A = ANOMALY_POINTS.find((p) => p.id === 'a-alley-mouth') ?? ANOMALY_POINTS[0];
const PT_B = ANOMALY_POINTS.find((p) => p.id === 'b-alley-end') ?? ANOMALY_POINTS[0];

/* ── §6 黑色碎片(异常点 A):缓慢上浮、不发光、速度不一致 ─────────────── */

const SHARD_COUNT = 8;
const SHARD_RISE_H = 3.4;

function BlackShards() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const shards = useMemo(() => {
    const rnd = seededRandom(66001);
    return Array.from({ length: SHARD_COUNT }, () => ({
      x: PT_A.x + (rnd() - 0.5) * PT_A.r * 1.4,
      z: PT_A.z + (rnd() - 0.5) * PT_A.r * 1.4,
      speed: 0.12 + rnd() * 0.2,          // 速度刻意不一致(§6)
      phase: rnd(),
      spin: (rnd() - 0.5) * 0.8,
      size: 0.7 + rnd() * 0.6,
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const s = shards[i];
      const f = ((t * s.speed) / SHARD_RISE_H + s.phase) % 1;
      // 顶端 20% 行程缩小消散,底部 10% 淡入
      const shrink = 1 - THREE.MathUtils.smoothstep(f, 0.8, 1);
      const grow = THREE.MathUtils.smoothstep(f, 0, 0.1);
      dummy.position.set(
        s.x + Math.sin(t * 0.3 + s.phase * 7) * 0.12,
        0.15 + f * SHARD_RISE_H,
        s.z + Math.cos(t * 0.26 + s.phase * 5) * 0.12
      );
      dummy.rotation.set(t * s.spin, s.phase * 6.28 + t * s.spin * 0.6, 0);
      const k = Math.max(0.001, s.size * shrink * grow);
      dummy.scale.set(k, k, k);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SHARD_COUNT]} frustumCulled={false}>
      <boxGeometry args={[0.16, 0.24, 0.02]} />
      {/* 不发光的深蓝黑(描边色),暗部里只剩剪影感 */}
      <meshBasicMaterial color={ENV.outline} />
    </instancedMesh>
  );
}

/* ── §6 墨迹扩散(异常点 B):墙面墨渍生长又缩回,周期 45s ─────────────── */

const INK_PERIOD = 45;

let inkTexCache: THREE.CanvasTexture | null = null;
/** 程序化墨渍贴图(零外部资产):不规则重叠圆斑 + 淌下的细流。 */
function inkTexture(): THREE.CanvasTexture {
  if (inkTexCache) return inkTexCache;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const rnd = seededRandom(66002);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#12141f';
  // 主体:围绕中心的不规则斑块
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * rnd() * 78;
    const r = 12 + rnd() * 30;
    ctx.globalAlpha = 0.5 + rnd() * 0.5;
    ctx.beginPath();
    ctx.arc(128 + Math.cos(a) * d, 118 + Math.sin(a) * d * 0.8, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 向下淌的细流
  for (let i = 0; i < 5; i++) {
    const x = 70 + rnd() * 116;
    const w = 2.5 + rnd() * 3.5;
    const len = 40 + rnd() * 70;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(x, 130 + rnd() * 20, w, len);
    ctx.beginPath();
    ctx.arc(x + w / 2, 130 + rnd() * 20 + len, w * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  inkTexCache = new THREE.CanvasTexture(c);
  return inkTexCache;
}

function InkGrowth() {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    const f = (state.clock.elapsedTime % INK_PERIOD) / INK_PERIOD;
    // 生长(0→0.35)→ 停留 → 缩回(0.62→1);永远留一点残渍
    const g = THREE.MathUtils.smoothstep(f, 0, 0.35) * (1 - THREE.MathUtils.smoothstep(f, 0.62, 1));
    if (mesh.current) {
      const s = 0.55 + 1.05 * g;
      mesh.current.scale.set(s, s, 1);
    }
    if (mat.current) mat.current.opacity = 0.42 + 0.4 * g;
  });
  // 巷底 B 点东侧围合楼(x=44 的西墙)上贴 decal;稍离墙防 z-fight
  return (
    <mesh ref={mesh} position={[43.92, 1.35, PT_B.z]} rotation={[0, -Math.PI / 2, 0]}>
      <planeGeometry args={[2.4, 2.4]} />
      <meshBasicMaterial ref={mat} map={inkTexture()} transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
}

/* ── §6 逆重力纸张(站前广场):3-4 张传单向上飘,到 2m 消散,~60s 一次 ── */

const FLYER_PERIOD = 60;
const FLYER_ACTIVE = 6;   // 每轮动画时长(秒)
const FLYER_TOP = 2;      // 消散高度(米)

function AntigravityFlyers() {
  const flyers = useMemo(() => {
    const rnd = seededRandom(66003);
    // 站前广场(出生点旁,地铁口 STATION 附近)散布 4 张
    return Array.from({ length: 4 }, (_, i) => ({
      x: STATION.x - 6 + rnd() * 6,
      z: STATION.z - 7 + rnd() * 5,
      delay: i * 3.1 + rnd() * 1.5,   // 同轮内错峰起飞
      wobble: 0.6 + rnd() * 0.8,
      ry: rnd() * Math.PI * 2,
    }));
  }, []);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    flyers.forEach((fl, i) => {
      const m = refs.current[i];
      if (!m) return;
      const local = (t - fl.delay + FLYER_PERIOD) % FLYER_PERIOD;
      const active = local >= 0 && local < FLYER_ACTIVE;
      m.visible = active;
      if (!active) return;
      const f = local / FLYER_ACTIVE;
      m.position.set(
        fl.x + Math.sin(t * fl.wobble + i) * 0.35,
        0.05 + f * FLYER_TOP,
        fl.z + Math.cos(t * fl.wobble * 0.8 + i * 2) * 0.35
      );
      m.rotation.set(Math.sin(t * 2.1 + i) * 0.5, fl.ry + t * 0.4, Math.cos(t * 1.7 + i) * 0.4);
      const mat = m.material as THREE.MeshBasicMaterial;
      // 淡入 8%,顶端 30% 淡出消散
      mat.opacity = THREE.MathUtils.smoothstep(f, 0, 0.08) * (1 - THREE.MathUtils.smoothstep(f, 0.7, 1)) * 0.85;
    });
  });
  return (
    <group>
      {flyers.map((_, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} visible={false}>
          <planeGeometry args={[0.26, 0.36]} />
          {/* 旧海报纸的淡灰紫(§2.1 旧墙淡色),双面、不发光 */}
          <meshBasicMaterial color={ENV.wallPale} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ── §3.5/§6 灯闪 + 环境色污染:异常点半径内环境被拉向蓝紫,点光低频抖 ── */

function PollutionLight() {
  const light = useRef<THREE.PointLight>(null);
  const cur = useRef(0);
  const flickLeft = useRef(0);
  useFrame((_, dt) => {
    // 最近异常点的归一化接近度(半径外 = 0)
    let f = 0;
    let nearest = PT_A;
    for (const p of ANOMALY_POINTS) {
      const k = 1 - Math.hypot(hot.local.x - p.x, hot.local.z - p.z) / p.r;
      if (k > f) { f = k; nearest = p; }
    }
    f = THREE.MathUtils.clamp(f, 0, 1);
    // 阻尼趋近:进入渐染、离开即恢复(§3.5)
    cur.current += (f - cur.current) * Math.min(1, dt * 3);
    if (cur.current < 0.005) cur.current = 0;
    anomalyPollution.current = cur.current;

    const l = light.current;
    if (!l) return;
    // 低频闪烁:概率性进入 ~0.12s 的 8% 亮度下抖(§3.5)
    if (flickLeft.current > 0) flickLeft.current -= dt;
    else if (cur.current > 0 && Math.random() < dt * 0.6) flickLeft.current = 0.12;
    const flick = flickLeft.current > 0 ? 0.92 : 1;
    l.position.set(nearest.x, 2.4, nearest.z);
    l.distance = nearest.r * 2.2;
    l.intensity = 1.1 * cur.current * flick;
    l.visible = cur.current > 0;
  });
  return <pointLight ref={light} color={ACCENT.anomalyViolet} intensity={0} decay={2} visible={false} />;
}

/** 户外异常总装(由 Scene.tsx 的户外分支挂载)。 */
export function CityAnomalies() {
  return (
    <group>
      <BlackShards />
      <InkGrowth />
      <AntigravityFlyers />
      <PollutionLight />
    </group>
  );
}
