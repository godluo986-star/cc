/** Day/night lighting keyframes sampled from the world clock. */
import * as THREE from 'three';
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

interface Key {
  t: number;
  skyTop: string; skyHorizon: string;
  sun: number; sunColor: string;
  hemi: number; hemiSky: string; hemiGround: string;
  stars: number;
}

// 粉彩绘本调色:低饱和、柔和过渡。夜晚是柔和蓝紫而非死黑;
// 黎明/黄昏走杏粉/藕紫;白天天空低饱和粉蓝 + 奶油白地平线。
const KEYS: Key[] = [
  { t: 0.0,  skyTop: '#2b3057', skyHorizon: '#4a4e78', sun: 0,    sunColor: '#aab6ff', hemi: 0.35, hemiSky: '#5a608c', hemiGround: '#3a3a4e', stars: 1 },
  { t: 0.2,  skyTop: '#333963', skyHorizon: '#535788', sun: 0,    sunColor: '#b4bfff', hemi: 0.36, hemiSky: '#626896', hemiGround: '#3e3e54', stars: 0.9 },
  { t: 0.26, skyTop: '#6d7cb2', skyHorizon: '#f2b8a0', sun: 0.7,  sunColor: '#ffc79a', hemi: 0.55, hemiSky: '#a8a4c8', hemiGround: '#6e6258', stars: 0.15 },
  { t: 0.32, skyTop: '#7fb0de', skyHorizon: '#f0e2cc', sun: 1.5,  sunColor: '#ffeccc', hemi: 0.75, hemiSky: '#c6d8ec', hemiGround: '#8a8274', stars: 0 },
  { t: 0.5,  skyTop: '#7db8e8', skyHorizon: '#f2ead8', sun: 1.9,  sunColor: '#fff6e6', hemi: 0.85, hemiSky: '#d3e2f2', hemiGround: '#948c7c', stars: 0 },
  { t: 0.68, skyTop: '#7cabdc', skyHorizon: '#efe3d0', sun: 1.65, sunColor: '#ffedd2', hemi: 0.8,  hemiSky: '#c9d8ec', hemiGround: '#8c8476', stars: 0 },
  { t: 0.76, skyTop: '#8a7cb8', skyHorizon: '#f2b6a4', sun: 0.75, sunColor: '#ffb98c', hemi: 0.58, hemiSky: '#b3a2c6', hemiGround: '#6e6058', stars: 0.1 },
  { t: 0.83, skyTop: '#474b7e', skyHorizon: '#9a80ab', sun: 0.12, sunColor: '#f0a58a', hemi: 0.42, hemiSky: '#6c6a99', hemiGround: '#46425a', stars: 0.55 },
  { t: 0.9,  skyTop: '#30355e', skyHorizon: '#4f5382', sun: 0,    sunColor: '#aab6ff', hemi: 0.36, hemiSky: '#5c628e', hemiGround: '#3b3b50', stars: 1 },
  { t: 1.0,  skyTop: '#2b3057', skyHorizon: '#4a4e78', sun: 0,    sunColor: '#aab6ff', hemi: 0.35, hemiSky: '#5a608c', hemiGround: '#3a3a4e', stars: 1 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function lerpKeyColor(a: string, b: string, f: number, out: THREE.Color): THREE.Color {
  tmpA.set(a); tmpB.set(b);
  return out.copy(tmpA).lerp(tmpB, f);
}

const scratch: EnvSample = {
  sunDir: new THREE.Vector3(0, 1, 0),
  sunIntensity: 1,
  sunColor: new THREE.Color(),
  moonIntensity: 0,
  hemiIntensity: 0.6,
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  skyTop: new THREE.Color(),
  skyHorizon: new THREE.Color(),
  fogColor: new THREE.Color(),
  fogDensityMul: 1,
  starOpacity: 0,
  lampsOn: false,
  cloudTint: new THREE.Color(),
};

// 阴雨灰调:偏暖偏浅的米灰,避免脏灰
const GRAY_DAY = new THREE.Color('#cfc9c0');
const GRAY_TOP = new THREE.Color('#a3a6b2');

export function sampleEnv(tod: number, weather: Weather, out: EnvSample = scratch): EnvSample {
  const t = ((tod % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t < t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const f = THREE.MathUtils.clamp((t - a.t) / Math.max(1e-5, b.t - a.t), 0, 1);

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

  // Weather overrides
  if (weather === 'cloudy') {
    out.sunIntensity *= 0.55;
    out.skyTop.lerp(GRAY_TOP, 0.45);
    out.skyHorizon.lerp(GRAY_DAY, 0.45);
    out.hemiIntensity *= 0.85;
    out.starOpacity *= 0.35;
    out.fogDensityMul = 1.4;
  } else if (weather === 'rain') {
    out.sunIntensity *= 0.3;
    out.skyTop.lerp(GRAY_TOP, 0.72);
    out.skyHorizon.lerp(GRAY_DAY, 0.7);
    out.hemiIntensity *= 0.82;
    out.starOpacity = 0;
    out.fogDensityMul = 2.1;
  }

  out.moonIntensity = out.sunIntensity < 0.25 ? 0.16 : 0;
  out.lampsOn = out.sunIntensity < 0.5;
  out.fogColor.copy(out.skyHorizon);
  out.cloudTint.copy(out.skyHorizon).lerp(new THREE.Color('#ffffff'), weather === 'clear' ? 0.6 : 0.25);
  return out;
}

/** Client-side extrapolated time-of-day from the last env message. */
export function currentTod(env: { timeOfDay: number; at: number; dayLengthSec: number }): number {
  return (env.timeOfDay + (Date.now() - env.at) / 1000 / env.dayLengthSec) % 1;
}
