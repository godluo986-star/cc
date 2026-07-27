/**
 * Static world layouts, shared verbatim by server (interaction validation,
 * collision, NPC routes) and client (rendering). Personal rooms are dynamic
 * and stored in the database; only their shell is defined here.
 *
 * 户外图 = 「黄昏街区」(docs/art-direction.md §4):布局数据全部来自
 * shared/src/cityplan.ts,本文件只负责把它翻译成碰撞/交互/道具/高度区。
 */
import type { Bounds, Collider } from './math';
import type { AvatarConfig } from './types';
import { SPACE } from './constants';
import {
  BUILDINGS, CITY_BOUNDS, OVERPASS, STATION, VENUES,
} from './cityplan';

export type InteractKind =
  | 'seat' | 'door' | 'switch' | 'board' | 'whiteboard' | 'screen' | 'jukebox'
  | 'ttt' | 'lightsout' | 'vending' | 'kiosk' | 'bookshelf' | 'elevator'
  | 'xiangqi' | 'mahjong' | 'riichi';

export interface Interactable {
  id: string;
  kind: InteractKind;
  pos: [number, number, number];
  ry: number;
  label: string;
  data?: Record<string, unknown>;
}

export interface Prop {
  type: string;
  pos: [number, number, number];
  ry: number;
  /** Prefab-specific extra (variant index, size, color...). */
  data?: Record<string, unknown>;
}

export interface NpcDef {
  id: number; // negative, globally unique
  name: string;
  avatar: AvatarConfig;
  /** [x, z] waypoints walked in a loop; single waypoint = stationary. */
  waypoints: [number, number][];
  speed: number;
  /** Seconds paused at each waypoint. */
  pause: number;
  dialogueId: string;
}

interface HeightZoneBase { minX: number; maxX: number; minZ: number; maxZ: number }
/** 高度区:bridgeZ = 抛物线小桥(沿 z);ramp = 线性坡道;deck = 平台。 */
export type HeightZone =
  | (HeightZoneBase & { kind: 'bridgeZ'; cx: number; half: number; peak: number })
  | (HeightZoneBase & { kind: 'ramp'; dir: 'n' | 's' | 'e' | 'w'; y: number })
  | (HeightZoneBase & { kind: 'deck'; y: number });

export interface SpaceLayout {
  key: string;
  label: string;
  indoor: boolean;
  bounds: Bounds;
  spawn: [number, number, number, number];
  colliders: Collider[];
  interactables: Interactable[];
  props: Prop[];
  npcs: NpcDef[];
  heightZones: HeightZone[];
  /** Space has a synchronized media screen; policy 'everyone' | 'none'. */
  mediaPolicy?: 'everyone' | 'none';
  hasBall?: boolean;
}

// Dango NPCs: blush = blush tint, sprout = top sprout, body = body color,
// scarf = scarf color (see client Avatar.tsx for the field mapping).
const npcAvatar = (blush: string, sprout: string, body: string, scarf: string, hat = 0, hatColor = '#333333', hairStyle = 0): AvatarConfig => ({
  skin: blush, hair: sprout, shirt: body, pants: scarf, shoes: '#8a7a6f', hat, hatColor, glasses: false, hairStyle,
});

// ── Layout builder helper ───────────────────────────────────────────────────
class B {
  colliders: Collider[] = [];
  interactables: Interactable[] = [];
  props: Prop[] = [];
  npcs: NpcDef[] = [];
  heightZones: HeightZone[] = [];

  box(x: number, z: number, w: number, d: number) { this.colliders.push({ kind: 'box', x, z, w, d }); return this; }
  circle(x: number, z: number, r: number) { this.colliders.push({ kind: 'circle', x, z, r }); return this; }
  prop(type: string, x: number, y: number, z: number, ry = 0, data?: Record<string, unknown>) {
    this.props.push({ type, pos: [x, y, z], ry, data }); return this;
  }
  inter(id: string, kind: InteractKind, x: number, y: number, z: number, ry: number, label: string, data?: Record<string, unknown>) {
    this.interactables.push({ id, kind, pos: [x, y, z], ry, label, data }); return this;
  }
  /** Street bench: prop + 2 seats + collider. Bench faces +Z at ry=0. */
  bench(id: string, x: number, z: number, ry: number, type = 'c_bench') {
    this.prop(type, x, 0, z, ry);
    const cos = Math.cos(ry), sin = Math.sin(ry);
    for (let i = 0; i < 2; i++) {
      const lx = i === 0 ? -0.55 : 0.55;
      this.inter(`${id}-s${i}`, 'seat', x + lx * cos, 0.46, z - lx * sin, ry, '坐下');
    }
    this.box(x, z, Math.abs(cos) * 1.9 + Math.abs(sin) * 0.65, Math.abs(sin) * 1.9 + Math.abs(cos) * 0.65);
    return this;
  }
  /** Café-style round table with N chairs around it. */
  tableRound(id: string, x: number, z: number, chairs: number, r = 0.85) {
    this.prop('table_round', x, 0, z);
    this.circle(x, z, 0.5);
    for (let i = 0; i < chairs; i++) {
      const a = (i / chairs) * Math.PI * 2 + 0.4;
      const cx = x + Math.sin(a) * r;
      const cz = z + Math.cos(a) * r;
      const ry = Math.atan2(x - cx, z - cz);
      this.prop('chair', cx, 0, cz, ry);
      this.inter(`${id}-c${i}`, 'seat', cx, 0.47, cz, ry, '坐下');
    }
    return this;
  }
  /** 街灯:视觉 prop + 小圆碰撞(渲染归 P3)。 */
  lamp(x: number, z: number) { this.prop('c_lamp', x, 0, z); this.circle(x, z, 0.22); return this; }
}

