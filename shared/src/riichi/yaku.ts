/**
 * 立直麻将 · 役种判定(riichi/yaku.ts)
 *
 * 覆盖:立直、一发、门前清自摸和、断幺九、平和、役牌(白发中/场风/自风)、
 * 对对和、七对子、一杯口、三色同顺、一气通贯、混一色、清一色、
 * 岭上开花、海底摸月、河底捞鱼、国士无双(役满)。
 * 宝牌 / 红宝牌 / 里宝牌单独计数(不是役,只计番;无役时不能和 → rcHasYaku)。
 *
 * 一发 / 岭上 / 海底 / 河底等时机类条件由调用方(桌面层)以布尔旗标传入,
 * 本模块只负责按旗标计役。
 */
import { rcCounts, rcDoraFace, rcIsTerminalOrHonor, type RcTile } from './tiles';
import { rcDecompose, type RcDecomp, type RcSet } from './win';
import { rcSimpleFu } from './score';
import type { RcMeld, RcWinInput, RcYaku } from './types';

export interface RcDoraCount {
  dora: number;
  aka: number;
  ura: number;
}

export interface RcWinResult {
  yaku: RcYaku[];
  /** 是否有役(宝牌不算役;false = 不能和)。 */
  hasYaku: boolean;
  dora: RcDoraCount;
  /** 总番 = 役番 + 宝牌番(有役时);役满时 = 13 × 役满数。 */
  han: number;
  fu: number;
  yakumanCount: number;
  decomposition: RcDecomp;
}

const YAKUHAI_DRAGON_NAMES: Record<number, string> = { 31: '役牌 白', 32: '役牌 发', 33: '役牌 中' };

function rcMeldSet(meld: RcMeld): RcSet {
  if (meld.kind === 'chi') {
    const start = Math.min(...meld.tiles.map((t) => t.face));
    return { kind: 'run', face: start };
  }
  return { kind: 'triplet', face: meld.tiles[0].face };
}

function flagYaku(input: RcWinInput, menzen: boolean): RcYaku[] {
  const y: RcYaku[] = [];
  if (menzen && input.riichi) y.push({ name: '立直', han: 1 });
  if (menzen && input.riichi && input.ippatsu) y.push({ name: '一发', han: 1 });
  if (menzen && input.tsumo) y.push({ name: '门前清自摸和', han: 1 });
  if (input.tsumo && input.rinshan) y.push({ name: '岭上开花', han: 1 });
  if (input.tsumo && input.haitei) y.push({ name: '海底摸月', han: 1 });
  if (!input.tsumo && input.houtei) y.push({ name: '河底捞鱼', han: 1 });
  return y;
}

/** 混一色/清一色(全字牌手按混一色计 —— 简化,字一色未实现)。 */
function suitYaku(allFaces: number[], menzen: boolean): RcYaku | null {
  const suits = new Set<number>();
  let honors = false;
  for (const f of allFaces) {
    if (f >= 27) honors = true;
    else suits.add(Math.floor(f / 9));
  }
  if (suits.size > 1) return null;
  if (suits.size === 1 && !honors) return { name: '清一色', han: menzen ? 6 : 5 };
  if (honors) return { name: '混一色', han: menzen ? 3 : 2 };
  return null;
}

function isYakuhaiPair(face: number, roundWind: number, seatWind: number): boolean {
  return face >= 31 || face === roundWind || face === seatWind;
}

