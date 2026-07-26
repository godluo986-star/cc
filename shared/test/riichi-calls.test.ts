import { describe, it, expect } from 'vitest';
import {
  rcAnkanFaces,
  rcAnkanMeld,
  rcCanChiFrom,
  rcCanMinkan,
  rcCanPon,
  rcChiOptions,
  rcIsFuriten,
  rcKakanFaces,
  rcKakanMeld,
  rcMinkanMeld,
  rcParseFaces,
  rcParseTiles,
  rcPonOptions,
  rcRiichiDiscards,
  type RcMeld,
} from '../src/riichi';

const f = (s: string) => rcParseFaces(s)[0];
const t = (s: string) => rcParseTiles(s)[0];

describe('立直麻将 · 吃碰杠', () => {
  it('吃仅限上家', () => {
    expect(rcCanChiFrom(0, 1)).toBe(true);
    expect(rcCanChiFrom(3, 0)).toBe(true);
    expect(rcCanChiFrom(0, 2)).toBe(false);
    expect(rcCanChiFrom(0, 3)).toBe(false);
  });

  it('吃组合生成:边张/嵌张/两面全枚举', () => {
    const hand = rcParseTiles('1345689m');
    const opts = rcChiOptions(hand, t('2m'), 3);
    // 2m 可与 [1,3] [3,4] 组;faces 排序后含被吃牌
    expect(opts).toHaveLength(2);
    for (const m of opts) {
      expect(m.kind).toBe('chi');
      expect(m.tiles).toHaveLength(3);
      expect(m.called?.face).toBe(f('2m'));
    }
    // 7m: [5,6] [6,8] [8,9]
    expect(rcChiOptions(hand, t('7m'), 3)).toHaveLength(3);
    // 字牌不能吃
    expect(rcChiOptions(rcParseTiles('1122z'), t('1z'), 3)).toEqual([]);
    // 红 5 与普通 5 是不同选项
    const withRed = rcChiOptions(rcParseTiles('4m05m5m'), t('3m'), 3);
    expect(withRed).toHaveLength(2);
    // 无红 5 时同组合去重
    expect(rcChiOptions(rcParseTiles('455m'), t('3m'), 3)).toHaveLength(1);
  });

  it('碰:两张即可,红 5 区分组合', () => {
    expect(rcCanPon(rcParseTiles('55p123m'), f('5p'))).toBe(true);
    expect(rcCanPon(rcParseTiles('5p123m'), f('5p'))).toBe(false);
    expect(rcPonOptions(rcParseTiles('05p'), t('5p'), 2)).toHaveLength(1); // 红+普通 只此一种
    expect(rcPonOptions(rcParseTiles('0555p'), t('5p'), 2)).toHaveLength(2); // [普普] [红普]
    expect(rcPonOptions(rcParseTiles('55p'), t('5p'), 2)).toHaveLength(1);
  });

  it('明杠:手中恰需 3 张', () => {
    expect(rcCanMinkan(rcParseTiles('555p12m'), f('5p'))).toBe(true);
    expect(rcCanMinkan(rcParseTiles('55p12m'), f('5p'))).toBe(false);
    const m = rcMinkanMeld(rcParseTiles('555p12m'), t('5p'), 1);
    expect(m?.kind).toBe('minkan');
    expect(m?.tiles).toHaveLength(4);
    expect(rcMinkanMeld(rcParseTiles('55p12m'), t('5p'), 1)).toBeNull();
  });

  it('暗杠与加杠', () => {
    expect(rcAnkanFaces(rcParseTiles('1111m55p'))).toEqual([f('1m')]);
    expect(rcAnkanFaces(rcParseTiles('111m55p'))).toEqual([]);
    const ak = rcAnkanMeld(rcParseTiles('1111m55p'), f('1m'));
    expect(ak?.kind).toBe('ankan');
    expect(ak?.from).toBeNull();
    // 加杠:已有碰 + 手中第 4 张
    const ponMeld: RcMeld = {
      kind: 'pon',
      tiles: rcParseTiles('555s'),
      from: 2,
      called: t('5s'),
    };
    expect(rcKakanFaces(rcParseTiles('5s123m'), [ponMeld])).toEqual([f('5s')]);
    expect(rcKakanFaces(rcParseTiles('123m'), [ponMeld])).toEqual([]);
    const kk = rcKakanMeld(t('5s'), [ponMeld]);
    expect(kk?.kind).toBe('kakan');
    expect(kk?.tiles).toHaveLength(4);
    expect(rcKakanMeld(t('6s'), [ponMeld])).toBeNull();
  });
});

describe('立直麻将 · 振听', () => {
  const waits = [f('3p'), f('6p')];
  it('自家牌河含听牌张 → 振听', () => {
    expect(rcIsFuriten({ waits, discards: [f('1m'), f('3p')] })).toBe(true);
    expect(rcIsFuriten({ waits, discards: [f('1m'), f('9s')] })).toBe(false);
  });
  it('同巡见逃 → 临时振听(摸牌前)', () => {
    expect(rcIsFuriten({ waits, discards: [], missedSinceDraw: [f('6p')] })).toBe(true);
    expect(rcIsFuriten({ waits, discards: [], missedSinceDraw: [f('7p')] })).toBe(false);
  });
  it('立直后见逃 → 永久振听', () => {
    expect(rcIsFuriten({ waits, discards: [], riichiMissed: true })).toBe(true);
  });
  it('未听牌不振听', () => {
    expect(rcIsFuriten({ waits: [], discards: [f('3p')] })).toBe(false);
  });
});

describe('立直麻将 · 立直合法性', () => {
  it('门清+听牌+点数≥1000 → 给出可立直打牌表', () => {
    const hand = rcParseTiles('123456789m12344p'); // 14 张,和了形,打多张都仍听
    const discards = rcRiichiDiscards(hand, [], 25000);
    expect(discards).toContain(f('1p'));
    expect(discards).toContain(f('4p'));
    expect(discards.length).toBeGreaterThan(0);
  });
  it('点数不足 1000 → 不能立直', () => {
    expect(rcRiichiDiscards(rcParseTiles('123456789m12344p'), [], 900)).toEqual([]);
  });
  it('副露(非暗杠)→ 不能立直;暗杠 → 可以', () => {
    const ponMeld: RcMeld = { kind: 'pon', tiles: rcParseTiles('555s'), from: 2, called: t('5s') };
    expect(rcRiichiDiscards(rcParseTiles('123456m12344p'), [ponMeld], 25000)).toEqual([]);
    const ankanMeld: RcMeld = { kind: 'ankan', tiles: rcParseTiles('5555s'), from: null, called: null };
    const withAnkan = rcRiichiDiscards(rcParseTiles('123456m12344p'), [ankanMeld], 25000);
    expect(withAnkan.length).toBeGreaterThan(0);
  });
  it('打完不听 → 空表', () => {
    expect(rcRiichiDiscards(rcParseTiles('123456789m147p25s'), [], 25000)).toEqual([]);
  });
});
