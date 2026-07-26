import { describe, it, expect } from 'vitest';
import {
  rcCounts,
  rcParseFaces,
  rcShanten,
  rcShantenChiitoi,
  rcShantenKokushi,
  rcShantenStandard,
  rcTenpai,
  rcWaits,
} from '../src/riichi';

const counts = (s: string) => rcCounts(rcParseFaces(s));
const f = (s: string) => rcParseFaces(s)[0];

describe('立直麻将 · 向听数', () => {
  // 经典用例表:[牌谱, 副露数, 期望向听]
  const cases: [string, number, number][] = [
    ['123456789m12344p', 0, -1], // 14 张和了形
    ['123456789m1234p', 0, 0], // 双碰? 不,1p/4p 单骑复合听
    ['123456789m1245p', 0, 1],
    ['123456789m147p1s', 0, 2],
    ['1112345678999m', 0, 0], // 纯正九莲宝灯 13 张
    ['111222333m44p56s', 0, 0], // 3 面子 + 雀头 + 两面搭子
    ['1122334455667m', 0, 0], // 七对 & 标准形均听牌
    ['1199m2288p3355s7z', 0, 0], // 七对听 7z
    ['1199m2288p33s567z', 0, 1], // 七对 1 向听
    ['19m19p19s1234567z', 0, 0], // 国士十三面
    ['19m19p19s1234455z', 0, 1], // 国士 1 向听
    ['147m258p369s1234z', 0, 6], // 极散手:七对 6 向听最优
    ['112233m456p1289s', 0, 1],
    ['11123m45p', 2, 0], // 两副露,听 3p/6p
    ['123m456p1s', 2, 0], // 两副露 + 两面子,1s 单骑
  ];
  it.each(cases)('%s (副露%i) → %i 向听', (hand, melds, expected) => {
    expect(rcShanten(counts(hand), melds)).toBe(expected);
  });

  it('分项:标准 / 七对 / 国士各自向听', () => {
    const c = counts('147m258p369s1234z');
    expect(rcShantenChiitoi(c)).toBe(6);
    expect(rcShantenKokushi(c)).toBe(7);
    expect(rcShantenStandard(c)).toBe(8);
    expect(rcShantenChiitoi(counts('1199m2288p3355s7z'))).toBe(0);
    expect(rcShantenKokushi(counts('19m19p19s1234567z'))).toBe(0);
    // 4 张同牌只算 1 对
    expect(rcShantenChiitoi(counts('11112288p3355s9m'))).toBe(2);
  });

  it('听牌列表 waits', () => {
    expect(rcWaits(counts('123456789m1234p'))).toEqual([f('1p'), f('4p')]);
    expect(rcWaits(counts('1112345678999m'))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]); // 九面听
    expect(rcWaits(counts('19m19p19s1234567z'))).toHaveLength(13); // 国士十三面
    expect(rcWaits(counts('11123m45p'), 2)).toEqual([f('3p'), f('6p')]);
    expect(rcWaits(counts('123456789m1245p'))).toEqual([]); // 未听牌
  });

  it('tenpai 判定', () => {
    expect(rcTenpai(counts('123456789m1234p'))).toBe(true);
    expect(rcTenpai(counts('123456789m1245p'))).toBe(false);
    expect(rcTenpai(counts('123m456p1s'), 2)).toBe(true);
  });

  it('性能:单手 shanten+waits 粗略 < 50ms(CI 放宽)', () => {
    const hard = [
      '1112345678999m',
      '1122334455667m',
      '147m258p369s1234z',
      '1199m2288p3355s7z',
      '111222333m44p5s',
      '123456789m1245p',
    ].map(counts);
    // 预热
    for (const c of hard) {
      rcShanten(c);
      rcWaits(c);
    }
    const iters = 20;
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) {
      for (const c of hard) {
        rcShanten(c);
        rcWaits(c); // waits 内部含 34 次 shanten
      }
    }
    const perHand = (performance.now() - t0) / (iters * hard.length);
    expect(perHand).toBeLessThan(50);
  });
});
