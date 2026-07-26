/**
 * 黄昏街区(Dusk Ward)平面数据 —— 三方共享契约(P2 精排,P3 只按数据渲染)。
 * 坐标系:x 向东,z 向南(北 = -z)。所有矩形均为「中心 + 全宽全深」。
 * 依据 docs/art-direction.md §4:中央大十字路口(0,0)、东西/南北主街(路宽 14,
 * 两侧人行道各 5)、南站前广场(z≈+56)、北高架天桥(deck y=5.2)、东南/西南窄巷网、
 * 四角高楼 + 沿街店面 + 外圈公寓 + 更外圈剪影。
 */
import { seededRandom } from './math';

export interface CityRect { x: number; z: number; w: number; d: number }
export interface CityCrosswalk extends CityRect { dir: 'x' | 'z' }
export interface CityBuilding extends CityRect {
  h: number;
  ry?: number;
  style: 'shopfront' | 'tower' | 'apartment' | 'backstreet' | 'silhouette';
  sign?: { text: string; color: string };
  /** 填场馆 key 时 = 带门店面(门位见 VENUES)。 */
  venue?: string;
}
export interface CityRamp extends CityRect {
  /** 坡道下坡朝向(下坡指向的罗盘方向;n = -z)。 */
  dir: 'n' | 's' | 'e' | 'w';
}
export interface CityVenue {
  key: 'cinema' | 'netcafe' | 'gameroom' | 'cafe' | 'shop' | 'arcade' | 'tower';
  x: number; z: number; ry: number; label: string;
}
export interface CityAnomaly { id: string; x: number; z: number; r: number }

export const CITY_BOUNDS = { minX: -260, maxX: 260, minZ: -260, maxZ: 260 };

/** 主街半宽 7(路宽 14),人行道 5;路口 26×26。 */
export const ROAD_W = 14;
export const SIDEWALK_W = 5;

/** 沥青路面矩形:路口四臂(东西南北)。 */
export const ROADS: CityRect[] = [
  { x: 136.5, z: 0, w: 247, d: 14 },   // 东街 x 13..260
  { x: -136.5, z: 0, w: 247, d: 14 },  // 西街 x -260..-13
  { x: 0, z: -136.5, w: 14, d: 247 },  // 北街 z -260..-13
  { x: 0, z: 136.5, w: 14, d: 247 },   // 南街 z 13..260
];

/** 中央大十字路口(斑马线区)。 */
export const CROSSING: CityRect = { x: 0, z: 0, w: 26, d: 26 };

/** 斑马线条纹带;dir = 行人穿行方向('z' 跨东西向车道,'x' 跨南北向车道)。 */
export const CROSSWALKS: CityCrosswalk[] = [
  { x: 0, z: -9.5, w: 14, d: 5, dir: 'z' },
  { x: 0, z: 9.5, w: 14, d: 5, dir: 'z' },
  { x: -9.5, z: 0, w: 5, d: 14, dir: 'x' },
  { x: 9.5, z: 0, w: 5, d: 14, dir: 'x' },
];

/** 人行道砖区(含站前广场铺装与窄巷地面)。 */
export const SIDEWALKS: CityRect[] = [
  // 东街两侧
  { x: 136.5, z: -9.5, w: 247, d: 5 },
  { x: 136.5, z: 9.5, w: 247, d: 5 },
  // 西街两侧
  { x: -136.5, z: -9.5, w: 247, d: 5 },
  { x: -136.5, z: 9.5, w: 247, d: 5 },
  // 北街两侧
  { x: -9.5, z: -136.5, w: 5, d: 247 },
  { x: 9.5, z: -136.5, w: 5, d: 247 },
  // 南街两侧
  { x: -9.5, z: 136.5, w: 5, d: 247 },
  { x: 9.5, z: 136.5, w: 5, d: 247 },
  // 站前广场(南,出生点所在;z 44..72)
  { x: 0, z: 58, w: 60, d: 28 },
  // 东南窄巷网(宽 2.2,两次拐弯:东进 → 南折 → 东折到巷底)
  { x: 22.6, z: 24.6, w: 21.2, d: 2.2 },   // SE-1 x 12..33.2
  { x: 32.1, z: 29.3, w: 2.2, d: 11.6 },   // SE-2 z 23.5..35.1
  { x: 38.6, z: 34.0, w: 10.8, d: 2.2 },   // SE-3 x 33.2..44(巷底,异常点 B)
  // 西南窄巷网(宽 2.2:西进 → 北折 → 西折到巷底)
  { x: -22.1, z: 37.6, w: 20.2, d: 2.2 },  // SW-1 x -32.2..-12
  { x: -33.3, z: 32.7, w: 2.2, d: 12 },    // SW-2 z 26.7..38.7
  { x: -39.2, z: 27.8, w: 9.6, d: 2.2 },   // SW-3 x -44..-34.4(巷底)
];

