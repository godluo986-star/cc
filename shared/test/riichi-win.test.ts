import { describe, it, expect } from 'vitest';
import { rcCounts, rcDecompose, rcIsWinningCounts, rcParseFaces } from '../src/riichi';

const counts = (s: string) => rcCounts(rcParseFaces(s));

describe('立直麻将 · 和牌分解', () => {
  it('刻子/顺子二义手:111222333789m44p 有两种标准分解', () => {
    const d = rcDecompose(counts('111222333789m44p'));
    expect(d).toHaveLength(2);
    const kinds = d.map((x) => (x.type === 'standard' ? x.sets.filter((s) => s.kind === 'triplet').length : -1)).sort();
    expect(kinds).toEqual([0, 3]); // 一种全顺子 + 789,一种三刻子 + 789
    for (const x of d) {
      expect(x.type).toBe('standard');
      if (x.type === 'standard') expect(x.pair).toBe(rcParseFaces('4p')[0]);
    }
  });

  it('二杯口形:标准分解与七对分解并存', () => {
    const d = rcDecompose(counts('112233445566m77z'));
    const types = d.map((x) => x.type).sort();
    expect(types).toEqual(['chiitoi', 'standard']);
    const std = d.find((x) => x.type === 'standard');
    if (std && std.type === 'standard') {
      expect(std.sets.every((s) => s.kind === 'run')).toBe(true);
      expect(std.pair).toBe(33); // 中 对
    }
  });

  it('七对子分解', () => {
    const d = rcDecompose(counts('1199m2288p3355s77z'));
    expect(d).toHaveLength(1);
    expect(d[0].type).toBe('chiitoi');
    if (d[0].type === 'chiitoi') expect(d[0].pairs).toHaveLength(7);
  });

  it('国士无双分解', () => {
    const d = rcDecompose(counts('19m19p19s12345677z'));
    expect(d).toHaveLength(1);
    expect(d[0].type).toBe('kokushi');
    if (d[0].type === 'kokushi') expect(d[0].pairFace).toBe(33); // 中 对
  });

  it('副露手分解:面子数按副露折减', () => {
    const d = rcDecompose(counts('11123m45p3p'), 2); // 8 张 = 2 面子 + 雀头
    expect(d.length).toBeGreaterThan(0);
    for (const x of d) expect(x.type).toBe('standard');
  });

  it('非和牌形 → 空分解 / 非和牌', () => {
    expect(rcDecompose(counts('123456789m1234p'))).toEqual([]); // 13 张
    expect(rcDecompose(counts('123456789m1245p9s'))).toEqual([]); // 14 张不成和
    expect(rcIsWinningCounts(counts('123456789m12344p'))).toBe(true);
    expect(rcIsWinningCounts(counts('123456789m1245p9s'))).toBe(false);
    // 四张同牌不是两对(七对判定)
    expect(rcIsWinningCounts(counts('1111p2288p3355s77z'))).toBe(false);
  });
});
