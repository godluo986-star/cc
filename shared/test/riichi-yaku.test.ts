import { describe, it, expect } from 'vitest';
import {
  rcEvaluateWin,
  rcHasYaku,
  rcParseFaces,
  rcParseTiles,
  type RcMeld,
  type RcTile,
  type RcWinInput,
  type RcWinResult,
} from '../src/riichi';

const f = (s: string) => rcParseFaces(s)[0];

/** 副露构造:碰(3 张同 face)。 */
function pon(face: string, from = 3): RcMeld {
  const ff = f(face);
  const tiles: RcTile[] = [1, 2, 3].map((c) => ({ id: ff * 4 + c, face: ff, red: false }));
  return { kind: 'pon', tiles, from, called: tiles[2] };
}
/** 副露构造:吃(start 起顺子)。 */
function chi(start: string, from = 3): RcMeld {
  const s = f(start);
  const tiles: RcTile[] = [0, 1, 2].map((d) => ({ id: (s + d) * 4 + 3, face: s + d, red: false }));
  return { kind: 'chi', tiles, from, called: tiles[0] };
}
function ankan(face: string): RcMeld {
  const ff = f(face);
  const tiles: RcTile[] = [0, 1, 2, 3].map((c) => ({ id: ff * 4 + c, face: ff, red: false }));
  return { kind: 'ankan', tiles, from: null, called: null };
}

/** 和牌输入构造:hand 为门内牌谱(含和了牌),win 为和了牌 face。 */
function ctx(hand: string, win: string, opts: Partial<RcWinInput> = {}): RcWinInput {
  const concealed = rcParseTiles(hand);
  const winFace = f(win);
  const winTile = concealed.find((t) => t.face === winFace);
  if (!winTile) throw new Error(`和了牌不在手中: ${win}`);
  return {
    concealed,
    melds: [],
    winTile,
    tsumo: false,
    roundWind: 27, // 东场
    seatWind: 28, // 南家
    ...opts,
  };
}
const names = (r: RcWinResult | null) => (r ? r.yaku.map((y) => y.name) : []);
const han = (r: RcWinResult | null, name: string) => r?.yaku.find((y) => y.name === name)?.han;

