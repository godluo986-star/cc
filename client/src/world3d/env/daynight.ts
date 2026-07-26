/**
 * Day/night lighting keyframes sampled from the world clock.
 *
 * 「黄昏街区」重标定(P4,总纲 §3):日循环停在「黄昏→夜」情绪区间 ——
 * - 白天段 = 阴天灰蓝(不出现明媚正午,GRAY 系压灰);
 * - 黄昏   = 残照 #6b5560 / #4a4658 渐层;
 * - 夜     = 深蓝灰 #232a3d → #151a2b;
 * - 主方向光(月光/残照)#8d99c9 强度 ~0.55;hemi #39415f/#23262f ~0.28-0.32,
 *   夜间下限 ≥ 0.3(压抑但不全黑:暗部必须读得出形体,§3.2)。
 */
import * as THREE from 'three';
import { ENV } from '../city/palette';
import type { Weather } from '@nexuspark/shared';

export interface EnvSample {
  sunDir: THREE.Vector3;
  sunIntensity: number;
  sunColor: THREE.Color;
  moonIntensity: number;
  hemiIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  fogColor: THREE.Color;
  fogDensityMul: number;
  starOpacity: number;
  lampsOn: boolean;
  cloudTint: THREE.Color;
}

/** 新建一份可复用的采样输出(供 SkySystem 之外的订阅者各持一份,避免共享 scratch 冲突)。 */
export function createEnvSample(): EnvSample {
  return {
    sunDir: new THREE.Vector3(0, 1, 0),
    sunIntensity: 0.55,
    sunColor: new THREE.Color(),
    moonIntensity: 0,
    hemiIntensity: 0.32,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogDensityMul: 1,
    starOpacity: 0,
    lampsOn: true,
    cloudTint: new THREE.Color(),
  };
}

interface Key {
  t: number;
  skyTop: string; skyHorizon: string;
  sun: number; sunColor: string;
  hemi: number; hemiSky: string; hemiGround: string;
  stars: number;
}

// 黄昏街区标定(§2.1/§3):主光整日维持 ~0.5-0.58(白天=阴天散射、黄昏=残照、
// 夜=月光 #8d99c9),不再落到 0 —— 夜里靠这盏"月光"拉出长影,hemi 托住暗部。
const KEYS: Key[] = [
  // 深夜:天顶压到 #151a2b,地平线留一点城市光雾(fogNear 灰)
  { t: 0.0,  skyTop: '#151a2b', skyHorizon: '#3d4257', sun: 0.55, sunColor: '#8d99c9', hemi: 0.32, hemiSky: '#39415f', hemiGround: '#23262f', stars: 1 },
  { t: 0.22, skyTop: '#151a2b', skyHorizon: '#3d4257', sun: 0.55, sunColor: '#8d99c9', hemi: 0.32, hemiSky: '#39415f', hemiGround: '#23262f', stars: 1 },
  // 灰蓝黎明(没有金色日出,直接亮成阴天)
  { t: 0.28, skyTop: '#2c3347', skyHorizon: '#4a4658', sun: 0.5,  sunColor: '#98a0b8', hemi: 0.36, hemiSky: '#414a68', hemiGround: '#262a36', stars: 0.3 },
  // 白天 = 阴天灰蓝(氛围统一,§3「白天段压缩为阴天灰蓝」)
  { t: 0.36, skyTop: '#454c62', skyHorizon: '#585d73', sun: 0.55, sunColor: '#9fa8c2', hemi: 0.42, hemiSky: '#4a5470', hemiGround: '#2c303c', stars: 0 },
  { t: 0.5,  skyTop: '#4a5168', skyHorizon: '#5d6278', sun: 0.58, sunColor: '#a6aec6', hemi: 0.44, hemiSky: '#4e5874', hemiGround: '#2e323e', stars: 0 },
  { t: 0.66, skyTop: '#3b4258', skyHorizon: '#585d73', sun: 0.55, sunColor: '#a0a2be', hemi: 0.4,  hemiSky: '#46506c', hemiGround: '#2a2e3a', stars: 0 },
  // 黄昏残照:地平线 #6b5560,天顶落回 #232a3d(§2.1)
  { t: 0.74, skyTop: '#232a3d', skyHorizon: '#6b5560', sun: 0.5,  sunColor: '#b58e8e', hemi: 0.34, hemiSky: '#39415f', hemiGround: '#23262f', stars: 0.15 },
  { t: 0.8,  skyTop: '#1d2434', skyHorizon: '#4a4658', sun: 0.52, sunColor: '#a193b4', hemi: 0.31, hemiSky: '#39415f', hemiGround: '#23262f', stars: 0.55 },
  // 入夜
  { t: 0.88, skyTop: '#151a2b', skyHorizon: '#3d4257', sun: 0.55, sunColor: '#8d99c9', hemi: 0.32, hemiSky: '#39415f', hemiGround: '#23262f', stars: 1 },
  { t: 1.0,  skyTop: '#151a2b', skyHorizon: '#3d4257', sun: 0.55, sunColor: '#8d99c9', hemi: 0.32, hemiSky: '#39415f', hemiGround: '#23262f', stars: 1 },
];

