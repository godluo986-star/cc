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

const KEYS: Key[] = [
  { t: 0.0,  skyTop: '#070b1a', skyHorizon: '#0e1830', sun: 0,    sunColor: '#8fa6ff', hemi: 0.22, hemiSky: '#22304f', hemiGround: '#10131c', stars: 1 },
  { t: 0.2,  skyTop: '#0a1024', skyHorizon: '#1a2340', sun: 0,    sunColor: '#a3b3ff', hemi: 0.24, hemiSky: '#2a3654', hemiGround: '#131720', stars: 0.9 },
  { t: 0.26, skyTop: '#28406f', skyHorizon: '#e08a5a', sun: 0.75, sunColor: '#ffb066', hemi: 0.42, hemiSky: '#7a86ab', hemiGround: '#3a3730', stars: 0.15 },
  { t: 0.32, skyTop: '#3a71b8', skyHorizon: '#bcd4ea', sun: 1.7,  sunColor: '#ffe0b0', hemi: 0.6,  hemiSky: '#a9c4e8', hemiGround: '#5a5a50', stars: 0 },
  { t: 0.5,  skyTop: '#3d7edb', skyHorizon: '#c3ddf2', sun: 2.3,  sunColor: '#fff4e0', hemi: 0.72, hemiSky: '#bcd6f0', hemiGround: '#6b6a5e', stars: 0 },
  { t: 0.68, skyTop: '#3a6cc0', skyHorizon: '#c8d4e8', sun: 1.9,  sunColor: '#ffe8c8', hemi: 0.64, hemiSky: '#aec6e6', hemiGround: '#5e5c52', stars: 0 },
  { t: 0.76, skyTop: '#33427c', skyHorizon: '#ff9a5c', sun: 0.85, sunColor: '#ff9c50', hemi: 0.45, hemiSky: '#8b84a8', hemiGround: '#453b33', stars: 0.1 },
  { t: 0.83, skyTop: '#141c3d', skyHorizon: '#5c3a63', sun: 0.12, sunColor: '#ff8560', hemi: 0.3,  hemiSky: '#3a3c5f', hemiGround: '#1c1a22', stars: 0.55 },
  { t: 0.9,  skyTop: '#090e20', skyHorizon: '#101a33', sun: 0,    sunColor: '#8fa6ff', hemi: 0.23, hemiSky: '#252f4d', hemiGround: '#11141d', stars: 1 },
  { t: 1.0,  skyTop: '#070b1a', skyHorizon: '#0e1830', sun: 0,    sunColor: '#8fa6ff', hemi: 0.22, hemiSky: '#22304f', hemiGround: '#10131c', stars: 1 },
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

const GRAY_DAY = new THREE.Color('#9aa5b1');
const GRAY_TOP = new THREE.Color('#5b6673');

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
    out.sunIntensity *= 0.28;
    out.skyTop.lerp(GRAY_TOP, 0.72);
    out.skyHorizon.lerp(GRAY_DAY, 0.7);
    out.hemiIntensity *= 0.75;
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
