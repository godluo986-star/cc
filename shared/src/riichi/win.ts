/**
 * 立直麻将 · 和牌分解(riichi/win.ts)
 *
 * 枚举门内牌所有「(4-副露数) 面子 + 1 雀头」分解,外加七对子 / 国士无双特判。
 * 分解结果供役种判定(yaku.ts)使用。
 */
import { RC_FACES, rcCounts, rcIsTerminalOrHonor } from './tiles';
import { rcShanten } from './shanten';

export type RcSetKind = 'run' | 'triplet';

/** 一个面子:run 的 face 为顺子起点(如 face=0 表示 123 万)。 */
export interface RcSet {
  kind: RcSetKind;
  face: number;
}

export type RcDecomp =
  | { type: 'standard'; pair: number; sets: RcSet[] }
  | { type: 'chiitoi'; pairs: number[] }
  | { type: 'kokushi'; pairFace: number };

/** counts(含和了牌)是否和了形。 */
export function rcIsWinningCounts(counts: number[], meldCount = 0): boolean {
  return rcShanten(counts, meldCount) === -1;
}

const RC_KOKUSHI_FACES: readonly number[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/**
 * 枚举全部和牌分解。counts 为门内牌(含和了牌)34 计数,
 * 张数必须等于 (4 - meldCount) * 3 + 2,否则返回 []。
 */
export function rcDecompose(counts: number[], meldCount = 0): RcDecomp[] {
  const total = counts.reduce((a, b) => a + b, 0);
  const setsNeeded = 4 - meldCount;
  if (total !== setsNeeded * 3 + 2) return [];

  const out: RcDecomp[] = [];
  const c = counts.slice();

  // ── 标准形:枚举雀头,再枚举面子 ──────────────────────────────
  const sets: RcSet[] = [];
  const enumSets = (idx: number, pair: number): void => {
    while (idx < RC_FACES && c[idx] === 0) idx++;
    if (idx >= RC_FACES) {
      if (sets.length === setsNeeded) {
        out.push({ type: 'standard', pair, sets: sets.slice().sort(cmpSet) });
      }
      return;
    }
    const n = c[idx];
    const canRun = idx < 27 && idx % 9 <= 6;
    // 该 face 取 t 个刻子(0/1),余下 r 张全部作为顺子起点
    for (const t of n >= 3 ? [1, 0] : [0]) {
      const r = n - 3 * t;
      if (r > 0 && (!canRun || c[idx + 1] < r || c[idx + 2] < r)) continue;
      c[idx] -= 3 * t + r;
      c[idx + 1] -= r;
      c[idx + 2] -= r;
      if (t) sets.push({ kind: 'triplet', face: idx });
      for (let k = 0; k < r; k++) sets.push({ kind: 'run', face: idx });
      enumSets(idx + 1, pair);
      for (let k = 0; k < r + t; k++) sets.pop();
      c[idx] += 3 * t + r;
      c[idx + 1] += r;
      c[idx + 2] += r;
    }
  };
  for (let p = 0; p < RC_FACES; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    enumSets(0, p);
    c[p] += 2;
  }

  if (meldCount === 0) {
    // ── 七对子:恰好 7 个互不相同的对子 ─────────────────────────
    const pairs: number[] = [];
    let chiitoiOk = true;
    for (let f = 0; f < RC_FACES; f++) {
      if (counts[f] === 0) continue;
      if (counts[f] === 2) pairs.push(f);
      else chiitoiOk = false;
    }
    if (chiitoiOk && pairs.length === 7) out.push({ type: 'chiitoi', pairs });

    // ── 国士无双:13 种幺九各至少 1,其一成对 ───────────────────
    let kokushiOk = true;
    let pairFace = -1;
    for (let f = 0; f < RC_FACES; f++) {
      const isK = RC_KOKUSHI_FACES.includes(f);
      if (!isK && counts[f] > 0) kokushiOk = false;
      if (isK) {
        if (counts[f] === 0 || counts[f] > 2) kokushiOk = false;
        if (counts[f] === 2) pairFace = pairFace === -1 ? f : -2;
      }
    }
    if (kokushiOk && pairFace >= 0) out.push({ type: 'kokushi', pairFace });
  }

  return out;
}

function cmpSet(a: RcSet, b: RcSet): number {
  if (a.kind !== b.kind) return a.kind === 'run' ? -1 : 1;
  return a.face - b.face;
}

/** 便捷:face 列表入口。 */
export function rcDecomposeFaces(faces: number[], meldCount = 0): RcDecomp[] {
  return rcDecompose(rcCounts(faces), meldCount);
}

/** 分解是否全部由幺九以外的牌组成(供断幺参考)。 */
export function rcSetIsSimple(set: RcSet): boolean {
  if (set.kind === 'triplet') return !rcIsTerminalOrHonor(set.face);
  return !rcIsTerminalOrHonor(set.face) && !rcIsTerminalOrHonor(set.face + 2);
}