/** 夜间 hemisphere 下限(§3:参考 03:13 全黑截图问题 —— 暗部必须可读)。 */
const HEMI_FLOOR = 0.3;

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function lerpKeyColor(a: string, b: string, f: number, out: THREE.Color): THREE.Color {
  tmpA.set(a); tmpB.set(b);
  return out.copy(tmpA).lerp(tmpB, f);
}

const scratch: EnvSample = createEnvSample();

// 阴/雨天压灰目标(§2.1 色板内取值,不再用米灰暖色)
const GRAY_TOP = new THREE.Color(ENV.fogFar);      // #585d73
const GRAY_HORIZON = new THREE.Color(ENV.wallPale); // #8a8494
// 分层雾双端(§2.1):近 #3d4257 → 远 #585d73;单雾用「按昼夜插值」近似分层
const FOG_NEAR = new THREE.Color(ENV.fogNear);
const FOG_FAR = new THREE.Color(ENV.fogFar);
const WHITE = new THREE.Color('#ffffff');

export function sampleEnv(tod: number, weather: Weather, out: EnvSample = scratch): EnvSample {
  const t = ((tod % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t < t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const f = THREE.MathUtils.clamp((t - a.t) / Math.max(1e-5, b.t - a.t), 0, 1);

  // 方向:白天沿黄道走;夜里(太阳落山后)这就是"月光"的方位,
  // SkySystem 对灯位 y 做了 max(6,·) 抬升,方向感保留、光不会从地下打。
  const theta = (t - 0.25) * Math.PI * 2;
  out.sunDir.set(Math.cos(theta), Math.sin(theta), 0.35).normalize();

  out.sunIntensity = THREE.MathUtils.lerp(a.sun, b.sun, f);
  lerpKeyColor(a.sunColor, b.sunColor, f, out.sunColor);
  out.hemiIntensity = THREE.MathUtils.lerp(a.hemi, b.hemi, f);
  lerpKeyColor(a.hemiSky, b.hemiSky, f, out.hemiSky);
  lerpKeyColor(a.hemiGround, b.hemiGround, f, out.hemiGround);
  lerpKeyColor(a.skyTop, b.skyTop, f, out.skyTop);
  lerpKeyColor(a.skyHorizon, b.skyHorizon, f, out.skyHorizon);
  out.starOpacity = THREE.MathUtils.lerp(a.stars, b.stars, f);
  out.fogDensityMul = 1;

  // Weather overrides(本图基调本来就是阴郁,天气只做小幅加压)
  if (weather === 'cloudy') {
    out.sunIntensity *= 0.7;
    out.skyTop.lerp(GRAY_TOP, 0.35);
    out.skyHorizon.lerp(GRAY_HORIZON, 0.3);
    out.hemiIntensity *= 0.92;
    out.starOpacity *= 0.35;
    out.fogDensityMul = 1.35;
  } else if (weather === 'rain') {
    out.sunIntensity *= 0.42;
    out.skyTop.lerp(GRAY_TOP, 0.55);
    out.skyHorizon.lerp(GRAY_HORIZON, 0.45);
    out.hemiIntensity *= 0.88;
    out.starOpacity = 0;
    out.fogDensityMul = 1.9;
  }

  // 夜间可读性下限(§3):hemi 不低于 0.3,天气也压不穿。
  out.hemiIntensity = Math.max(out.hemiIntensity, HEMI_FLOOR);

  // 夜里再补一盏反向弱月(填充,不投影),随星光淡入
  out.moonIntensity = 0.18 * out.starOpacity;
  // 路灯/招牌点亮窗口:黄昏→夜 + 雨天全天
  out.lampsOn = t < 0.3 || t > 0.7 || weather === 'rain';

  // 分层雾近似:白天偏远端亮灰 #585d73,夜里滑向近端 #3d4257;
  // 再向天空地平线拉 35% 避免穹顶接缝。
  out.fogColor.copy(FOG_FAR).lerp(FOG_NEAR, out.starOpacity * 0.85).lerp(out.skyHorizon, 0.35);

  // 云染色:阴天城市上空的云只比天光稍亮;夜里几乎融进天色(不发亮)。
  const dayness = 1 - out.starOpacity;
  out.cloudTint
    .copy(out.skyHorizon)
    .lerp(WHITE, (weather === 'clear' ? 0.3 : 0.14) * (0.25 + 0.75 * dayness));
  return out;
}

/** Client-side extrapolated time-of-day from the last env message. */
export function currentTod(env: { timeOfDay: number; at: number; dayLengthSec: number }): number {
  return (env.timeOfDay + (Date.now() - env.at) / 1000 / env.dayLengthSec) % 1;
}