// ═════════════════════════ 黄昏街区(户外) ═════════════════════════════════
function buildCity(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { ...CITY_BOUNDS };

  // ── 建筑碰撞(非剪影全部实心;剪影楼在雾里,不可达也不必碰撞)──
  for (const bd of BUILDINGS) {
    if (bd.style === 'silhouette') continue;
    b.box(bd.x, bd.z, bd.w, bd.d);
  }

  // ── 场馆门(七个,全部在主街一层;门位由 cityplan.VENUES 精排)──
  const doorTarget: Record<string, { target: string; label: string }> = {
    cinema: { target: SPACE.CINEMA, label: '进入电影院' },
    netcafe: { target: SPACE.NETCAFE, label: '进入网吧 NEXUS' },
    gameroom: { target: SPACE.GAMEROOM, label: '进入雀庄·东风阁' },
    cafe: { target: SPACE.CAFE, label: '进入咖啡馆' },
    shop: { target: SPACE.SHOP, label: '进入便利店' },
    arcade: { target: SPACE.ARCADE, label: '进入游戏厅' },
    tower: { target: SPACE.LOBBY, label: '进入团子塔' },
  };
  for (const v of VENUES) {
    const t = doorTarget[v.key];
    b.inter(`d-${v.key}`, 'door', v.x, 0, v.z, v.ry, t.label, { target: t.target });
  }

  // ── 高架天桥(北街;heightZones:4 条线性坡道 + 平台)──
  const dk = OVERPASS.deck;
  b.heightZones.push({
    minX: dk.x - dk.w / 2, maxX: dk.x + dk.w / 2,
    minZ: dk.z - dk.d / 2, maxZ: dk.z + dk.d / 2, kind: 'deck', y: dk.y,
  });
  for (const r of OVERPASS.ramps) {
    b.heightZones.push({
      minX: r.x - r.w / 2, maxX: r.x + r.w / 2,
      minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2, kind: 'ramp', dir: r.dir, y: dk.y,
    });
  }
  // 桥面栏杆兼「桥下路面封条」:2D 碰撞在任何高度都生效,所以同一对薄墙
  // 既是桥上护栏,又挡住行人从地面误入桥下(桥下留给异常点 C 的阴影构图)。
  b.box(0, -29.75, 14.4, 0.5);
  b.box(0, -34.25, 14.4, 0.5);
  b.prop('c_fence', 0, 0, -29.75, 0, { w: 14.4, bridge: true });
  b.prop('c_fence', 0, 0, -34.25, 0, { w: 14.4, bridge: true });
  // 桥墩 4 根
  for (const [px, pz] of [[-5.6, -30.8], [5.6, -30.8], [-5.6, -33.2], [5.6, -33.2]] as const) {
    b.circle(px, pz, 0.45);
    b.prop('c_pier', px, 0, pz);
  }

  // ── 封闭地铁口(站前广场南缘,下沉台阶被拉闸;台阶区不可走)──
  b.box(STATION.x, STATION.z, 7, 4.5);

  // ── 站前广场家什 ──
  b.inter('city-board', 'board', 5, 0, 58, -Math.PI / 2 - 0.4, '站前留言板', {});
  b.box(5, 58, 0.5, 1.6);
  b.inter('v-vend1', 'vending', -6.4, 0, 61, 0, '自动售货机·红', { items: ['soda', 'pizza'] });
  b.box(-6.4, 61, 0.8, 0.9);
  b.inter('v-vend2', 'vending', 36, 0, 11.5, Math.PI, '自动售货机·蓝', { items: ['soda', 'pizza'] });
  b.box(36, 11.5, 0.8, 0.9);

  // 街边长椅 ×6(站前 2 + 主街 4)
  b.bench('sb0', 3.4, 48, Math.PI);
  b.bench('sb1', -8.2, 50.4, Math.PI * 0.9);
  b.bench('sb2', 20, 9.4, Math.PI);
  b.bench('sb3', -24, 9.4, Math.PI);
  b.bench('sb4', 48, -9.4, 0);
  b.bench('sb5', -11.3, -55, -Math.PI / 2);

  // ── 路灯(间隔 22-28m 不等距;lamp = 视觉 prop + 小圆碰撞)──
  const lamps: Array<[number, number]> = [
    // 站前广场
    [14, 49.5], [-15.2, 55], [23, 64.5], [-23.5, 63.5],
    // 南街
    [-11.4, 44], [11.4, 47], [-11.4, 21], [11.4, 24], [-11.4, 79], [11.4, 88],
    // 东街
    [18, -11.6], [43, -11.5], [67, -11.4], [20, 11.6], [45, 11.6], [70, 11.5],
    // 西街
    [-19, -11.6], [-44, -11.5], [-68, -11.6], [-21, 11.6], [-46, 11.5], [-70, 11.4],
    // 北街(天桥以北)
    [-11.4, -64], [11.4, -70], [11.4, -92], [-11.4, -96],
  ];
  for (const [lx, lz] of lamps) b.lamp(lx, lz);

  // ── 道具事件组(总纲 §4.3:约每 30m 一组,禁止等距;渲染归 P3)──
  // G1 站前储物柜 + 售货机残旧款
  b.prop('c_locker', 24.5, 0, 60.2, -Math.PI / 2);
  b.prop('c_locker', 24.5, 0, 61.6, -Math.PI / 2);
  b.box(24.5, 60.9, 0.6, 3);
  b.prop('c_vend', 24.5, 0, 63.4, -Math.PI / 2, { variant: 'red' });
  b.box(24.5, 63.4, 0.7, 0.9);
  b.prop('c_trash', 24.2, 0, 58.9); b.circle(24.2, 58.9, 0.35);
  // G2 公用电话亭 + 旧海报
  b.prop('c_phone', -22.5, 0, 60, Math.PI / 2);
  b.box(-22.5, 60, 0.9, 0.9);
  b.prop('c_poster', -16, 1.4, 38.9, 0);
  // G3 施工围栏(西街北侧,一处,黄黑条)
  b.prop('c_fence', -46, 0, -9.3, 0.2); b.box(-46, -9.3, 2.2, 0.4);
  b.prop('c_fence', -48.5, 0, -9.6, -0.15); b.box(-48.5, -9.6, 2.2, 0.4);
  b.prop('c_fence', -51, 0, -9.2, 0.1); b.box(-51, -9.2, 2.2, 0.4);
  b.prop('c_trash', -49, 0, -10.6); b.circle(-49, -10.6, 0.35);
  // G4 倒下的自行车 + 墙面海报(街机厅西侧口袋地)
  b.prop('c_bike', 17, 0, 15.8, 1.2, { fallen: true }); b.circle(17, 15.8, 0.4);
  b.prop('c_poster', 22.8, 1.4, 16, -Math.PI / 2);
  b.prop('c_manhole', 14.5, 0, 13.8);
  // G5 东南巷:垃圾袋堆 + 斜靠自行车
  b.prop('c_trash', 31, 0, 23.95); b.circle(31, 23.95, 0.4);
  b.prop('c_trash', 33.5, 0, 23.9); b.circle(33.5, 23.9, 0.35);
  b.prop('c_bike', 38, 0, 33.2, 2.6); b.circle(38, 33.2, 0.35);
  // G6 西南巷:空调外机(挂墙)+ 巷底垃圾 + 倒地自行车
  b.prop('c_ac', -25.2, 2.2, 33, -Math.PI / 2);
  b.prop('c_ac', -32, 2.4, 30, Math.PI / 2);
  b.prop('c_trash', -42.8, 0, 27.5); b.circle(-42.8, 27.5, 0.4);
  b.prop('c_trash', -43.4, 0, 28.3); b.circle(-43.4, 28.3, 0.3);
  b.prop('c_bike', -35, 0, 38.2, -1.3, { fallen: true }); b.circle(-35, 38.2, 0.4);
  // G7 消防栓 + 井盖
  b.prop('c_hydrant', 8.2, 0, 16.4); b.circle(8.2, 16.4, 0.25);
  b.prop('c_manhole', 4.6, 0, 19.6);
  b.prop('c_manhole', -3.4, 0, -18.6);
  // G8 电线杆 + 横跨街道的电缆(东街/西街)
  b.prop('c_wires', 16, 0, 7.9); b.circle(16, 7.9, 0.18);
  b.prop('c_wires', 38, 0, 8.3); b.circle(38, 8.3, 0.18);
  b.prop('c_wires', 65, 0, 7.8); b.circle(65, 7.8, 0.18);
  b.prop('c_wires', -17, 0, -7.9); b.circle(-17, -7.9, 0.18);
  b.prop('c_wires', -41, 0, -8.2); b.circle(-41, -8.2, 0.18);
  // G9 西南巷海报墙
  b.prop('c_poster', -34.2, 1.5, 31.5, Math.PI / 2);
  b.prop('c_poster', -34.3, 1.1, 29.4, Math.PI / 2);
  // G10 路口红绿灯 ×4
  b.prop('c_signal', 12.6, 0, 12.6, -Math.PI * 0.75); b.circle(12.6, 12.6, 0.2);
  b.prop('c_signal', -12.6, 0, 12.6, Math.PI * 0.75); b.circle(-12.6, 12.6, 0.2);
  b.prop('c_signal', 12.6, 0, -12.6, -Math.PI * 0.25); b.circle(12.6, -12.6, 0.2);
  b.prop('c_signal', -12.6, 0, -12.6, Math.PI * 0.25); b.circle(-12.6, -12.6, 0.2);
  // G11 站前花坛槽
  b.prop('c_planter', -26, 0, 48); b.box(-26, 48, 0.9, 0.9);
  b.prop('c_planter', -25.3, 0, 54); b.box(-25.3, 54, 0.9, 0.9);
  b.prop('c_planter', -26.5, 0, 59); b.box(-26.5, 59, 0.9, 0.9);
  // G12 团子塔门前
  b.prop('c_bike', 10.6, 0, -61.5, 0.4); b.circle(10.6, -61.5, 0.35);
  b.prop('c_poster', 11.9, 1.4, -63, Math.PI / 2);
  // G13 网吧门前
  b.prop('c_vend', -24, 0, -11.6, 0, { variant: 'blue' }); b.box(-24, -11.6, 0.7, 0.8);
  b.prop('c_trash', -22.6, 0, -11.2); b.circle(-22.6, -11.2, 0.3);
  // G14 影院门前引导栏(离门口通道 2m 外)
  b.prop('c_fence', 23.5, 0, -11.3, 0.05); b.box(23.5, -11.3, 2.2, 0.35);
  // G15 天桥下(异常点 C 附近)
  b.prop('c_trash', -5.8, 0, -20.4); b.circle(-5.8, -20.4, 0.35);
  b.prop('c_manhole', -2.2, 0, -24);

  const npcs: NpcDef[] = [
    {
      id: -1, name: 'Yuki', dialogueId: 'greeter', speed: 1.1, pause: 6,
      avatar: npcAvatar('#f2a5b5', '#5a3b8c', '#cbb8d9', '#5a3b8c', 1, '#5a3b8c', 1),
      waypoints: [[7, 54], [-8, 59], [-3, 47]],
    },
    {
      id: -2, name: 'Kaito', dialogueId: 'walker', speed: 1.4, pause: 3,
      avatar: npcAvatar('#f5b8c4', '#3f7d44', '#b7cf8f', '#4a4a55', 0, '#333333', 0),
      waypoints: [[16, 9.4], [38, 9.5], [57, 9.3], [36, 9.6]],
    },
    {
      id: -5, name: 'Rin', dialogueId: 'walker', speed: 1.2, pause: 4,
      avatar: npcAvatar('#f2a5b5', '#2f3b5c', '#9fb3d9', '#33383f', 0, '#333333', 2),
      waypoints: [[-17, -9.5], [-33, -9.4], [-25, -9.6]],
    },
  ];

  return {
    key: SPACE.PLAZA, label: '黄昏街区', indoor: false, bounds,
    spawn: [0, 0, 52, Math.PI],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs, heightZones: b.heightZones, hasBall: true,
  };
}