function buildResult(d: RcDecomp, input: RcWinInput, menzen: boolean, allTiles: RcTile[]): RcWinResult {
  const yaku: RcYaku[] = [];
  let pinfu = false;
  const allFaces = allTiles.map((t) => t.face);

  if (d.type === 'kokushi') {
    yaku.push({ name: '国士无双', han: 13, yakuman: true });
  } else {
    yaku.push(...flagYaku(input, menzen));
    if (allFaces.every((f) => !rcIsTerminalOrHonor(f))) yaku.push({ name: '断幺九', han: 1 });

    if (d.type === 'chiitoi') {
      yaku.push({ name: '七对子', han: 2 });
    } else {
      const meldSets = input.melds.map(rcMeldSet);
      const allSets = [...d.sets, ...meldSets];
      const runs = allSets.filter((s) => s.kind === 'run');
      const trips = allSets.filter((s) => s.kind === 'triplet');

      // 平和:门清、四顺子、雀头非役牌、两面听
      if (menzen && input.melds.length === 0 && trips.length === 0 && !isYakuhaiPair(d.pair, input.roundWind, input.seatWind)) {
        const w = input.winTile.face;
        pinfu = d.sets.some(
          (s) =>
            s.kind === 'run' &&
            ((w === s.face && s.face % 9 !== 6) || (w === s.face + 2 && s.face % 9 !== 0)),
        );
        if (pinfu) yaku.push({ name: '平和', han: 1 });
      }

      // 一杯口(门清;两组相同顺子;两杯口未实现,仍按 1 番)
      if (menzen) {
        const runCount = new Map<number, number>();
        for (const s of d.sets) if (s.kind === 'run') runCount.set(s.face, (runCount.get(s.face) ?? 0) + 1);
        if ([...runCount.values()].some((n) => n >= 2)) yaku.push({ name: '一杯口', han: 1 });
      }

      // 役牌(三元 / 场风 / 自风;连风牌记两个役各 1 番)
      for (const t of trips) {
        const name = YAKUHAI_DRAGON_NAMES[t.face];
        if (name) yaku.push({ name, han: 1 });
        if (t.face === input.roundWind) yaku.push({ name: '场风', han: 1 });
        if (t.face === input.seatWind && t.face >= 27) yaku.push({ name: '自风', han: 1 });
      }

      // 三色同顺
      const runStarts = new Set(runs.map((r) => r.face));
      for (let n = 0; n <= 6; n++) {
        if (runStarts.has(n) && runStarts.has(n + 9) && runStarts.has(n + 18)) {
          yaku.push({ name: '三色同顺', han: menzen ? 2 : 1 });
          break;
        }
      }
      // 一气通贯
      for (const b of [0, 9, 18]) {
        if (runStarts.has(b) && runStarts.has(b + 3) && runStarts.has(b + 6)) {
          yaku.push({ name: '一气通贯', han: menzen ? 2 : 1 });
          break;
        }
      }
      // 对对和
      if (trips.length === 4) yaku.push({ name: '对对和', han: 2 });
    }

    const suit = suitYaku(allFaces, menzen);
    if (suit) yaku.push(suit);
  }

  const yakumanEntries = yaku.filter((y) => y.yakuman);
  const yakumanCount = yakumanEntries.length;
  const finalYaku = yakumanCount > 0 ? yakumanEntries : yaku;
  const hasYaku = finalYaku.length > 0;

  let dora: RcDoraCount = { dora: 0, aka: 0, ura: 0 };
  let han: number;
  if (yakumanCount > 0) {
    han = 13 * yakumanCount;
  } else {
    dora = {
      dora: countDora(allTiles, input.doraIndicators),
      aka: allTiles.filter((t) => t.red).length,
      ura: input.riichi ? countDora(allTiles, input.uraIndicators) : 0,
    };
    const yakuHan = finalYaku.reduce((a, y) => a + y.han, 0);
    han = yakuHan + (hasYaku ? dora.dora + dora.aka + dora.ura : 0);
  }

  const fu = rcSimpleFu({ chiitoi: d.type === 'chiitoi', pinfu, menzen, tsumo: input.tsumo });
  return { yaku: finalYaku, hasYaku, dora, han, fu, yakumanCount, decomposition: d };
}

function countDora(tiles: RcTile[], indicators: number[] | undefined): number {
  if (!indicators || indicators.length === 0) return 0;
  const doraFaces = indicators.map(rcDoraFace);
  let n = 0;
  for (const t of tiles) for (const f of doraFaces) if (t.face === f) n++;
  return n;
}

function betterResult(a: RcWinResult, b: RcWinResult): boolean {
  if (a.yakumanCount !== b.yakumanCount) return a.yakumanCount > b.yakumanCount;
  if (a.han !== b.han) return a.han > b.han;
  return a.fu > b.fu;
}

/**
 * 和牌综合判定:枚举所有分解取最高番(番同取高符)。
 * 非和牌形或牌数不符返回 null。无役时仍返回结果但 hasYaku=false(不能和)。
 */
export function rcEvaluateWin(input: RcWinInput): RcWinResult | null {
  if (input.concealed.length !== 14 - 3 * input.melds.length) return null;
  const counts = rcCounts(input.concealed.map((t) => t.face));
  const decomps = rcDecompose(counts, input.melds.length);
  if (decomps.length === 0) return null;
  const menzen = input.melds.every((m) => m.kind === 'ankan');
  const allTiles = [...input.concealed, ...input.melds.flatMap((m) => m.tiles)];
  let best: RcWinResult | null = null;
  for (const d of decomps) {
    const r = buildResult(d, input, menzen, allTiles);
    if (!best || betterResult(r, best)) best = r;
  }
  return best;
}

/** 是否有役(可以和)。非和牌形返回 false。 */
export function rcHasYaku(input: RcWinInput): boolean {
  return rcEvaluateWin(input)?.hasYaku ?? false;
}
