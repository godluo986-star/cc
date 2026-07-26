/**
 * 城市 toon 材质基建(设计文档 §5)。
 *
 * 与 Avatar.tsx 的团子 toon 做法同源但独立实现(city 专用,不 import avatar):
 * - nightToonRamp():共享 4 阶夜景 gradientMap(0.32/0.55/0.78/1.0,避免死黑),
 *   重要物体(角色/售货机/招牌)用它;
 * - bgToonRamp():二阶背景版,背景物只需两档明暗;
 * - toonMat(color, opts):统一 MeshToonMaterial 工厂,全城一套画风。
 * ramp 纹理模块级缓存,NearestFilter 产生硬色阶(赛璐璐感)。
 */
import * as THREE from 'three';

/** §5:夜景 4 阶 ramp 灰阶(0-1),最低 0.32 保证暗部不死黑。 */
export const NIGHT_RAMP_STEPS = [0.32, 0.55, 0.78, 1.0] as const;
/** §5:背景物 2 阶 ramp 灰阶 —— 暗部取夜景 ramp 第二阶,亮部满值。 */
export const BG_RAMP_STEPS = [0.55, 1.0] as const;

/** 由灰阶数组生成 1×N 的 NearestFilter DataTexture(toon gradientMap)。 */
function makeRampTexture(steps: readonly number[]): THREE.DataTexture {
  const data = new Uint8Array(steps.map((s) => Math.round(s * 255)));
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

let nightRamp: THREE.DataTexture | null = null;
/** 共享 4 阶夜景 toon ramp(模块缓存,全场重要物体统一使用)。 */
export function nightToonRamp(): THREE.DataTexture {
  if (!nightRamp) nightRamp = makeRampTexture(NIGHT_RAMP_STEPS);
  return nightRamp;
}

let bgRamp: THREE.DataTexture | null = null;
/** 共享 2 阶背景 toon ramp(模块缓存,背景/远景简化物体用)。 */
export function bgToonRamp(): THREE.DataTexture {
  if (!bgRamp) bgRamp = makeRampTexture(BG_RAMP_STEPS);
  return bgRamp;
}

export interface ToonMatOptions {
  /** 明暗阶数:4 = 夜景主 ramp(默认),2 = 背景简化 ramp(§5 背景物)。 */
  steps?: 2 | 4;
  /** 自发光颜色(招牌/亮窗等假光源用,§3 自发光假光)。 */
  emissive?: THREE.ColorRepresentation;
  /** 自发光强度(默认 1;亮度克制,禁止过曝,§2.2)。 */
  emissiveIntensity?: number;
  /** 漫反射贴图(程序化 canvas 贴图,§5 手绘质感)。 */
  map?: THREE.Texture | null;
  /** 自发光贴图(亮窗点阵等)。 */
  emissiveMap?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** 是否受场景雾影响(默认 true;近景 UI 类物体可关)。 */
  fog?: boolean;
}

/**
 * 城市统一 toon 材质工厂:MeshToonMaterial + 共享 ramp。
 * 任何城市物体的表面材质都应经由本工厂创建,保证一套色板一套明暗层级。
 */
export function toonMat(
  color: THREE.ColorRepresentation,
  opts: ToonMatOptions = {}
): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: opts.steps === 2 ? bgToonRamp() : nightToonRamp(),
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    fog: opts.fog ?? true,
  });
  if (opts.emissive !== undefined) {
    mat.emissive = new THREE.Color(opts.emissive);
    mat.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  if (opts.map) mat.map = opts.map;
  if (opts.emissiveMap) mat.emissiveMap = opts.emissiveMap;
  return mat;
}