// ═════════════════════════════ CAFÉ ═════════════════════════════════════════
function buildCafe(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -8, maxX: 8, minZ: -6, maxZ: 6 };

  b.inter('cafe-exit', 'door', 0, 0, 5.7, 0, '返回街区', { target: SPACE.PLAZA, spawn: [-11.2, 0, 30, Math.PI / 2] });
  b.inter('cafe-lights', 'switch', 1.7, 1.2, 5.85, 0, '电灯开关', { switchId: 'cafe-lights' });

  // Counter along north wall
  b.prop('cafe_counter', 0, 0, -4.6);
  b.box(0, -4.6, 6.4, 1.1);
  // Espresso machine + pastry display are part of the counter prefab.

  // Round tables
  b.tableRound('ct0', -4.6, -1.2, 3);
  b.tableRound('ct1', 4.6, -1.2, 3);

  // 棋牌角:象棋桌(西)+ 福州麻将桌(东)
  b.inter('cafe-xq', 'xiangqi', -4.2, 0, 3.2, 0, '象棋桌');
  b.box(-4.2, 3.2, 1.0, 1.0);
  for (const [sx, sry, i] of [[-1.05, Math.PI / 2, 0], [1.05, -Math.PI / 2, 1]] as const) {
    b.prop('chair', -4.2 + sx, 0, 3.2, sry);
    b.inter(`cafe-xq-s${i}`, 'seat', -4.2 + sx, 0.47, 3.2, sry, '坐下');
  }
  b.inter('cafe-mj', 'mahjong', 4.2, 0, 3.2, 0, '福州麻将桌');
  b.box(4.2, 3.2, 1.15, 1.15);
  const mjSeats: Array<[number, number, number]> = [
    [0, 1.1, Math.PI],      // 南(面向北)
    [1.1, 0, -Math.PI / 2], // 东
    [0, -1.1, 0],           // 北
    [-1.1, 0, Math.PI / 2], // 西
  ];
  mjSeats.forEach(([ox, oz, sry], i) => {
    b.prop('chair', 4.2 + ox, 0, 3.2 + oz, sry);
    b.inter(`cafe-mj-s${i}`, 'seat', 4.2 + ox, 0.47, 3.2 + oz, sry, '坐下');
  });

  // Sofa corner (west)
  b.prop('sofa', -7.0, 0, 0.8, Math.PI / 2);
  b.box(-7.0, 0.8, 0.95, 2.1);
  b.inter('cafe-sofa-s0', 'seat', -6.95, 0.44, 0.28, Math.PI / 2, '坐下');
  b.inter('cafe-sofa-s1', 'seat', -6.95, 0.44, 1.38, Math.PI / 2, '坐下');

  // Jukebox (west wall, north corner)
  b.inter('cafe-jukebox', 'jukebox', -7.4, 0, -2.8, Math.PI / 2, '点歌机');
  b.box(-7.4, -2.8, 0.8, 0.6);

  // Bookshelf + whiteboard (east wall)
  b.inter('cafe-books', 'bookshelf', 7.55, 0, -2.4, -Math.PI / 2, '书架');
  b.box(7.55, -2.4, 0.45, 1.3);
  b.inter('cafe-wb', 'whiteboard', 7.8, 1.5, 1.8, -Math.PI / 2, '今日推荐板', { boardId: 'cafe-wb' });

  // Fireplace south-west
  b.prop('fireplace', -4.5, 0, 5.75, Math.PI);
  b.box(-4.5, 5.7, 1.5, 0.5);

  b.prop('window', -8, 1.5, 2.5, Math.PI / 2, { w: 2 });
  b.prop('plant', 7.4, 0, 4.8); b.circle(7.4, 4.8, 0.3);
  b.prop('plant', -2.2, 0, 5.5); b.circle(-2.2, 5.5, 0.3);

  const npcs: NpcDef[] = [{
    id: -3, name: 'Bea', dialogueId: 'barista', speed: 0.8, pause: 4,
    avatar: npcAvatar('#e88ba0', '#8c3b24', '#f3c3cc', '#7a2e1f', 2, '#7a2e1f', 1),
    waypoints: [[-1.6, -5.3], [1.6, -5.3]],
  }];

  return {
    key: SPACE.CAFE, label: '研磨咖啡馆', indoor: true, bounds,
    spawn: [0, 0, 4.2, Math.PI],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs, heightZones: [],
  };
}

