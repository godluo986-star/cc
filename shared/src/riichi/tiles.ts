/**
 * 立直麻将 · 牌面与实体牌(riichi/tiles.ts)
 *
 * face 编码 0-33:
 *   0-8   = 1-9 万 · 9-17 = 1-9 筒 · 18-26 = 1-9 索
 *   27-30 = 东 南 西 北 · 31-33 = 白 发 中
 *
 * 实体牌 136 张,id = face*4 + copy(copy 0-3)。
 * 红宝牌(赤ドラ):红5万 / 红5筒 / 红5索 各 1 张,占用对应 5 的 copy 0,
 * 即每种 5 为「1 红 + 3 普通」。
 *
 * 洗牌使用注入的 rng(() => [0,1)),配合 rcSeededRng(seed) 可完全确定性复现。
 */

export const RC_FACES = 34;
export const RC_TILE_COUNT = 136;

/** 可以带红宝牌的 face:5万 / 5筒 / 5索。 */
export const RC_RED_CAPABLE: readonly number[] = [4, 13, 22];

/** 实体牌:face 为牌面(0-33),red 标记红宝牌。 */
export interface RcTile {
  id: number;
  face: number;
  red: boolean;
}

/** 注入式随机数发生器,返回 [0,1)。 */
export type RcRng = () => number;

/** 由实体牌 id(0-135)还原实体牌。 */
export function rcTileFromId(id: number): RcTile {
  const face = Math.floor(id / 4);
  const red = id % 4 === 0 && RC_RED_CAPABLE.includes(face);
  return { id, face, red };
}

/** 全部 136 张实体牌(按 id 升序,未洗)。 */
export function rcAllTiles(): RcTile[] {
  const tiles: RcTile[] = [];
  for (let id = 0; id < RC_TILE_COUNT; id++) tiles.push(rcTileFromId(id));
  return tiles;
}

/** mulberry32 —— 种子确定性 rng。 */
export function rcSeededRng(seed: number): RcRng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌(返回新数组,不改原数组)。 */
export function rcShuffle<T>(items: readonly T[], rng: RcRng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function rcSuit(face: number): 'm' | 'p' | 's' | 'z' {
  if (face < 9) return 'm';
  if (face < 18) return 'p';
  if (face < 27) return 's';
  return 'z';
}

/** 数牌返回 1-9,字牌返回 0。 */
export function rcNum(face: number): number {
  return face < 27 ? (face % 9) + 1 : 0;
}

export function rcIsHonor(face: number): boolean {
  return face >= 27;
}

/** 幺九牌(1/9/字)。 */
export function rcIsTerminalOrHonor(face: number): boolean {
  if (face >= 27) return true;
  const n = face % 9;
  return n === 0 || n === 8;
}

const RC_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const RC_HONOR_NAMES = ['东', '南', '西', '北', '白', '发', '中'];

/** 中文名:一万 … 九索 / 东南西北白发中;red=true 时前缀「红」。 */
export function rcTileName(face: number, red = false): string {
  let base: string;
  if (face < 9) base = `${RC_NUMS[face]}万`;
  else if (face < 18) base = `${RC_NUMS[face - 9]}筒`;
  else if (face < 27) base = `${RC_NUMS[face - 18]}索`;
  else base = RC_HONOR_NAMES[face - 27];
  return red ? `红${base}` : base;
}

/** Unicode 麻将牌字符(🀇 等)。 */
export function rcTileEmoji(face: number): string {
  if (face < 9) return String.fromCodePoint(0x1f007 + face); // 万
  if (face < 18) return String.fromCodePoint(0x1f019 + face - 9); // 筒
  if (face < 27) return String.fromCodePoint(0x1f010 + face - 18); // 索
  if (face < 31) return String.fromCodePoint(0x1f000 + face - 27); // 东南西北
  return [String.fromCodePoint(0x1f006), String.fromCodePoint(0x1f005), String.fromCodePoint(0x1f004)][face - 31]; // 白发中
}

/** face 列表 → 34 长度计数数组。 */
export function rcCounts(faces: number[]): number[] {
  const c = Array<number>(RC_FACES).fill(0);
  for (const f of faces) c[f]++;
  return c;
}

/** 宝牌指示牌 → 宝牌 face(9→1 循环;东南西北循环;白→发→中→白)。 */
export function rcDoraFace(indicator: number): number {
  if (indicator < 27) {
    const base = Math.floor(indicator / 9) * 9;
    return base + ((indicator - base + 1) % 9);
  }
  if (indicator < 31) return 27 + ((indicator - 27 + 1) % 4);
  return 31 + ((indicator - 31 + 1) % 3);
}

const RC_SUIT_BASE: Record<string, number> = { m: 0, p: 9, s: 18, z: 27 };

/**
 * 牌谱记法 → 实体牌:'123m055p77z' 之类。
 * 数字后跟花色字母 m/p/s/z;'0m/0p/0s' 表示红 5;z 的 1-7 = 东南西北白发中。
 * 实体 id 按出现顺序取该 face 未用的 copy(红 5 固定 copy 0)。
 */
export function rcParseTiles(text: string): RcTile[] {
  const out: RcTile[] = [];
  const nextCopy: Record<number, number> = {};
  let digits: number[] = [];
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      digits.push(ch.charCodeAt(0) - 48);
      continue;
    }
    if (ch === ' ') continue;
    const base = RC_SUIT_BASE[ch];
    if (base === undefined) throw new Error(`无法解析的牌谱字符: ${ch}`);
    for (const d of digits) {
      if (d === 0) {
        if (ch === 'z') throw new Error('字牌没有红宝牌');
        const face = base + 4;
        out.push({ id: face * 4, face, red: true });
      } else {
        if (ch === 'z' && d > 7) throw new Error(`字牌只有 1-7: ${d}z`);
        const face = base + d - 1;
        const start = RC_RED_CAPABLE.includes(face) ? 1 : 0;
        const copy = nextCopy[face] ?? start;
        nextCopy[face] = copy + 1;
        out.push({ id: face * 4 + Math.min(copy, 3), face, red: false });
      }
    }
    digits = [];
  }
  if (digits.length) throw new Error('牌谱缺少花色后缀');
  return out;
}

/** 牌谱记法 → face 列表(红 5 视为普通 5 face)。 */
export function rcParseFaces(text: string): number[] {
  return rcParseTiles(text).map((t) => t.face);
}
