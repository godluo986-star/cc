/**
 * 性能分级与预算常量(设计文档 §10)。
 *
 * - autoDetectTier():按 navigator 启发式判定画质档(SSR/测试环境安全,
 *   无 navigator 时返回桌面默认 'high');
 * - TIER_BUDGET:各档 DPR 上限/阴影/真实光源数/后期开关/draw call 硬预算;
 * - LOD 切换距离、首屏优先半径、分帧预算等全局常量。
 * 本模块零 three 依赖(纯逻辑),可被 state 层与测试直接引用。
 */

/** 画质档位(与 state/stores.ts 的 Quality 联合类型一致)。 */
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

/** §10:建筑 LOD 三档(完整 → 无道具细节 → 剪影)的切换距离(米)。 */
export const LOD_SWITCH_DISTANCES = [45, 110] as const;
/** §10:首屏优先生成出生点周边半径(米),其余空闲帧补齐。 */
export const SPAWN_PRIORITY_RADIUS = 80;
/** §10:程序化生成分帧执行的单帧预算(毫秒,每帧 ≤ 8ms)。 */
export const BUILD_FRAME_BUDGET_MS = 8;

/** 单个档位的渲染预算(§10 表格逐列对应)。 */
export interface TierBudget {
  /** renderer.setPixelRatio 上限。 */
  dprMax: number;
  /** 阴影贴图边长(px);0 = 关闭阴影。 */
  shadowMapSize: number;
  /** 是否仅主方向光投影(Medium 及以下;§3 shadow camera 跟随玩家)。 */
  shadowMainLightOnly: boolean;
  /** 同屏真实光源(point/spot)预算,超出部分用自发光假光(§3)。 */
  maxRealLights: number;
  /** 后期栈开关(§7 顺序:SMAA → Bloom → 分级 → SSAO → 暗角 → 颗粒 → 色差)。 */
  post: {
    smaa: boolean;
    bloom: boolean;
    vignette: boolean;
    /** 胶片颗粒 0.035(§7);Medium 档起关闭。 */
    grain: boolean;
    /** 色差 0.0008 极轻(§7);Medium 档起关闭。 */
    chromaticAberration: boolean;
    /** SSAO(半径 0.4 强度 0.35,§7);仅 Ultra 开。 */
    ssao: boolean;
  };
  /** 硬预算:每帧 draw call 上限(桌面 350 / 移动 180)。 */
  maxDrawCalls: number;
  /** 硬预算:三角形上限(桌面 90 万 / 移动 45 万)。 */
  maxTriangles: number;
  /** 前景/道具密度系数(Low 档前景装饰减半 = 0.5)。 */
  propDensity: number;
  /** 背景剪影层数(§4.2 三层;Low 档两层)。 */
  bgSilhouetteLayers: 2 | 3;
}

/** §10 分级预算表。所有渲染侧魔法数以此为准,不得散落。 */
export const TIER_BUDGET: Readonly<Record<QualityTier, TierBudget>> = {
  // Ultra:桌面独显 —— DPR 2.0 / 2048 PCF 阴影 / 后期全开(含 SSAO)/ 10 真实光源
  ultra: {
    dprMax: 2.0,
    shadowMapSize: 2048,
    shadowMainLightOnly: false,
    maxRealLights: 10,
    post: { smaa: true, bloom: true, vignette: true, grain: true, chromaticAberration: true, ssao: true },
    maxDrawCalls: 350,
    maxTriangles: 900_000,
    propDensity: 1,
    bgSilhouetteLayers: 3,
  },
  // High:默认桌面 —— DPR 1.75 / 1024 阴影 / 后期全开(无 SSAO)/ 8 真实光源
  high: {
    dprMax: 1.75,
    shadowMapSize: 1024,
    shadowMainLightOnly: false,
    maxRealLights: 8,
    post: { smaa: true, bloom: true, vignette: true, grain: true, chromaticAberration: true, ssao: false },
    maxDrawCalls: 350,
    maxTriangles: 900_000,
    propDensity: 1,
    bgSilhouetteLayers: 3,
  },
  // Medium:弱桌面/大屏移动 —— DPR 1.5 / 512 仅主光阴影 / 仅 SMAA+暗角 / 5 光源
  medium: {
    dprMax: 1.5,
    shadowMapSize: 512,
    shadowMainLightOnly: true,
    maxRealLights: 5,
    post: { smaa: true, bloom: false, vignette: true, grain: false, chromaticAberration: false, ssao: false },
    maxDrawCalls: 350,
    maxTriangles: 900_000,
    propDensity: 1,
    bgSilhouetteLayers: 3,
  },
  // Low:移动默认 —— DPR 1.25 / 无阴影 / 无后期 / 3 光源 / 前景减半、背景两层
  low: {
    dprMax: 1.25,
    shadowMapSize: 0,
    shadowMainLightOnly: true,
    maxRealLights: 3,
    post: { smaa: false, bloom: false, vignette: false, grain: false, chromaticAberration: false, ssao: false },
    maxDrawCalls: 180,
    maxTriangles: 450_000,
    propDensity: 0.5,
    bgSilhouetteLayers: 2,
  },
};

/** lib.dom 未收录的可选 Navigator 提示字段(Chrome 系)。 */
interface NavigatorHints {
  readonly deviceMemory?: number;
  readonly userAgentData?: { readonly mobile?: boolean };
}

/**
 * 启发式自动判定画质档(§10「判定」列):
 * - 移动设备(userAgentData.mobile / UA / iPadOS 桌面态触屏)→ low,
 *   其中"大屏移动"(内存 > 4GB 且 ≥ 8 核)→ medium;
 * - deviceMemory ≤ 4GB → low;
 * - 弱桌面(≤ 4 核)→ medium;
 * - 强桌面(≥ 8GB 或未知内存,且 ≥ 12 核)近似"桌面独显"→ ultra;
 * - 其余桌面 → high(默认档)。
 * 浏览器无法直接探测独显,ultra 判定偏保守,用户可在设置里手动上调。
 * SSR/无 navigator 环境安全:直接返回 'high'。
 */
export function autoDetectTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'high';
  const nav = navigator as Navigator & NavigatorHints;
  const ua = nav.userAgent ?? '';
  const mem = nav.deviceMemory; // GB;仅 Chrome 系提供
  const cores = nav.hardwareConcurrency ?? 0;
  // iPadOS 13+ 的 Safari 桌面态 UA 伪装为 Macintosh,用多点触控辨认
  const iPadDesktopUa = /Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 2;
  const isMobile =
    nav.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    iPadDesktopUa;
  if (isMobile) {
    return (mem ?? 0) > 4 && cores >= 8 ? 'medium' : 'low';
  }
  if (mem !== undefined && mem <= 4) return 'low';
  if (cores > 0 && cores <= 4) return 'medium';
  if ((mem === undefined || mem >= 8) && cores >= 12) return 'ultra';
  return 'high';
}
