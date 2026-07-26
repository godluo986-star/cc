/**
 * Fuzhou-style mahjong (福州麻将) core, shared by server and client.
 * 136 tiles; NO chi (吃) — Fuzhou rules; pong/kong/hu plus the signature
 * gold mechanic: after dealing, a tile is flipped and that face becomes
 * 金 (wild). Holding three golds is an instant win (三金倒).
 * Simplifications (documented in README): no 游金/抢金, no scoring tables —
 * flat credit rewards; no added-kong.
 *
 * Tile face ids 0-33:
 *   0-8   万 1-9 · 9-17 条 1-9 · 18-26 筒 1-9
 *   27-30 东南西北 · 31-33 中发白
 */
import type { PublicProfile } from './types';

export const MJ_FACES = 34;

export function mjFullWall(): number[] {
  const wall: number[] = [];
  for (let f = 0; f < MJ_FACES; f++) for (let i = 0; i < 4; i++) wall.push(f);
  return wall;
}

const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function mjTileName(face: number): string {
  if (face < 9) return `${NUMS[face]}万`;
  if (face < 18) return `${face - 8}条`;
  if (face < 27) return `${face - 17}筒`;
  return ['东', '南', '西', '北', '中', '发', '白'][face - 27];
}
export function mjSuit(face: number): 'wan' | 'tiao' | 'tong' | 'honor' {
  if (face < 9) return 'wan';
  if (face < 18) return 'tiao';
  if (face < 27) return 'tong';
  return 'honor';
}

/** Counts array from a tile list. */
export function mjCounts(tiles: number[]): number[] {
  const c = Array(MJ_FACES).fill(0);
  for (const t of tiles) c[t]++;
  return c;
}

const isSuited = (f: number) => f < 27;
const suitBase = (f: number) => Math.floor(f / 9) * 9;

/** Can `counts` (+ `golds` wild tiles) form N sets (triplets/runs)? */
function canFormSets(counts: number[], golds: number, idx = 0): boolean {
  while (idx < MJ_FACES && counts[idx] === 0) idx++;
  if (idx >= MJ_FACES) return golds % 3 === 0;
  const c = counts[idx];

  // option 1: triplet at idx (topping up with golds)
  for (let use = Math.min(3, c); use >= 1; use--) {
    const need = 3 - use;
    if (golds >= need) {
      counts[idx] -= use;
      if (canFormSets(counts, golds - need, idx)) { counts[idx] += use; return true; }
      counts[idx] += use;
    }
  }
  // option 2: run starting at idx (suited, within the same suit)
  if (isSuited(idx) && idx - suitBase(idx) <= 6) {
    const n1 = idx + 1, n2 = idx + 2;
    const have1 = counts[n1] > 0 ? 1 : 0;
    const have2 = counts[n2] > 0 ? 1 : 0;
    const need = (1 - have1) + (1 - have2);
    if (golds >= need) {
      counts[idx]--; counts[n1] -= have1; counts[n2] -= have2;
      if (canFormSets(counts, golds - need, idx)) {
        counts[idx]++; counts[n1] += have1; counts[n2] += have2;
        return true;
      }
      counts[idx]++; counts[n1] += have1; counts[n2] += have2;
    }
  }
  return false;
}

/**
 * Standard win: 4 sets + 1 pair from 14 tiles, with gold tiles usable as any
 * tile. `tiles` should include the drawn/claimed tile (length 14 - 3*melds).
 */
export function mjCanWin(tiles: number[], goldFace: number): boolean {
  const golds = tiles.filter((t) => t === goldFace).length;
  const rest = tiles.filter((t) => t !== goldFace);
  const counts = mjCounts(rest);
  // choose the pair: two natural, one + gold, or two golds
  for (let f = 0; f < MJ_FACES; f++) {
    if (counts[f] >= 2) {
      counts[f] -= 2;
      if (canFormSets(counts, golds)) { counts[f] += 2; return true; }
      counts[f] += 2;
    }
    if (counts[f] >= 1 && golds >= 1) {
      counts[f] -= 1;
      if (canFormSets(counts, golds - 1)) { counts[f] += 1; return true; }
      counts[f] += 1;
    }
  }
  if (golds >= 2 && canFormSets(counts, golds - 2)) return true;
  return false;
}

/** 三金倒: holding three golds wins immediately. */
export function mjSanJinDao(tiles: number[], goldFace: number): boolean {
  return tiles.filter((t) => t === goldFace).length >= 3;
}

// ── Views ───────────────────────────────────────────────────────────────────
export interface MjMeld { kind: 'pong' | 'kong'; tile: number; from: number; }
export interface MjSeatPublic {
  profile: PublicProfile | null;
  isBot: boolean;
  handCount: number;
  melds: MjMeld[];
  discards: number[];
}
export type MjWinKind = 'hu' | 'zimo' | 'sanjindao' | null;
export interface MahjongPublic {
  tableId: string;
  phase: 'waiting' | 'playing' | 'finished';
  seats: [MjSeatPublic, MjSeatPublic, MjSeatPublic, MjSeatPublic];
  turn: number;
  goldFace: number; // -1 before start
  wallCount: number;
  dealer: number;
  winner: number;   // -1 none, -2 wall-exhausted draw, else seat idx
  winKind: MjWinKind;
  lastDiscard: { seat: number; tile: number } | null;
  claimDeadline: number | null;
}
export interface MahjongPrivate {
  mySeat: number;
  hand: number[];
  drawn: number | null;
  canHu: boolean;
  canPong: boolean;
  canKong: boolean;
  mustAct: boolean; // it's my claim window or my discard turn
}
export interface MahjongView { pub: MahjongPublic; priv: MahjongPrivate | null; }
export type MjAction = 'sit' | 'leave' | 'start' | 'discard' | 'pong' | 'kong' | 'hu' | 'pass';