// ═════════════════════════════ CINEMA ═══════════════════════════════════════
function buildCinema(): SpaceLayout {
  // 巨幕厅:30×24 大厅、24×10 米银幕(前墙几乎满幅)、6 排阶梯座位、
  // 双过道 + 宽敞的后部休息区 —— 解决"太挤太小"。
  const b = new B();
  const bounds: Bounds = { minX: -15, maxX: 15, minZ: -12, maxZ: 12 };

  b.inter('cine-exit', 'door', 0, 0, 11.7, 0, '返回街区', { target: SPACE.PLAZA, spawn: [30, 0, -11.2, 0] });
  // 巨幕:互动锚点在银幕下沿中线;视觉尺寸(24×10)在客户端 registry 里定义
  b.inter('cine-screen', 'screen', 0, 5.8, -11.4, 0, '影院银幕');

  // 6 排 × 12 座(4-4-4 三段,双过道 x=±3.4),排距 2.1、逐排抬高 0.3
  let seatIdx = 0;
  for (let row = 0; row < 6; row++) {
    const z = -3.6 + row * 2.1;
    const lift = 0.3 * row;
    for (let col = 0; col < 12; col++) {
      const seg = Math.floor(col / 4);                       // 0 左 1 中 2 右
      const x = (seg - 1) * 5.75 + (col % 4 - 1.5) * 1.15;   // 三段各自居中,过道 2.3m
      b.prop('cinema_seat', x, lift, z, Math.PI);
      b.inter(`cine-s${seatIdx++}`, 'seat', x, 0.47 + lift, z, Math.PI, '坐下');
    }
    // 座位段碰撞(过道留空,前后可从两侧绕行)
    b.box(-7.5, z, 4.4, 0.55);
    b.box(0, z, 4.4, 0.55);
    b.box(7.5, z, 4.4, 0.55);
  }

  // 后部休息区:小卖部(东南) + 贩卖机 + 立牌
  b.prop('concession', 10.5, 0, 10, Math.PI);
  b.box(10.5, 10, 3.4, 1.0);
  b.inter('cine-vend', 'vending', 13.9, 0, 8, -Math.PI / 2, '零食贩卖机', { items: ['soda', 'pizza'] });
  b.box(13.9, 8, 0.8, 0.9);
  b.prop('rope_barrier', -8.5, 0, 10.4, 0);
  b.prop('plant', -14.2, 0, 11.2); b.circle(-14.2, 11.2, 0.3);
  b.prop('plant', 14.2, 0, 11.2); b.circle(14.2, 11.2, 0.3);
  b.prop('plant', -14.2, 0, -10.8); b.circle(-14.2, -10.8, 0.3);
  b.prop('plant', 14.2, 0, -10.8); b.circle(14.2, -10.8, 0.3);

  return {
    key: SPACE.CINEMA, label: '极光影院·巨幕厅', indoor: true, bounds,
    spawn: [0, 0, 10, Math.PI],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs: [], heightZones: [], mediaPolicy: 'everyone',
  };
}

