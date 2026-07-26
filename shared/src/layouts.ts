/**
 * Static world layouts, shared verbatim by server (interaction validation,
 * collision, NPC routes) and client (rendering). Personal rooms are dynamic
 * and stored in the database; only their shell is defined here.
 */
import type { Bounds, Collider } from './math';
import { seededRandom } from './math';
import type { AvatarConfig } from './types';
import { SPACE } from './constants';

export type InteractKind =
  | 'seat' | 'door' | 'switch' | 'board' | 'whiteboard' | 'screen' | 'jukebox'
  | 'ttt' | 'lightsout' | 'vending' | 'kiosk' | 'bookshelf' | 'elevator'
  | 'xiangqi' | 'mahjong';

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

export interface HeightZone {
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** Returns floor height inside the zone. */
  kind: 'bridgeZ';
  cx: number; half: number; peak: number;
}

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
  /** Park bench: prop + 2 seats + collider. Bench faces +Z at ry=0. */
  bench(id: string, x: number, z: number, ry: number) {
    this.prop('bench', x, 0, z, ry);
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
  lamp(x: number, z: number) { this.prop('street_lamp', x, 0, z); this.circle(x, z, 0.22); return this; }
  tree(x: number, z: number, variant: number, scale = 1) {
    this.prop('tree', x, 0, z, 0, { variant, scale });
    this.circle(x, z, 0.4 * scale);
    return this;
  }
}