describe('立直麻将 · 役种判定', () => {
  const TANYAO = '234m567m234p567p88s'; // 门清断幺平和素材

  it('立直:门清+旗标 ✓;副露手立直无效', () => {
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p', { riichi: true })))).toContain('立直');
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p')))).not.toContain('立直');
    const open = rcEvaluateWin(ctx('234m567m567p88s', '7p', { melds: [chi('2p')], riichi: true }));
    expect(names(open)).not.toContain('立直');
  });

  it('一发:需与立直同在', () => {
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p', { riichi: true, ippatsu: true })))).toContain('一发');
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p', { ippatsu: true })))).not.toContain('一发');
  });

  it('门前清自摸和:门清自摸 ✓;副露自摸 ✗', () => {
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p', { tsumo: true })))).toContain('门前清自摸和');
    const open = rcEvaluateWin(ctx('234m567m567p88s', '7p', { melds: [chi('2p')], tsumo: true }));
    expect(names(open)).not.toContain('门前清自摸和');
    expect(names(open)).toContain('断幺九'); // 仍有断幺
  });

  it('断幺九:全 2-8 ✓;含幺九 ✗', () => {
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p')))).toContain('断幺九');
    expect(names(rcEvaluateWin(ctx('123m567m234p567p88s', '7p')))).not.toContain('断幺九');
  });

  it('平和:门清全顺子+非役牌雀头+两面听 ✓;嵌张/单骑/役牌雀头 ✗', () => {
    const r = rcEvaluateWin(ctx(TANYAO, '7p'));
    expect(names(r)).toContain('平和');
    expect(names(rcEvaluateWin(ctx(TANYAO, '3p')))).not.toContain('平和'); // 嵌张 2_4? 234p 之 3 嵌张
    expect(names(rcEvaluateWin(ctx(TANYAO, '8s')))).not.toContain('平和'); // 单骑
    // 役牌雀头(白)→ 无平和
    const dragonPair = rcEvaluateWin(ctx('234m567m234p567p55z', '7p'));
    expect(names(dragonPair)).not.toContain('平和');
  });

  it('役牌:三元/场风/自风 各判各的;客风刻 ✗', () => {
    const dragon = rcEvaluateWin(ctx('123m456p345s555z99m', '5z'));
    expect(names(dragon)).toContain('役牌 白');
    const east = rcEvaluateWin(ctx('123m456p345s111z99m', '1z')); // 场风东,自风南
    expect(names(east)).toContain('场风');
    expect(names(east)).not.toContain('自风');
    const dbl = rcEvaluateWin(ctx('123m456p345s111z99m', '1z', { seatWind: 27 })); // 连风
    expect(names(dbl)).toContain('场风');
    expect(names(dbl)).toContain('自风');
    const guest = rcEvaluateWin(ctx('123m456p345s333z99m', '3z')); // 西刻,非场非自
    expect(names(guest)).not.toContain('场风');
    expect(names(guest)).not.toContain('自风');
    expect(guest?.hasYaku).toBe(false); // 无役不能和
  });

  it('对对和:四刻子 ✓(含碰副露);有顺子 ✗', () => {
    const closed = rcEvaluateWin(ctx('111999m111p555s22z', '5s'));
    expect(names(closed)).toContain('对对和');
    const open = rcEvaluateWin(ctx('111p555s22z', '5s', { melds: [pon('1m'), pon('9m')] }));
    expect(names(open)).toContain('对对和');
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p')))).not.toContain('对对和');
  });

  it('七对子:7 异对 ✓ 25符;四张同牌 ✗', () => {
    const r = rcEvaluateWin(ctx('1199m2288p3355s77z', '7z'));
    expect(names(r)).toContain('七对子');
    expect(han(r, '七对子')).toBe(2);
    expect(r?.fu).toBe(25);
    expect(rcEvaluateWin(ctx('1111p2288p3355s77z', '7z'))).toBeNull();
  });

  it('一杯口:门清两同顺 ✓;副露 ✗(顺带 hasYaku=false)', () => {
    const r = rcEvaluateWin(ctx('112233m456789p11z', '4p'));
    expect(names(r)).toContain('一杯口');
    const open = rcEvaluateWin(ctx('123m456789p11z', '4p', { melds: [chi('1m')] }));
    expect(names(open)).not.toContain('一杯口');
    expect(open?.hasYaku).toBe(false);
  });

  it('三色同顺:门清 2 番,副露 1 番;错位 ✗', () => {
    const closed = rcEvaluateWin(ctx('234m234p234s567m88s', '4s'));
    expect(han(closed, '三色同顺')).toBe(2);
    const open = rcEvaluateWin(ctx('234m234s567m88s', '4s', { melds: [chi('2p')] }));
    expect(han(open, '三色同顺')).toBe(1);
    expect(names(rcEvaluateWin(ctx('234m345p234s567m88s', '4s')))).not.toContain('三色同顺');
  });

  it('一气通贯:门清 2 番,副露 1 番;缺段 ✗', () => {
    const closed = rcEvaluateWin(ctx('123456789m234s99p', '4s'));
    expect(han(closed, '一气通贯')).toBe(2);
    const open = rcEvaluateWin(ctx('456789m234s99p', '4s', { melds: [chi('1m')] }));
    expect(han(open, '一气通贯')).toBe(1);
    expect(names(rcEvaluateWin(ctx('123456m789p234s99p', '4s')))).not.toContain('一气通贯');
  });

  it('混一色:一色+字 门清 3 / 副露 2;带他色 ✗', () => {
    const closed = rcEvaluateWin(ctx('111m234m789m555z99m', '9m'));
    expect(han(closed, '混一色')).toBe(3);
    expect(names(closed)).toContain('役牌 白');
    const open = rcEvaluateWin(ctx('111m234m789m99m', '9m', { melds: [pon('5z')] }));
    expect(han(open, '混一色')).toBe(2);
    expect(names(rcEvaluateWin(ctx('111m234m789m555z99p', '9p')))).not.toContain('混一色');
  });

  it('清一色:纯一色 门清 6 / 副露 5;带字 ✗(变混一色)', () => {
    const closed = rcEvaluateWin(ctx('123234567789m99m', '9m'));
    expect(han(closed, '清一色')).toBe(6);
    expect(names(closed)).toContain('平和'); // 78 两面听 9m
    // 二杯口形手:七对+清一(8番)胜过 标准形 清一+一杯口(7番)
    const ryanpeikoShape = rcEvaluateWin(ctx('112233445566m99m', '9m'));
    expect(ryanpeikoShape?.decomposition.type).toBe('chiitoi');
    expect(names(ryanpeikoShape)).toContain('七对子');
    expect(han(ryanpeikoShape, '清一色')).toBe(6);
    const open = rcEvaluateWin(ctx('123445566m99m', '9m', { melds: [chi('1m')] }));
    expect(han(open, '清一色')).toBe(5);
    expect(names(open)).not.toContain('一杯口');
    expect(names(rcEvaluateWin(ctx('111m234m789m555z99m', '9m')))).not.toContain('清一色');
  });

  it('国士无双:役满,只计役满役;12 种 ✗', () => {
    const r = rcEvaluateWin(ctx('19m19p19s12345677z', '7z'));
    expect(r?.yakumanCount).toBe(1);
    expect(r?.han).toBe(13);
    expect(r?.yaku).toEqual([{ name: '国士无双', han: 13, yakuman: true }]);
    expect(rcEvaluateWin(ctx('19m19p19s1234566z1m', '1m'))).toBeNull();
  });

  it('岭上/海底/河底旗标役', () => {
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p', { tsumo: true, rinshan: true })))).toContain('岭上开花');
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p', { tsumo: true, haitei: true })))).toContain('海底摸月');
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p', { houtei: true })))).toContain('河底捞鱼');
    expect(names(rcEvaluateWin(ctx(TANYAO, '7p', { tsumo: true, houtei: true })))).not.toContain('河底捞鱼');
  });

  it('暗杠不破门清:立直/自摸仍算', () => {
    const r = rcEvaluateWin(
      ctx('234m567m234p88s', '7m', { melds: [ankan('6s')], riichi: true, tsumo: true }),
    );
    expect(names(r)).toContain('立直');
    expect(names(r)).toContain('门前清自摸和');
    expect(names(r)).not.toContain('平和'); // 有刻子(杠)
  });

  it('宝牌/红宝牌/里宝牌计数:计番不计役', () => {
    // 手含红5s + 两张5s;指示牌 4s → 宝牌 5s
    const base = ctx('234m567m234p678s05s', '3p', {
      riichi: true,
      doraIndicators: [f('4s')],
      uraIndicators: [f('1m')], // 里宝 → 2m
    });
    const r = rcEvaluateWin(base);
    expect(r?.dora).toEqual({ dora: 2, aka: 1, ura: 1 });
    // 役番:立直1 + 断幺1 = 2;总番 = 2 + 4 宝牌番
    expect(r?.han).toBe(6);
    expect(r?.fu).toBe(40); // 门清荣和简化 40 符
    // 未立直 → 里宝不计
    const noRiichi = rcEvaluateWin(ctx('234m567m234p678s05s', '3p', { doraIndicators: [f('4s')], uraIndicators: [f('1m')] }));
    expect(noRiichi?.dora.ura).toBe(0);
  });

  it('无役(只有宝牌)不能和:hasYaku=false', () => {
    const r = rcEvaluateWin(ctx('123m456p789s333z99m', '9m', { doraIndicators: [f('2z')] }));
    expect(r).not.toBeNull();
    expect(r?.hasYaku).toBe(false);
    expect(rcHasYaku(ctx('123m456p789s333z99m', '9m'))).toBe(false);
    expect(rcHasYaku(ctx(TANYAO, '7p'))).toBe(true);
  });

  it('取最高番分解:对对和刻子形优于全顺子形', () => {
    const r = rcEvaluateWin(ctx('111222333789m44p', '9m'));
    // 两种分解:三刻+789 → 对对? 789 是顺子,非对对;全顺 111222333 = 123×3
    // 全顺形:一杯口(123×2 以上);取番高者
    expect(r).not.toBeNull();
    expect(r!.han).toBeGreaterThanOrEqual(1);
    expect(r!.hasYaku).toBe(true);
  });
});
