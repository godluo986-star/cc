/**
 * 立直麻将 · 鸣牌 / 振听 / 立直(riichi/calls.ts)
 *
 * - 吃仅限上家(rcCanChiFrom),组合生成时红 5 视为不同选项并去重。
 * - 振听:自家牌河含任一听牌张 → 荣和禁;同巡见逃(missedSinceDraw)
 *   → 荣和禁直到下次自摸(由桌面层在摸牌时清空);
 *   立直后见逃(riichiMissed)→ 永久振听,只能自摸。
 * - 立直:门清(副露只允许暗杠)+ 打出后听牌 + 点数 ≥ 1000。
 */
import { RC_FACES, rcCounts, type RcTile } from './tiles';
import type { RcFuritenInput, RcMeld } from './types';
import { rcShanten } from './shanten';

/** 吃只能吃上家:只有 discarder 的下家有资格。 */
export function rcCanChiFrom(discarderSeat: number, seat: number): boolean {
  return (discarderSeat + 1) % 4 === seat;
}

function sortTiles(tiles: RcTile[]): RcTile[] {
  return tiles.slice().sort((a, b) => a.face - b.face || a.id - b.id);
}

/** 所有可行的吃组合(按红 5 区分并去重)。调用方需先用 rcCanChiFrom 验证座位。 */
export function rcChiOptions(hand: RcTile[], discard: RcTile, from: number): RcMeld[] {
  if (discard.face >= 27) return [];
  const pos = discard.face % 9;
  const pairs: [number, number][] = [];
  if (pos >= 2) pairs.push([discard.face - 2, discard.face - 1]);
  if (pos >= 1 && pos <= 7) pairs.push([discard.face - 1, discard.face + 1]);
  if (pos <= 6) pairs.push([discard.face + 1, discard.face + 2]);
  const out: RcMeld[] = [];
  const seen = new Set<string>();
  for (const [a, b] of pairs) {
    for (const ta of hand.filter((t) => t.face === a)) {
      for (const tb of hand.filter((t) => t.face === b)) {
        const key = `${a}${ta.red ? 'r' : ''}-${b}${tb.red ? 'r' : ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind: 'chi', tiles: sortTiles([ta, tb, discard]), from, called: discard });
      }
    }
  }
  return out;
}

export function rcCanPon(hand: RcTile[], face: number): boolean {
  return hand.filter((t) => t.face === face).length >= 2;
}

/** 所有可行的碰组合(红 5 区分并去重)。 */
export function rcPonOptions(hand: RcTile[], discard: RcTile, from: number): RcMeld[] {
  const same = hand.filter((t) => t.face === discard.face);
  const out: RcMeld[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < same.length; i++) {
    for (let j = i + 1; j < same.length; j++) {
      const key = [same[i].red, same[j].red].slice().sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'pon', tiles: sortTiles([same[i], same[j], discard]), from, called: discard });
    }
  }
  return out;
}

export function rcCanMinkan(hand: RcTile[], face: number): boolean {
  return hand.filter((t) => t.face === face).length >= 3;
}

/** 明杠(手中 3 张 + 别家打出 1 张)。 */
export function rcMinkanMeld(hand: RcTile[], discard: RcTile, from: number): RcMeld | null {
  const same = hand.filter((t) => t.face === discard.face);
  if (same.length < 3) return null;
  return { kind: 'minkan', tiles: sortTiles([...same.slice(0, 3), discard]), from, called: discard };
}

/** 可暗杠的 face 列表(手中 4 张)。 */
export function rcAnkanFaces(hand: RcTile[]): number[] {
  const c = rcCounts(hand.map((t) => t.face));
  const out: number[] = [];
  for (let f = 0; f < RC_FACES; f++) if (c[f] === 4) out.push(f);
  return out;
}

export function rcAnkanMeld(hand: RcTile[], face: number): RcMeld | null {
  const same = hand.filter((t) => t.face === face);
  if (same.length < 4) return null;
  return { kind: 'ankan', tiles: sortTiles(same.slice(0, 4)), from: null, called: null };
}

/** 可加杠的 face 列表(已有碰副露 + 手中第 4 张)。 */
export function rcKakanFaces(hand: RcTile[], melds: RcMeld[]): number[] {
  const handFaces = new Set(hand.map((t) => t.face));
  return melds
    .filter((m) => m.kind === 'pon' && handFaces.has(m.tiles[0].face))
    .map((m) => m.tiles[0].face);
}

/** 加杠:把手中第 4 张并入已有的碰。 */
export function rcKakanMeld(tile: RcTile, melds: RcMeld[]): RcMeld | null {
  const pon = melds.find((m) => m.kind === 'pon' && m.tiles[0].face === tile.face);
  if (!pon) return null;
  return { kind: 'kakan', tiles: sortTiles([...pon.tiles, tile]), from: pon.from, called: pon.called };
}

/** 振听判定(true = 禁止荣和,仍可自摸)。 */
export function rcIsFuriten(s: RcFuritenInput): boolean {
  if (s.riichiMissed) return true;
  if (s.waits.length === 0) return false;
  const w = new Set(s.waits);
  if (s.discards.some((f) => w.has(f))) return true;
  if (s.missedSinceDraw && s.missedSinceDraw.some((f) => w.has(f))) return true;
  return false;
}

/**
 * 立直合法性:返回可宣言立直的打牌 face 列表(打出后仍听牌)。
 * 条件:门清(副露只能是暗杠)、点数 ≥ 1000、concealed 为摸牌后的
 * 14 - 3*melds 张。不满足返回 []。
 */
export function rcRiichiDiscards(concealed: RcTile[], melds: RcMeld[], points: number): number[] {
  if (points < 1000) return [];
  if (!melds.every((m) => m.kind === 'ankan')) return [];
  if (concealed.length !== 14 - 3 * melds.length) return [];
  const counts = rcCounts(concealed.map((t) => t.face));
  const out: number[] = [];
  for (let f = 0; f < RC_FACES; f++) {
    if (counts[f] === 0) continue;
    counts[f]--;
    if (rcShanten(counts, melds.length) === 0) out.push(f);
    counts[f]++;
  }
  return out;
}