// ═════════════════════════════ PLAZA ════════════════════════════════════════
function buildPlaza(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };

  // Fountain (center)
  b.circle(0, 0, 4.9);
  b.prop('fountain', 0, 0, 0);

  // Buildings: [type, cx, cz, w, d, doorX, doorZ, doorRy, target]
  const buildings: [string, number, number, number, number][] = [
    ['bld_cafe', -30, -22, 14, 11],
    ['bld_cinema', 30, -24, 18, 13],
    ['bld_arcade', 36, 10, 13, 11],
    ['bld_shop', -36, 10, 13, 11],
    ['bld_tower', 0, -43, 16, 12],
  ];
  for (const [type, cx, cz, w, d] of buildings) {
    b.prop(type, cx, 0, cz);
    b.box(cx, cz, w, d);
  }
  // Entrance doors (positioned on the plaza-facing wall, just outside collider)
  b.inter('d-cafe', 'door', -30, 0, -16.4, Math.PI, '进入咖啡馆', { target: SPACE.CAFE });
  b.inter('d-cinema', 'door', 30, 0, -17.4, Math.PI, '进入电影院', { target: SPACE.CINEMA });
  b.inter('d-arcade', 'door', 29.4, 0, 10, Math.PI / 2, '进入游戏厅', { target: SPACE.ARCADE });
  b.inter('d-shop', 'door', -29.4, 0, 10, -Math.PI / 2, '进入商店', { target: SPACE.SHOP });
  b.inter('d-tower', 'door', 0, 0, -36.9, Math.PI, '进入团子塔', { target: SPACE.LOBBY });

  // Street lamps around fountain + along paths
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    b.lamp(Math.sin(a) * 9.5, Math.cos(a) * 9.5);
  }
  b.lamp(-18, -14); b.lamp(18, -14); b.lamp(-20, 14); b.lamp(20, 14);
  b.lamp(-8, 30); b.lamp(8, 44); b.lamp(-26, 34); b.lamp(28, 34);

  // Benches around the fountain
  b.bench('pb0', -7.4, 0, Math.PI / 2 + Math.PI);
  b.bench('pb1', 7.4, 0, -Math.PI / 2 + Math.PI);
  b.bench('pb2', 0, -7.4, 0);
  b.bench('pb3', 0, 7.4, Math.PI);

  // Message board near spawn
  b.inter('plaza-board', 'board', 5.2, 0, 9.5, -Math.PI / 2 - 0.4, '社区留言板', {});
  b.box(5.2, 9.5, 0.5, 1.6);

  // ── Park (southern half) ──
  // Pond: capsule of two lobes with a bridge crossing at x=16 along Z.
  b.prop('pond', 16, 0, 30);
  b.prop('bridge', 16, 0, 30);
  // Water colliders (two lobes, leaving the bridge deck walkable)
  b.circle(11.5, 30, 3.8);
  b.circle(20.5, 30, 3.8);
  b.heightZones.push({ minX: 15, maxX: 17, minZ: 25.4, maxZ: 34.6, kind: 'bridgeZ', cx: 30, half: 4.6, peak: 0.55 });

  // Picnic table
  b.prop('picnic', -16, 0, 27);
  b.box(-16, 27, 1.8, 1.2);
  b.inter('picnic-s0', 'seat', -16.95, 0.45, 27, Math.PI / 2, '坐下');
  b.inter('picnic-s1', 'seat', -15.05, 0.45, 27, -Math.PI / 2, '坐下');

  // Park benches
  b.bench('kb0', -10, 22, Math.PI * 0.82);
  b.bench('kb1', 6, 24, Math.PI * 1.1);
  b.bench('kb2', 24, 24, Math.PI * 1.25);
  b.bench('kb3', -22, 38, Math.PI * 0.4);

  // Flower beds
  b.prop('flowerbed', -6, 0, 34); b.circle(-6, 34, 1.5);
  b.prop('flowerbed', 26, 0, 40); b.circle(26, 40, 1.5);
  b.prop('flowerbed', -30, 0, 24); b.circle(-30, 24, 1.5);

  // Trees: deterministic scatter in the park + street lines
  const rnd = seededRandom(1337);
  let placed = 0;
  let guard = 0;
  while (placed < 26 && guard++ < 400) {
    const x = -44 + rnd() * 88;
    const z = 18 + rnd() * 36;
    // keep clear of pond, picnic, paths and props
    if (Math.hypot(x - 16, z - 30) < 7.5) continue;
    if (Math.hypot(x + 16, z - 27) < 3.5) continue;
    if (Math.abs(x) < 3.5) continue; // main south path
    if (b.props.some((p) => p.type === 'tree' && Math.hypot(p.pos[0] - x, p.pos[2] - z) < 4.5)) continue;
    b.tree(x, z, placed % 3, 0.85 + rnd() * 0.5);
    placed++;
  }
  // Street trees flanking north walkway
  for (const x of [-14, -8, 8, 14]) { b.tree(x, -14, 1, 1.0); }
  for (const x of [-46, -24, 24, 46]) { b.tree(x, -4, 0, 1.1); }

  // Perimeter hedge (visual) + world edge fence colliders handled by bounds
  b.prop('hedge_ring', 0, 0, 0);

  const npcs: NpcDef[] = [
    {
      id: -1, name: 'Nova', dialogueId: 'greeter', speed: 1.1, pause: 6,
      avatar: npcAvatar('#f2a5b5', '#5a3b8c', '#c9b3f0', '#5a3b8c', 1, '#5a3b8c', 1),
      waypoints: [[3, 13], [-4, 15], [-2, 9]],
    },
    {
      id: -2, name: 'Milo', dialogueId: 'walker', speed: 1.5, pause: 3,
      avatar: npcAvatar('#f5b8c4', '#3f7d44', '#c8ecc9', '#4a4a55', 0, '#333333', 0),
      waypoints: [[10, 8], [22, 18], [16, 24], [4, 30], [-12, 32], [-20, 20], [-10, 10]],
    },
  ];

  return {
    key: SPACE.PLAZA, label: '团子广场', indoor: false, bounds,
    spawn: [0, 0, 13, Math.PI],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs, heightZones: b.heightZones, hasBall: true,
  };
}