// ── 建筑 ────────────────────────────────────────────────────────────────────
const b = (x: number, z: number, w: number, d: number, h: number,
  style: CityBuilding['style'], extra?: Partial<CityBuilding>): CityBuilding =>
  ({ x, z, w, d, h, style, ...extra });

/** 视觉建筑体;非 silhouette 全部参与碰撞(layouts.ts 逐一 box)。 */
export const BUILDINGS: CityBuilding[] = [
  // 场馆店面(门位见 VENUES;墙面临人行道外缘 ±12)
  b(30, -18.5, 18, 13, 13, 'shopfront', { venue: 'cinema', sign: { text: 'AURORA', color: '#c95d78' } }),
  b(-30, -18.5, 14, 12, 11, 'shopfront', { venue: 'netcafe', sign: { text: 'NEXUS', color: '#5d8fc9' } }),
  b(18.5, 31.7, 13, 12, 10, 'shopfront', { venue: 'gameroom', sign: { text: '东风阁', color: '#c9873f' } }),
  b(-18.5, 31, 13, 11, 9, 'shopfront', { venue: 'cafe', sign: { text: '研磨咖啡', color: '#f0c987' } }),
  b(-30, 18.5, 14, 12, 10, 'shopfront', { venue: 'shop', sign: { text: '便利店', color: '#7fd1c0' } }),
  b(30, 18, 14, 11, 12, 'shopfront', { venue: 'arcade', sign: { text: '像素宫', color: '#b0413e' } }),
  b(19, -58, 14, 16, 32, 'tower', { venue: 'tower', sign: { text: '团子塔', color: '#f0c987' } }),
  // 沿街补充店面
  b(47, -18, 14, 12, 12, 'shopfront', { sign: { text: '定食·晚风', color: '#f0c987' } }),
  b(62, -17.5, 12, 11, 9, 'shopfront'),
  b(-47, -18, 14, 12, 10, 'shopfront', { sign: { text: '喫茶·蓝', color: '#8a8494' } }),
  b(-62, 17.5, 12, 11, 9, 'shopfront'),
  b(-56, 17, 11, 10, 13, 'shopfront'),
  b(-19, -60, 14, 14, 12, 'shopfront', { sign: { text: '洗衣', color: '#7fd1c0' } }),
  // 路口四角高楼(视觉 40-70m,不可进入)
  b(-24, -36, 20, 20, 66, 'tower'),
  b(24, -36, 20, 20, 58, 'tower'),
  b(46.6, 18.2, 13, 12, 48, 'tower'),
  b(-58, 30, 14, 16, 52, 'tower'),
  // 东南巷网围合体
  b(38.55, 17.85, 3.1, 11.3, 9, 'backstreet'),   // 封住塔与街机厅间的豁口
  b(28, 31, 6, 10.6, 14, 'backstreet'),
  b(38.6, 28.2, 10.8, 9.4, 16, 'backstreet'),
  b(38, 41.1, 14, 12, 13, 'backstreet'),
  b(47, 33.9, 6, 9, 12, 'backstreet'),
  // 西南巷网围合体
  b(-28.6, 30.5, 7.2, 12, 15, 'backstreet'),
  b(-22.1, 41.3, 20.2, 5.2, 12, 'backstreet'),
  b(-38, 43.5, 11.6, 9.6, 14, 'backstreet'),
  b(-39.9, 33.8, 11, 9.8, 16, 'backstreet'),
  b(-39.2, 22.85, 9.6, 7.7, 13, 'backstreet'),
  b(-46.9, 26.4, 5.8, 9, 12, 'backstreet'),
  // 外圈公寓 / 背街(h 12-24)
  b(-21, 84, 18, 16, 18, 'apartment'),
  b(22, 82, 20, 14, 16, 'apartment'),
  b(-46, 62, 22, 18, 20, 'apartment'),
  b(48, 60, 20, 18, 22, 'apartment'),
  b(78, -19, 18, 13, 17, 'apartment'),
  b(74, 20, 20, 15, 19, 'apartment'),
  b(-80, -20, 20, 15, 21, 'apartment'),
  b(-80, 19, 18, 13, 15, 'apartment'),
  b(-40, -56, 16, 12, 18, 'apartment'),
  b(-34, -74, 18, 14, 22, 'apartment'),
  b(26, -78, 20, 16, 20, 'apartment'),
  b(-19, -92, 14, 12, 14, 'backstreet'),
  b(20, -100, 16, 14, 16, 'apartment'),
  b(60, -60, 26, 22, 24, 'apartment'),
  b(-62, -62, 24, 20, 22, 'apartment'),
  b(70, 70, 22, 20, 20, 'apartment'),
  b(-72, 70, 20, 18, 24, 'apartment'),
];