// ═════════════════════════════ ARCADE ═══════════════════════════════════════
function buildArcade(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -7, maxX: 7, minZ: -6, maxZ: 6 };

  b.inter('arc-exit', 'door', -6.7, 0, 0, Math.PI / 2, '返回街区', { target: SPACE.PLAZA, spawn: [30, 0, 11.2, Math.PI] });
  b.inter('arcade-neon', 'switch', -6.85, 1.2, 1.8, Math.PI / 2, '霓虹开关', { switchId: 'arcade-neon' });

  // Playable machines along north wall
  b.inter('ttt1', 'ttt', -4.4, 0, -5.2, 0, 'VERSUS·井字棋');
  b.inter('lo1', 'lightsout', -1.5, 0, -5.2, 0, '关灯谜题机');
  b.inter('ttt2', 'ttt', 1.5, 0, -5.2, 0, 'VERSUS·井字棋');
  b.inter('lo2', 'lightsout', 4.4, 0, -5.2, 0, '关灯谜题机');
  b.box(0, -5.3, 12, 1.0);

  // Decorative attract-mode cabinets (east wall)
  b.prop('arcade_deco', 6.5, 0, -2.0, -Math.PI / 2, { variant: 0 });
  b.prop('arcade_deco', 6.5, 0, 0.0, -Math.PI / 2, { variant: 1 });
  b.prop('arcade_deco', 6.5, 0, 2.0, -Math.PI / 2, { variant: 2 });
  b.box(6.5, 0, 0.9, 5.2);

  // Whiteboard (west wall) + vending
  b.inter('arcade-wb', 'whiteboard', -6.8, 1.5, -2.6, Math.PI / 2, '涂鸦板', { boardId: 'arcade-wb' });
  b.inter('arcade-vend', 'vending', -6.5, 0, 3.6, Math.PI / 2, '饮料贩卖机', { items: ['soda'] });
  b.box(-6.5, 3.6, 0.8, 0.9);

  // Sofa corner (south)
  b.prop('sofa', 3.4, 0, 5.4, Math.PI);
  b.box(3.4, 5.4, 2.1, 0.95);
  b.inter('arc-sofa-s0', 'seat', 2.85, 0.44, 5.35, Math.PI, '坐下');
  b.inter('arc-sofa-s1', 'seat', 3.95, 0.44, 5.35, Math.PI, '坐下');
  b.prop('coffee_table', 3.4, 0, 3.9);
  b.circle(3.4, 3.9, 0.5);

  return {
    key: SPACE.ARCADE, label: '像素宫游戏厅', indoor: true, bounds,
    spawn: [-5.2, 0, 0, -Math.PI / 2],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs: [], heightZones: [],
  };
}

