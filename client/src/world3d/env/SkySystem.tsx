/** Sky dome + sun/moon lights + stars + drifting anime cumulus clouds + fog,
 *  driven by the server world clock and weather. */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useWorld, useSettings } from '../../state/stores';
import { sampleEnv, currentTod } from './daynight';
import { hot } from '../../state/hot';
import { audio } from '../../audio/engine';
import { anomalyPollution } from '../city/anomalies';
import { ENV, ACCENT } from '../city/palette';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to far plane
}
`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunAmount;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 sky = mix(horizonColor, topColor, pow(h, 0.62));
  float sunDot = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
  vec3 halo = sunColor * pow(sunDot, 90.0) * sunAmount * 0.85;
  vec3 disc = sunColor * smoothstep(0.9993, 0.9997, sunDot) * sunAmount * 3.0;
  gl_FragColor = vec4(sky + halo + disc, 1.0);
}
`;

function Stars({ opacityRef }: { opacityRef: React.MutableRefObject<number> }) {
  const matRef = useRef<THREE.PointsMaterial>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.95);
      const r = 430;
      pos[i * 3] = Math.sin(v) * Math.cos(u) * r;
      pos[i * 3 + 1] = Math.cos(v) * r * 0.9 + 20;
      pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * r;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame(() => {
    if (matRef.current) {
      matRef.current.opacity = opacityRef.current;
      matRef.current.visible = opacityRef.current > 0.02;
    }
  });
  return (
    // renderOrder -95: 在云(-90)之前画,云会正确地叠在星星上面
    <points geometry={geom} frustumCulled={false} renderOrder={-95}>
      <pointsMaterial ref={matRef} color="#dfe8ff" size={1.4} sizeAttenuation={false} transparent depthWrite={false} />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/* 日漫积云 — anime cumulus clouds                                     */
/* ------------------------------------------------------------------ */

/** 固定种子 LCG(与 textures.ts 同一惯例)— 云形/分布逐次运行一致。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 单朵动漫积云:多个重叠扁圆拼成蓬松轮廓,底部一刀切平(日漫标志性平底),
 *  内部用「阴影剪影 → 上移白色主体」的赛璐璐手法留出扇贝形浅紫底影。 */
function drawAnimeCloud(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number, w: number, h: number,
  rnd: () => number,
  cfg: { nB: number; nT: number; wf: number; hf: number }
): void {
  const yb = oy + h * 0.8; // 平底基线
  const left = ox + w * (1 - cfg.wf) * 0.5;
  const span = w * cfg.wf;
  const clampX = (x: number, r: number) => Math.min(Math.max(x, ox + r + 4), ox + w - r - 4);
  const puffs: { x: number; y: number; r: number }[] = [];
  // 底排大圆(中间最大,两端渐小)
  for (let i = 0; i < cfg.nB; i++) {
    const t = cfg.nB === 1 ? 0.5 : i / (cfg.nB - 1);
    const mid = 1 - Math.abs(t - 0.5) * 2;
    const r = h * (0.13 + 0.1 * mid) * cfg.hf * (0.9 + rnd() * 0.2);
    const x = clampX(left + span * (0.07 + 0.86 * t) + (rnd() - 0.5) * span * 0.04, r);
    puffs.push({ x, y: yb - r * 0.5, r });
  }
  // 顶排小圆(堆出蓬松的上缘)
  for (let i = 0; i < cfg.nT; i++) {
    const t = (i + 0.5) / cfg.nT;
    const mid = 1 - Math.abs(t - 0.5) * 2;
    const r = h * (0.11 + 0.1 * mid) * cfg.hf * (0.88 + rnd() * 0.24);
    const x = clampX(left + span * (0.16 + 0.68 * t) + (rnd() - 0.5) * span * 0.05, r);
    puffs.push({ x, y: yb - h * (0.26 + 0.17 * mid) * cfg.hf, r });
  }
  const fillPuffs = (dy: number, rs: number) => {
    ctx.beginPath();
    for (const p of puffs) {
      ctx.moveTo(p.x + p.r * rs, p.y - dy);
      ctx.arc(p.x, p.y - dy, p.r * rs, 0, Math.PI * 2);
    }
    ctx.fill();
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, w, h);
  ctx.clip();
  // 1) 白色剪影(实心填充 → 边缘干净,不喷雾化)
  ctx.fillStyle = '#ffffff';
  fillPuffs(0, 1);
  // 2) 一刀切出平底
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(ox, yb, w, oy + h - yb);
  // 3) 整体铺极浅暖灰紫阴影,再把主体上移重画白色 → 底部留下扇贝形三阶色块
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = '#d6cfe2';
  ctx.fillRect(ox, oy, w, h);
  const lift = h * 0.09;
  ctx.fillStyle = '#edeaf4';
  fillPuffs(lift * 0.5, 0.97);
  ctx.fillStyle = '#ffffff';
  fillPuffs(lift, 0.93);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/** 4 个云形变体打进一张 2×2 图集(1024×512,每格 512×256)→ 只占 1 个纹理单元。 */
const CLOUD_VARIANTS = [
  { nB: 5, nT: 3, wf: 0.92, hf: 1.0 },  // 高耸大积云
  { nB: 6, nT: 4, wf: 0.96, hf: 0.85 }, // 宽长层积云
  { nB: 4, nT: 2, wf: 0.8, hf: 0.95 },  // 中型云
  { nB: 3, nT: 1, wf: 0.55, hf: 0.7 },  // 小朵浮云(高空用)
];

let cloudAtlasCache: THREE.CanvasTexture | null = null;
function cloudAtlas(): THREE.CanvasTexture {
  if (cloudAtlasCache) return cloudAtlasCache;
  const CW = 512, CH = 256;
  const c = document.createElement('canvas');
  c.width = CW * 2;
  c.height = CH * 2;
  const ctx = c.getContext('2d')!;
  const rnd = lcg(20260726);
  CLOUD_VARIANTS.forEach((cfg, v) => {
    drawAnimeCloud(ctx, (v % 2) * CW, Math.floor(v / 2) * CH, CW, CH, rnd, cfg);
  });
  cloudAtlasCache = new THREE.CanvasTexture(c);
  cloudAtlasCache.anisotropy = 2;
  return cloudAtlasCache;
}

const CLOUD_VERT = /* glsl */ `
attribute vec2 aCell;   // 图集格子 (col, rowFromBottom)
attribute vec4 aMisc;   // x: 云量阈值  y: 相位  z: 环绕速度  w: 明暗层次
uniform float uTime;
uniform float uCover;
uniform float uGrow;
varying vec2 vUv;
varying float vFade;
varying float vShade;
void main() {
  vUv = (uv + aCell) * 0.5;
  vFade = smoothstep(aMisc.x, aMisc.x + 0.18, uCover);
  vShade = aMisc.w;
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float ang = uTime * aMisc.z;           // 绕世界 Y 轴缓慢漂移
  float ca = cos(ang);
  float sa = sin(ang);
  center.xz = mat2(ca, -sa, sa, ca) * center.xz;
  center.y += sin(uTime * 0.12 + aMisc.y * 6.2832) * 1.8; // 极轻微浮动
  float sx = length(instanceMatrix[0].xyz) * uGrow;
  float sy = length(instanceMatrix[1].xyz) * uGrow;
  vec4 mv = viewMatrix * vec4(center.xyz, 1.0);
  mv.xy += position.xy * vec2(sx, sy);   // 视平面 billboard
  gl_Position = projectionMatrix * mv;
}
`;
const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uOpacity;
varying vec2 vUv;
varying float vFade;
varying float vShade;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vFade * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(tex.rgb * uTint * vShade, a);
}
`;

type CloudLayer = {
  mesh: THREE.InstancedMesh;
  uniforms: {
    uMap: { value: THREE.Texture };
    uTint: { value: THREE.Color };
    uCover: { value: number };
    uGrow: { value: number };
    uTime: { value: number };
    uOpacity: { value: number };
  };
};

/** 全部云 = 一个 InstancedMesh(1 个 draw call)。模块级缓存,画质开关反复切换不重建。 */
let cloudLayerCache: CloudLayer | null = null;
function buildCloudLayer(): CloudLayer {
  if (cloudLayerCache) return cloudLayerCache;
  const rnd = lcg(7261024);
  type Inst = {
    x: number; y: number; z: number; s: number;
    cell: number; threshold: number; phase: number; speed: number; shade: number;
  };
  const insts: Inst[] = [];

  // 低仰角一圈大朵积云(日漫构图:大云贴着地平线),每朵配 1~2 张次级面片增加体积感
  const NBIG = 9;
  for (let i = 0; i < NBIG; i++) {
    const a = (i / NBIG) * Math.PI * 2 + (rnd() - 0.5) * 0.55;
    const r = 315 + rnd() * 85;
    const y = 36 + rnd() * 34;
    const s = 95 + rnd() * 80;
    const speed = 0.0022 + rnd() * 0.0034;
    insts.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, s, cell: i % 3, threshold: 0, phase: rnd(), speed, shade: 1 });
    const nComp = 1 + (rnd() > 0.45 ? 1 : 0);
    for (let cIdx = 0; cIdx < nComp; cIdx++) {
      const da = (rnd() - 0.5) * 0.2;
      const rr = r + (rnd() - 0.5) * 46;
      insts.push({
        x: Math.cos(a + da) * rr,
        y: y + 8 + rnd() * 18,
        z: Math.sin(a + da) * rr,
        s: s * (0.38 + rnd() * 0.28),
        cell: Math.floor(rnd() * 4),
        threshold: 0,
        phase: rnd(),
        speed, // 同簇同速,保持成团
        shade: 0.94,
      });
    }
  }
  // 高空少量小云
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 170 + rnd() * 150;
    insts.push({
      x: Math.cos(a) * r, y: 135 + rnd() * 55, z: Math.sin(a) * r,
      s: 26 + rnd() * 22, cell: 3, threshold: 0, phase: rnd(),
      speed: 0.003 + rnd() * 0.003, shade: 1,
    });
  }
  // 阴天/雨天才逐渐浮现的补充云(threshold 越高越晚出现)
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 265 + rnd() * 115;
    insts.push({
      x: Math.cos(a) * r, y: 55 + rnd() * 75, z: Math.sin(a) * r,
      s: 75 + rnd() * 70, cell: i % 3, threshold: 0.45 + rnd() * 0.4,
      phase: rnd(), speed: 0.002 + rnd() * 0.003, shade: 0.97,
    });
  }

  const n = insts.length;
  const geo = new THREE.PlaneGeometry(1, 1);
  const cellArr = new Float32Array(n * 2);
  const miscArr = new Float32Array(n * 4);
  insts.forEach((c, i) => {
    cellArr[i * 2] = c.cell % 2;
    cellArr[i * 2 + 1] = c.cell < 2 ? 1 : 0; // flipY: canvas 上排 → uv 上半
    miscArr[i * 4] = c.threshold;
    miscArr[i * 4 + 1] = c.phase;
    miscArr[i * 4 + 2] = c.speed;
    miscArr[i * 4 + 3] = c.shade;
  });
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cellArr, 2));
  geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(miscArr, 4));

  const uniforms = {
    uMap: { value: cloudAtlas() as THREE.Texture },
    uTint: { value: new THREE.Color('#ffffff') },
    uCover: { value: 0.4 },
    uGrow: { value: 1.08 },
    uTime: { value: 0 },
    uOpacity: { value: 0.93 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const dummy = new THREE.Object3D();
  insts.forEach((c, i) => {
    dummy.position.set(c.x, c.y, c.z);
    dummy.scale.set(c.s, c.s * 0.5, 1); // 与图集格子 2:1 等比
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = -90; // 穹顶(-100)→ 星星(-95)→ 云(-90)→ 场景
  mesh.raycast = () => undefined; // 纯视觉,不参与拾取
  cloudLayerCache = { mesh, uniforms };
  return cloudLayerCache;
}

function Clouds({ tintRef, coverRef }: {
  tintRef: React.MutableRefObject<THREE.Color>;
  coverRef: React.MutableRefObject<number>;
}) {
  const layer = useMemo(buildCloudLayer, []);
  useFrame((state, dt) => {
    const u = layer.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    // 天气/昼夜切换时向目标平滑过渡(指数阻尼,~1.4s)
    const k = 1 - Math.exp(-dt * 0.7);
    u.uCover.value += (coverRef.current - u.uCover.value) * k;
    u.uTint.value.lerp(tintRef.current, k);
    u.uGrow.value = 0.9 + u.uCover.value * 0.45;   // 云量大 → 云更大
    u.uOpacity.value = 0.88 + u.uCover.value * 0.12;
  });
  return <primitive object={layer.mesh} />;
}

function Rain({ activeRef }: { activeRef: React.MutableRefObject<boolean> }) {
  const count = 900;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const drops = useMemo(() => {
    const arr: { x: number; y: number; z: number; v: number }[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({ x: (Math.random() - 0.5) * 55, y: Math.random() * 26, z: (Math.random() - 0.5) * 55, v: 17 + Math.random() * 7 });
    }
    return arr;
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    m.visible = activeRef.current;
    if (!m.visible) return;
    const cx = hot.local.x, cz = hot.local.z;
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      d.y -= d.v * dt;
      if (d.y < 0) {
        d.y = 20 + Math.random() * 8;
        d.x = (Math.random() - 0.5) * 55;
        d.z = (Math.random() - 0.5) * 55;
      }
      dummy.position.set(cx + d.x, d.y, cz + d.z);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[0.015, 0.55, 0.015]} />
      <meshBasicMaterial color="#9fb8d8" transparent opacity={0.5} depthWrite={false} />
    </instancedMesh>
  );
}

// 阴天云偏灰、雨天云偏暗灰紫(在 daynight 给的 cloudTint 基础上再压)
const CLOUD_TINT_CLOUDY = new THREE.Color('#b9b6c4');
const CLOUD_TINT_RAIN = new THREE.Color('#77718f');
// 超自然色污染目标(§3.5:异常点半径内环境光被 lerp 0.2 拉向蓝紫)
const POLLUTION_TINT = new THREE.Color(ACCENT.anomalyViolet);
// 室内 hemisphere 与户外昼夜标定解耦(P4 只重标户外;室内有自己的灯,§3)
const INDOOR_HEMI_SKY = new THREE.Color('#9aa0b4');
const INDOOR_HEMI_GROUND = new THREE.Color('#54504c');
const INDOOR_HEMI_INTENSITY = 0.45;

export default function SkySystem({ indoor }: { indoor: boolean }) {
  const env = useWorld((s) => s.env);
  const settings = useSettings();
  const { scene } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const skyMat = useRef<THREE.ShaderMaterial>(null);
  const starOpacity = useRef(0);
  const cloudTint = useRef(new THREE.Color('#ffffff'));
  const cloudCover = useRef(0.5);
  const rainActive = useRef(false);
  // 分层雾(§2.1 近 #3d4257 → 远 #585d73):颜色按昼夜由 daynight 插值,
  // 这里给基础距离;近端压近一点,黄昏街区靠雾吃掉背景剪影层次。
  const fog = useMemo(() => new THREE.Fog(ENV.fogNear, 48, 235), []);

  const uniforms = useMemo(() => ({
    topColor: { value: new THREE.Color('#3d7edb') },
    horizonColor: { value: new THREE.Color('#c3ddf2') },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color('#fff4e0') },
    sunAmount: { value: 1 },
  }), []);

  useFrame(() => {
    const tod = currentTod(env);
    const s = sampleEnv(tod, env.weather);

    uniforms.topColor.value.copy(s.skyTop);
    uniforms.horizonColor.value.copy(s.skyHorizon);
    uniforms.sunDir.value.copy(s.sunDir);
    uniforms.sunColor.value.copy(s.sunColor);
    uniforms.sunAmount.value = Math.min(1, s.sunIntensity * 0.6 + 0.12);

    if (sunRef.current) {
      const sun = sunRef.current;
      sun.color.copy(s.sunColor);
      sun.intensity = indoor ? 0 : s.sunIntensity;
      sun.position.set(
        hot.local.x + s.sunDir.x * 90,
        Math.max(6, s.sunDir.y * 110),
        hot.local.z + s.sunDir.z * 90
      );
      sun.target.position.set(hot.local.x, 0, hot.local.z);
      sun.target.updateMatrixWorld();
      sun.castShadow = settings.shadows && !indoor && s.sunIntensity > 0.05;
    }
    if (moonRef.current) {
      moonRef.current.intensity = indoor ? 0 : s.moonIntensity;
      moonRef.current.position.set(hot.local.x - s.sunDir.x * 80, 60, hot.local.z - 30);
      moonRef.current.target.position.set(hot.local.x, 0, hot.local.z);
      moonRef.current.target.updateMatrixWorld();
    }
    if (hemiRef.current) {
      if (indoor) {
        // 室内固定中性底光,不随户外「黄昏→夜」标定变化(室内空间自带灯光)
        hemiRef.current.intensity = INDOOR_HEMI_INTENSITY;
        hemiRef.current.color.copy(INDOOR_HEMI_SKY);
        hemiRef.current.groundColor.copy(INDOOR_HEMI_GROUND);
      } else {
        hemiRef.current.intensity = s.hemiIntensity;
        hemiRef.current.color.copy(s.hemiSky);
        hemiRef.current.groundColor.copy(s.hemiGround);
        // 异常点色污染接线(§3.5;anomalies.tsx 每帧更新 0..1)
        const pol = anomalyPollution.current;
        if (pol > 0.01) {
          hemiRef.current.color.lerp(POLLUTION_TINT, 0.2 * pol);
          hemiRef.current.groundColor.lerp(POLLUTION_TINT, 0.12 * pol);
        }
      }
    }
    starOpacity.current = indoor ? 0 : s.starOpacity;
    // 云染色:白天≈纯白,夜晚随天光变暗(cloudTint 由 daynight 采样而来,不会夜里发亮)
    cloudTint.current.copy(s.cloudTint);
    if (env.weather === 'rain') cloudTint.current.lerp(CLOUD_TINT_RAIN, 0.62);
    else if (env.weather === 'cloudy') cloudTint.current.lerp(CLOUD_TINT_CLOUDY, 0.38);
    cloudCover.current = env.weather === 'clear' ? 0.4 : env.weather === 'cloudy' ? 0.85 : 1;
    rainActive.current = env.weather === 'rain' && settings.particles && !indoor;

    if (!indoor) {
      fog.color.copy(s.fogColor);
      const pol = anomalyPollution.current;
      if (pol > 0.01) fog.color.lerp(POLLUTION_TINT, 0.08 * pol);
      fog.near = 48 / s.fogDensityMul;
      fog.far = 235 / s.fogDensityMul;
      scene.fog = fog;
    } else {
      scene.fog = null;
    }

    const night = tod < 0.23 || tod > 0.84;
    audio.setAmbient(!indoor, env.weather, night);
  });

  const shadowSize = settings.quality === 'ultra' ? 4096 : settings.quality === 'high' ? 2048 : 1024;

  return (
    <>
      <mesh frustumCulled={false} renderOrder={-100}>
        <sphereGeometry args={[450, 32, 20]} />
        <shaderMaterial
          ref={skyMat}
          side={THREE.BackSide}
          depthWrite={false}
          vertexShader={SKY_VERT}
          fragmentShader={SKY_FRAG}
          uniforms={uniforms}
        />
      </mesh>
      <Stars opacityRef={starOpacity} />
      {settings.clouds && !indoor && <Clouds tintRef={cloudTint} coverRef={cloudCover} />}
      {!indoor && <Rain activeRef={rainActive} />}
      <hemisphereLight ref={hemiRef} intensity={0.6} />
      <directionalLight
        ref={sunRef}
        intensity={2}
        castShadow={settings.shadows && !indoor}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-42}
        shadow-camera-right={42}
        shadow-camera-top={42}
        shadow-camera-bottom={-42}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight ref={moonRef} intensity={0} color="#7d92c8" />
    </>
  );
}