// 更外圈剪影楼群(±120..±250,纯视觉、零碰撞,种子确定)
{
  const rnd = seededRandom(7707);
  let guard = 0;
  while (BUILDINGS.filter((x) => x.style === 'silhouette').length < 24 && guard++ < 400) {
    const a = rnd() * Math.PI * 2;
    const r = 130 + rnd() * 110;
    const x = Math.round(Math.cos(a) * r);
    const z = Math.round(Math.sin(a) * r);
    // 让开主街走廊,保住街道尽头的天际线视线
    if (Math.abs(x) < 26 || Math.abs(z) < 26) continue;
    const w = 18 + Math.round(rnd() * 24);
    const d = 18 + Math.round(rnd() * 22);
    const h = 30 + Math.round(rnd() * 55);
    BUILDINGS.push(b(x, z, w, d, h, 'silhouette', { ry: (rnd() - 0.5) * 0.5 }));
  }
}

/** 高架人行天桥:桥面横跨北街(y=5.2),四条坡道沿北街两侧人行道。 */
export const OVERPASS: { deck: CityRect & { y: number }; ramps: CityRamp[] } = {
  deck: { x: 0, z: -32, w: 26, d: 5, y: 5.2 },
  ramps: [
    { x: -9.5, z: -21.5, w: 4, d: 16, dir: 's' }, // 西南坡(向南下坡,底 z=-13.5)
    { x: 9.5, z: -21.5, w: 4, d: 16, dir: 's' },  // 东南坡
    { x: -9.5, z: -42.5, w: 4, d: 16, dir: 'n' }, // 西北坡(向北下坡,底 z=-50.5)
    { x: 9.5, z: -42.5, w: 4, d: 16, dir: 'n' },  // 东北坡
  ],
};

/** 封闭地铁口(下沉台阶,拉闸;站前广场南缘)。 */
export const STATION: { x: number; z: number; ry: number } = { x: 12, z: 68, ry: Math.PI };

/** 七个场馆门位(全部在主街一层;tower = 个人房间塔入口)。 */
export const VENUES: CityVenue[] = [
  { key: 'cinema', x: 30, z: -12.6, ry: Math.PI, label: '极光影院 AURORA' },     // 东街北侧
  { key: 'netcafe', x: -30, z: -12.6, ry: Math.PI, label: '网吧 NEXUS' },        // 西街北侧
  { key: 'gameroom', x: 12.6, z: 32, ry: Math.PI / 2, label: '雀庄·东风阁' },    // 南街东侧
  { key: 'cafe', x: -12.6, z: 30, ry: -Math.PI / 2, label: '研磨咖啡馆' },       // 南街西侧
  { key: 'shop', x: -30, z: 12.6, ry: 0, label: '便利店(团子百货)' },          // 西街南侧
  { key: 'arcade', x: 30, z: 12.6, ry: 0, label: '像素宫游戏厅' },               // 东街南侧
  { key: 'tower', x: 12.6, z: -58, ry: Math.PI / 2, label: '团子塔' },           // 北街(过天桥)
];

/** 异常点(§6):A 西南巷口、B 东南巷底、C 天桥下。 */
export const ANOMALY_POINTS: CityAnomaly[] = [
  { id: 'a-alley-mouth', x: -13, z: 37.6, r: 3.5 },
  { id: 'b-alley-end', x: 42.6, z: 34, r: 4 },
  { id: 'c-overpass', x: 0, z: -28.2, r: 5 },
];