// ═════════════════════════════ SHOP ═════════════════════════════════════════
function buildShop(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -7, maxX: 7, minZ: -6, maxZ: 6 };

  b.inter('shop-exit', 'door', 6.7, 0, 0, -Math.PI / 2, '返回街区', { target: SPACE.PLAZA, spawn: [-30, 0, 11.2, Math.PI] });
  b.inter('shop-lights', 'switch', 6.85, 1.2, 1.8, -Math.PI / 2, '电灯开关', { switchId: 'shop-lights' });

  // Furniture kiosk (center)
  b.inter('shop-kiosk', 'kiosk', 0, 0, -1.5, 0, '家具购买台');
  b.circle(0, -1.5, 0.7);

  // Vending machines (north wall)
  b.inter('shop-vend1', 'vending', -3, 0, -5.5, 0, '零食贩卖机', { items: ['soda', 'pizza'] });
  b.inter('shop-vend2', 'vending', -1, 0, -5.5, 0, '咖啡机', { items: ['coffee', 'book_poems'] });
  b.box(-2, -5.5, 3, 0.9);

  // Shelving (visual) + counter with shopkeeper
  b.prop('shop_shelf', 3.2, 0, -5.4, 0); b.box(3.2, -5.4, 3.2, 0.6);
  b.prop('shop_shelf', -6.5, 0, -1.5, Math.PI / 2); b.box(-6.5, -1.5, 0.6, 3.2);
  b.prop('shop_counter', -4.4, 0, 3.6, Math.PI); b.box(-4.4, 3.6, 2.6, 0.9);
  b.prop('mirror_standing', 5.8, 0, -4.2, -Math.PI / 4);
  b.circle(5.8, -4.2, 0.4);
  b.prop('plant', -6.6, 0, 5.2); b.circle(-6.6, 5.2, 0.3);

  const npcs: NpcDef[] = [{
    id: -4, name: 'Zed', dialogueId: 'shopkeeper', speed: 0.7, pause: 5,
    avatar: npcAvatar('#f2a5b5', '#111111', '#8fc7c4', '#33383f', 0, '#333333', 2),
    waypoints: [[-4.4, 4.9], [-3.2, 4.9]],
  }];

  return {
    key: SPACE.SHOP, label: '团子百货', indoor: true, bounds,
    spawn: [5.2, 0, 0, Math.PI / 2],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs, heightZones: [],
  };
}

