/**
 * 立直麻将 · 向听数(riichi/shanten.ts)
 *
 * 标准形(4 面子 + 1 雀头)递归 + 剪枝;七对子、国士无双公式计算。
 * 支持 13 张(打牌后)与 14 张(摸牌后)手牌;副露数 meldCount 参与计算
 * (每个副露占用一个面子名额,门内牌数 = 13 - 3*meldCount (+1))。
 *
 * 返回值:-1 = 和了形,0 = 听牌,n = n 向听。
 */
import { RC_FACES, rcCounts } from './tiles';

/** 标准形向听数。counts 为门内牌 34 计数;meldCount 为副露数。 */
export function rcShantenStandard(counts: number[], meldCount = 0): number {
  const need = 4 - meldCount;
  const c = counts.slice();
  let best = 8;

  const leaf = (sets: number, partials: number, pair: boolean): void => {
    const p = Math.min(partials, need - sets);
    const v = 8 - 2 * (sets + meldCount) - p - (pair ? 1 : 0);
    if (v < best) best = v;
  };

  const walk = (idx: number, left: number, sets: number, partials: number, pair: boolean): void => {
    if (best === -1) return;
    while (idx < RC_FACES && c[idx] === 0) idx++;
    if (idx >= RC_FACES) {
      leaf(sets, partials, pair);
      return;
    }
    // 剪枝:剩余 left 张牌最多还能带来的向听改善上界
    {
      const blockGain = 2 * (need - sets) + (pair ? 0 : 1);
      const tileGain = 2 * Math.floor(left / 3) + (left % 3 >= 2 ? 1 : 0);
      const p = Math.min(partials, need - sets);
      const bound = 8 - 2 * (sets + meldCount) - p - (pair ? 1 : 0) - Math.min(blockGain, tileGain);
      if (bound >= best) return;
    }
    const n = c[idx];
    const suited = idx < 27;
    const pos = idx % 9;

    // 刻子
    if (n >= 3 && sets < need) {
      c[idx] -= 3;
      walk(idx, left - 3, sets + 1, partials, pair);
      c[idx] += 3;
    }
    // 顺子
    if (suited && pos <= 6 && sets < need && c[idx + 1] > 0 && c[idx + 2] > 0) {
      c[idx]--;
      c[idx + 1]--;
      c[idx + 2]--;
      walk(idx, left - 3, sets + 1, partials, pair);
      c[idx]++;
      c[idx + 1]++;
      c[idx + 2]++;
    }
    // 对子作雀头
    if (n >= 2 && !pair) {
      c[idx] -= 2;
      walk(idx, left - 2, sets, partials, true);
      c[idx] += 2;
    }
    // 对子作搭子(向刻子发展)
    if (n >= 2 && sets + partials < need) {
      c[idx] -= 2;
      walk(idx, left - 2, sets, partials + 1, pair);
      c[idx] += 2;
    }
    // 两面/边张搭子 (idx, idx+1)
    if (suited && pos <= 7 && sets + partials < need && c[idx + 1] > 0) {
      c[idx]--;
      c[idx + 1]--;
      walk(idx, left - 2, sets, partials + 1, pair);
      c[idx]++;
      c[idx + 1]++;
    }
    // 嵌张搭子 (idx, idx+2)
    if (suited && pos <= 6 && sets + partials < need && c[idx + 2] > 0) {
      c[idx]--;
      c[idx + 2]--;
      walk(idx, left - 2, sets, partials + 1, pair);
      c[idx]++;
      c[idx + 2]++;
    }
    // 该 face 余牌全部当浮牌,处理下一 face
    const saved = c[idx];
    c[idx] = 0;
    walk(idx + 1, left - saved, sets, partials, pair);
    c[idx] = saved;
  };

  walk(0, counts.reduce((a, b) => a + b, 0), 0, 0, false);
  return best;
}

/** 七对子向听数(仅门清适用;同 face 4 张只算 1 对)。 */
export function rcShantenChiitoi(counts: number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (let f = 0; f < RC_FACES; f++) {
    if (counts[f] >= 1) kinds++;
    if (counts[f] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

const RC_KOKUSHI_FACES: readonly number[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/** 国士无双向听数(仅门清适用)。 */
export function rcShantenKokushi(counts: number[]): number {
  let kinds = 0;
  let hasPair = false;
  for (const f of RC_KOKUSHI_FACES) {
    if (counts[f] >= 1) kinds++;
    if (counts[f] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** 综合向听数:标准形 ∧(无副露时)七对 ∧ 国士。 */
export function rcShanten(counts: number[], meldCount = 0): number {
  let best = rcShantenStandard(counts, meldCount);
  if (meldCount === 0) {
    const c7 = rcShantenChiitoi(counts);
    if (c7 < best) best = c7;
    const ck = rcShantenKokushi(counts);
    if (ck < best) best = ck;
  }
  return best;
}

/** 听牌判定(13 - 3*meldCount 张)。 */
export function rcTenpai(counts: number[], meldCount = 0): boolean {
  return rcShanten(counts, meldCount) === 0;
}

/** 听牌列表:加哪些 face 可成和了形(不含手上已有 4 张的 face)。 */
export function rcWaits(counts: number[], meldCount = 0): number[] {
  const out: number[] = [];
  const c = counts.slice();
  for (let f = 0; f < RC_FACES; f++) {
    if (c[f] >= 4) continue;
    c[f]++;
    if (rcShanten(c, meldCount) === -1) out.push(f);
    c[f]--;
  }
  return out;
}

/** 便捷:face 列表版本。 */
export function rcShantenOf(faces: number[], meldCount = 0): number {
  return rcShanten(rcCounts(faces), meldCount);
}