// ═════════════════════════════ CAFÉ ═════════════════════════════════════════
function buildCafe(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -8, maxX: 8, minZ: -6, maxZ: 6 };

  b.inter('cafe-exit', 'door', 0, 0, 5.7, 0, '返回广场', { target: SPACE.PLAZA, spawn: [-30, 0, -14.6, 0] });
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
    avatar: npcAvatar('#e88ba0', '#8c3b24', '#f5e6d3', '#7a2e1f', 2, '#7a2e1f', 1),
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
  const b = new B();
  const bounds: Bounds = { minX: -10, maxX: 10, minZ: -9, maxZ: 9 };

  b.inter('cine-exit', 'door', 0, 0, 8.7, 0, '返回广场', { target: SPACE.PLAZA, spawn: [30, 0, -15.6, 0] });
  b.inter('cine-screen', 'screen', 0, 2.2, -8.4, 0, '影院银幕');

  // Seat rows: 4 rows × 8 seats, center aisle
  let seatIdx = 0;
  for (let row = 0; row < 4; row++) {
    const z = -1.5 + row * 1.7;
    for (let col = 0; col < 8; col++) {
      const x = (col < 4 ? -4.4 + col * 1.15 : 1.0 + (col - 4) * 1.15);
      b.prop('cinema_seat', x, 0.24 * row, z, Math.PI);
      b.inter(`cine-s${seatIdx++}`, 'seat', x, 0.47 + 0.24 * row, z, Math.PI, '坐下');
    }
    b.box(-2.7, z, 4.1, 0.55);
    b.box(2.7, z, 4.1, 0.55);
  }

  // Concession stand (south-east) with vending machine
  b.prop('concession', 6.5, 0, 7.2, Math.PI);
  b.box(6.5, 7.2, 3.4, 1.0);
  b.inter('cine-vend', 'vending', 9.2, 0, 5.6, -Math.PI / 2, '零食贩卖机', { items: ['soda', 'pizza'] });
  b.box(9.2, 5.6, 0.8, 0.9);

  b.prop('rope_barrier', -5.5, 0, 7.4, 0);
  b.prop('plant', -9.3, 0, 8.2); b.circle(-9.3, 8.2, 0.3);
  b.prop('plant', 9.3, 0, 8.2); b.circle(9.3, 8.2, 0.3);

  return {
    key: SPACE.CINEMA, label: '极光影院', indoor: true, bounds,
    spawn: [0, 0, 7.2, Math.PI],
    colliders: b.colliders, interactables: b.interactables, props: b.props,
    npcs: [], heightZones: [], mediaPolicy: 'everyone',
  };
}

// ═════════════════════════════ ARCADE ═══════════════════════════════════════
function buildArcade(): SpaceLayout {
  const b = new B();
  const bounds: Bounds = { minX: -7, maxX: 7, minZ: -6, maxZ: 6 };

  b.inter('arc-exit', 'door', -6.7, 0, 0, Math.PI / 2, '返回广场', { target: SPACE.PLAZA, spawn: [28.2, 0, 10, Math.PI / 2] });
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

  b.inter('shop-exit', 'door', 6.7, 0, 0, -Math.PI / 2, '返回广场', { target: SPACE.PLAZA, spawn: [-28.2, 0, 10, -Math.PI / 2] });
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
    avatar: npcAvatar('#f2a5b5', '#111111', '#f5e28a', '#33383f', 0, '#333333', 2),
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

  b.inter('lobby-exit', 'door', 0, 0, 5.7, 0, '返回广场', { target: SPACE.PLAZA, spawn: [0, 0, -35.4, 0] });
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
for (const l of [buildPlaza(), buildCafe(), buildCinema(), buildArcade(), buildShop(), buildLobby()]) {
  LAYOUTS[l.key] = l;
}

export function floorHeightAt(layout: SpaceLayout | null, x: number, z: number): number {
  if (!layout) return 0;
  for (const hz of layout.heightZones) {
    if (x >= hz.minX && x <= hz.maxX && z >= hz.minZ && z <= hz.maxZ) {
      const t = (z - hz.cx) / hz.half;
      return Math.max(0, hz.peak * (1 - t * t));
    }
  }
  return 0;
}