// ═════════════════════════════ LOBBY ════════════════════════════════════════
function buildLobby(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -8, maxX: 8, minZ: -6, maxZ: 6 };

  b.inter('lobby-exit', 'door', 0, 0, 5.7, 0, '返回街区', { target: SPACE.PLAZA, spawn: [11.2, 0, -58, -Math.PI / 2] });
  b.inter('lobby-lights', 'switch', 1.7, 1.2, 5.85, 0, '电灯开关', { switchId: 'lobby-lights' });

  // Elevator bank (north wall): two doors + call panel
  b.prop('elevator_doors', -2, 0, -5.85, 0);
  b.prop('elevator_doors', 2, 0, -5.85, 0);
  b.box(-2, -5.9, 2.2, 0.4); b.box(2, -5.9, 2.2, 0.4);
  b.inter('lobby-elevator', 'elevator', 0, 1.2, -5.8, 0, '电梯 · 拜访房间');

  // Directory board + mailboxes
  b.prop('directory', -6.2, 0, -5.6, 0); b.box(-6.2, -5.6, 1.6, 0.4);
  b.prop('mailboxes', -7.7, 1.1, -1.5, Math.PI / 2);
  b.inter('lobby-board', 'board', 7.7, 0, -1.5, -Math.PI / 2, '住户留言板', {});

  // Waiting area
  b.prop('sofa', 5.4, 0, 4.9, Math.PI); b.box(5.4, 4.9, 2.1, 0.95);
  b.inter('lob-sofa-s0', 'seat', 4.85, 0.44, 4.85, Math.PI, '坐下');
  b.inter('lob-sofa-s1', 'seat', 5.95, 0.44, 4.85, Math.PI, '坐下');
  b.prop('coffee_table', 5.4, 0, 3.4); b.circle(5.4, 3.4, 0.5);
  b.prop('plant', -7.3, 0, 5.1); b.circle(-7.3, 5.1, 0.3);
  b.prop('plant', 7.3, 0, -5.2); b.circle(7.3, -5.2, 0.3);
  b.inter('lobby-vend', 'vending', -6.6, 0, 3.8, Math.PI / 2, '饮料贩卖机', { items: ['soda', 'coffee'] });
  b.box(-6.6, 3.8, 0.8, 0.9);

  return {
    key: SPACE.LOBBY, label: '团子塔大堂', indoor: true, bounds,
    spawn: [0, 0, 4.2, Math.PI],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs: [], heightZones: [],
  };
}

// ═════════════════════════ 网吧 NEXUS(新室内) ═════════════════════════════
function buildNetcafe(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -8, maxX: 8, minZ: -6, maxZ: 6 };

  b.inter('nc-exit', 'door', 0, 0, 5.7, 0, '返回街区', { target: SPACE.PLAZA, spawn: [-30, 0, -11.2, 0] });
  b.inter('nc-lights', 'switch', 1.7, 1.2, 5.85, 0, '电灯开关', { switchId: 'nc-lights' });

  // 墙上 6m 联赛大屏(北墙;共享画面/媒体都可投上来)
  b.inter('nc-wall', 'screen', 0, 2.4, -5.85, 0, '联赛大屏');

  // 两排各 4 个电竞位:桌上斜置大屏 prop 'nc_station',坐下面向北(桌在座位北侧)
  const cols = [-5.4, -1.8, 1.8, 5.4];
  cols.forEach((x, i) => {
    b.prop('nc_station', x, 0, -3.5, 0, { row: 0, seatIdx: i });
    b.box(x, -3.5, 1.5, 0.7);
    b.inter(`nc-s${i}`, 'seat', x, 0.47, -2.6, Math.PI, '坐下');
  });
  cols.forEach((x, i) => {
    b.prop('nc_station', x, 0, 0.9, 0, { row: 1, seatIdx: 4 + i });
    b.box(x, 0.9, 1.5, 0.7);
    b.inter(`nc-s${4 + i}`, 'seat', x, 0.47, 1.8, Math.PI, '坐下');
  });

  // 饮料售货机 + 前台 + 泡面堆
  b.inter('nc-vend', 'vending', -7.4, 0, 3.4, Math.PI / 2, '饮料贩卖机', { items: ['soda'] });
  b.box(-7.4, 3.4, 0.8, 0.9);
  b.prop('nc_counter', 6.4, 0, 4.6, Math.PI); b.box(6.4, 4.6, 2.4, 0.9);
  b.prop('c_trash', 7.3, 0, -5.2); b.circle(7.3, -5.2, 0.3);

  return {
    key: SPACE.NETCAFE, label: '网吧 NEXUS', indoor: true, bounds,
    spawn: [0, 0, 4.4, Math.PI],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs: [], heightZones: [], mediaPolicy: 'everyone',
  };
}

