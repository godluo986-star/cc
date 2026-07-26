/**
 * 「黄昏街区 / Dusk Ward」全局色板(设计文档 §2)。
 *
 * 所有城市物体的颜色必须从这里取:约 80% 画面来自环境低饱和组 ENV,
 * 20% 来自强调组 ACCENT(团子玩家自身的 9 色粉彩计入强调配额)。
 * 禁止在场景代码里散落魔法色值 —— 新颜色先进本表再使用。
 */

/** 十六进制颜色字符串('#rrggbb')。 */
export type HexColor = `#${string}`;

// ── §2.1 环境低饱和组(约 80% 画面) ────────────────────────────────────────
export const ENV = {
  /** 天空顶(黄昏):深蓝灰。 */
  skyTopDusk: '#232a3d',
  /** 天空顶(深夜):黄昏色夜里压暗到此值。 */
  skyTopNight: '#151a2b',
  /** 天空地平线:低饱和紫灰。 */
  skyHorizon: '#4a4658',
  /** 地平线残照渐层(与 skyHorizon 做渐变)。 */
  skyAfterglow: '#6b5560',
  /** 远景楼剪影第 1 层(最近、最暗)。 */
  bgSilhouetteA: '#2b3040',
  /** 远景楼剪影第 2 层(雾越远越亮灰)。 */
  bgSilhouetteB: '#343a4d',
  /** 远景楼剪影第 3 层(最远、最亮灰)。 */
  bgSilhouetteC: '#3e4459',
  /** 主路面沥青(其上叠雨渍水印手绘斑块贴图)。 */
  roadAsphalt: '#3a3e4a',
  /** 人行道砖:冷灰。 */
  sidewalk: '#4a4e58',
  /** 人行道砖缝。 */
  sidewalkSeam: '#3f434d',
  /** 建筑主墙面 A:蓝灰混凝土。 */
  wallA: '#59607a',
  /** 建筑主墙面 B:低饱和紫灰(旧公寓)。 */
  wallB: '#6a6577',
  /** 建筑主墙面 C:暗青(卷帘门、配电箱)。 */
  wallC: '#4e5a5e',
  /** 旧墙淡色:沿街小店二层,避免大面积纯白。 */
  wallPale: '#8a8494',
  /** 金属(栏杆/灯杆/空调外机):高粗糙度、零金属反射。 */
  metal: '#454a56',
  /** 全场统一描边色:深蓝黑(不是纯黑,§5 描边系统用)。 */
  outline: '#1d2130',
  /** 分层雾近端(高度雾 + 距离雾双层)。 */
  fogNear: '#3d4257',
  /** 分层雾远端。 */
  fogFar: '#585d73',
} as const satisfies Record<string, HexColor>;

// ── §2.2 强调组(约 20% 画面,小面积、克制) ────────────────────────────────
export const ACCENT = {
  /** 钠灯路灯光:脏黄,全图主要暖光源。 */
  lampSodium: '#e8a84c',
  /** 室内窗光:暖黄,零散亮窗自发光。 */
  windowWarm: '#f0c987',
  /** 便利店招牌:青绿,唯一大块亮色。 */
  konbiniSign: '#7fd1c0',
  /** 电影院招牌 AURORA:暗玫红霓虹(亮度克制,禁止过曝)。 */
  cinemaSign: '#c95d78',
  /** 网吧招牌 NEXUS:蓝青霓虹。 */
  netcafeSign: '#5d8fc9',
  /** 雀庄灯笼「东风阁」:暖橙。 */
  mahjongLantern: '#c9873f',
  /** 自动售货机(红款),城市生活感锚点。 */
  vendingRed: '#b0413e',
  /** 自动售货机(蓝款)。 */
  vendingBlue: '#3e6bb0',
  /** 交通信号红灯(路口慢周期切换)。 */
  trafficRed: '#c94f4f',
  /** 交通信号绿灯。 */
  trafficGreen: '#4fc97a',
  /** 超自然强调(蓝紫):只用于异常现象,小面积、低频。 */
  anomalyViolet: '#7a4fd1',
  /** 超自然强调(青绿):同上。 */
  anomalyTeal: '#43d1a4',
} as const satisfies Record<string, HexColor>;

/** ENV 组颜色键名。 */
export type EnvColorName = keyof typeof ENV;
/** ACCENT 组颜色键名。 */
export type AccentColorName = keyof typeof ACCENT;
/** 全色板任意键名。 */
export type CityColorName = EnvColorName | AccentColorName;

/** 合并视图:按键名取任意城市颜色(只读)。 */
export const CITY_PALETTE: Readonly<Record<CityColorName, HexColor>> = {
  ...ENV,
  ...ACCENT,
};