// ═════════════════════════ 雀庄「东风阁」(新室内) ══════════════════════════
function buildGameroom(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -7, maxX: 7, minZ: -6, maxZ: 6 };

  b.inter('gr-exit', 'door', 0, 0, 5.7, 0, '返回街区', { target: SPACE.PLAZA, spawn: [11.2, 0, 32, -Math.PI / 2] });
  b.inter('gr-lights', 'switch', 1.7, 1.2, 5.85, 0, '电灯开关', { switchId: 'gr-lights' });

  // 2 张全自动日麻桌(引擎/面板归 P6;这里只出桌位数据)
  const riichiSeats: Array<[number, number, number]> = [
    [0, 1.15, Math.PI],      // 南
    [1.15, 0, -Math.PI / 2], // 东
    [0, -1.15, 0],           // 北
    [-1.15, 0, Math.PI / 2], // 西
  ];
  ([['gr-rj1', -3.4, -1.6], ['gr-rj2', 3.4, -1.6]] as const).forEach(([id, tx, tz]) => {
    b.inter(id, 'riichi', tx, 0, tz, 0, '立直麻将桌');
    b.box(tx, tz, 1.3, 1.3);
    riichiSeats.forEach(([ox, oz, sry], i) => {
      b.prop('chair', tx + ox, 0, tz + oz, sry);
      b.inter(`${id}-s${i}`, 'seat', tx + ox, 0.47, tz + oz, sry, '坐下');
    });
  });

  // 1 张象棋桌
  b.inter('gr-xq', 'xiangqi', 0, 0, 3.6, 0, '象棋桌');
  b.box(0, 3.6, 1.0, 1.0);
  for (const [sx, sry, i] of [[-1.05, Math.PI / 2, 0], [1.05, -Math.PI / 2, 1]] as const) {
    b.prop('chair', sx, 0, 3.6, sry);
    b.inter(`gr-xq-s${i}`, 'seat', sx, 0.47, 3.6, sry, '坐下');
  }

  // 茶水台(西)+ 点棒柜台(东北)+ 灯笼
  b.prop('gr_tea', -6.3, 0, 3.8, Math.PI / 2); b.box(-6.3, 3.8, 0.8, 2.2);
  b.prop('gr_counter', 6.3, 0, -4.9, -Math.PI / 2); b.box(6.3, -4.9, 1.2, 2.0);
  b.prop('gr_lantern', -6.5, 2.3, -5.3);
  b.prop('gr_lantern', 6.5, 2.3, 5.3);

  return {
    key: SPACE.GAMEROOM, label: '雀庄·东风阁', indoor: true, bounds,
    spawn: [2.4, 0, 4.8, Math.PI],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs: [], heightZones: [],
  };
}

// ═════════════════════════ PERSONAL ROOM SHELL ══════════════════════════════
export const ROOM_BOUNDS: Bounds = { minX: -6, maxX: 6, minZ: -5, maxZ: 5 };
export const ROOM_SPAWN: [number, number, number, number] = [0, 0, 3.6, Math.PI];
export const ROOM_DOOR: Interactable = {
  id: 'room-exit', kind: 'door', pos: [1.9, 0, 4.85], ry: 0, label: '返回大堂',
  data: { target: SPACE.LOBBY, spawn: [0, 0, -4.6, 0] },
};
export const ROOM_SWITCH: Interactable = {
  id: 'room-lights', kind: 'switch', pos: [0.6, 1.2, 4.9], ry: 0, label: '电灯开关',
  data: { switchId: 'room-lights' },
};

// ── Registry ────────────────────────────────────────────────────────────────
export const LAYOUTS: Record<string, SpaceLayout> = {};
for (const l of [
  buildCity(), buildCafe(), buildCinema(), buildArcade(), buildShop(), buildLobby(),
  buildNetcafe(), buildGameroom(),
]) {
  LAYOUTS[l.key] = l;
}

export function floorHeightAt(layout: SpaceLayout | null, x: number, z: number): number {
  if (!layout) return 0;
  for (const hz of layout.heightZones) {
    if (x < hz.minX || x > hz.maxX || z < hz.minZ || z > hz.maxZ) continue;
    switch (hz.kind) {
      case 'bridgeZ': {
        const t = (z - hz.cx) / hz.half;
        return Math.max(0, hz.peak * (1 - t * t));
      }
      case 'deck':
        return hz.y;
      case 'ramp': {
        // dir = 下坡朝向:'n' 向北(-z)降到 0,'s' 向南(+z),'e' 向东(+x),'w' 向西(-x)
        const tx = (x - hz.minX) / (hz.maxX - hz.minX || 1);
        const tz = (z - hz.minZ) / (hz.maxZ - hz.minZ || 1);
        const f = hz.dir === 'n' ? tz : hz.dir === 's' ? 1 - tz : hz.dir === 'e' ? 1 - tx : tx;
        return hz.y * f;
      }
    }
  }
  return 0;
}
