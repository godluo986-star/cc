import { describe, it, expect } from 'vitest';
import { rcBasePoints, rcScore, rcScoreLabel, rcSimpleFu } from '../src/riichi';

describe('立直麻将 · 符数(简化档)', () => {
  it('四档符数', () => {
    expect(rcSimpleFu({ chiitoi: true, pinfu: false, menzen: true, tsumo: false })).toBe(25);
    expect(rcSimpleFu({ chiitoi: false, pinfu: true, menzen: true, tsumo: true })).toBe(20);
    expect(rcSimpleFu({ chiitoi: false, pinfu: false, menzen: true, tsumo: false })).toBe(40);
    // 注意:标准规则平和荣和为 30 符,本引擎简化为门清荣和一律 40 符
    expect(rcSimpleFu({ chiitoi: false, pinfu: true, menzen: true, tsumo: false })).toBe(40);
    expect(rcSimpleFu({ chiitoi: false, pinfu: false, menzen: false, tsumo: false })).toBe(30);
    expect(rcSimpleFu({ chiitoi: false, pinfu: false, menzen: true, tsumo: true })).toBe(30);
  });
});

describe('立直麻将 · 点数表', () => {
  it('30符4番:闲家荣和 7700 / 庄家荣和 11600(标准值)', () => {
    const nonDealer = rcScore({ han: 4, fu: 30, dealer: false, tsumo: false });
    expect(nonDealer.total).toBe(7700);
    expect(nonDealer.from).toEqual({ type: 'ron', value: 7700 });
    expect(rcScore({ han: 4, fu: 30, dealer: true, tsumo: false }).total).toBe(11600);
  });

  it('30符1番 / 25符2番(七对)荣和', () => {
    expect(rcScore({ han: 1, fu: 30, dealer: false, tsumo: false }).total).toBe(1000);
    expect(rcScore({ han: 1, fu: 30, dealer: true, tsumo: false }).total).toBe(1500);
    expect(rcScore({ han: 2, fu: 25, dealer: false, tsumo: false }).total).toBe(1600);
    expect(rcScore({ han: 2, fu: 25, dealer: true, tsumo: false }).total).toBe(2400);
  });

  it('平和自摸 20符2番:400/700(标准值)', () => {
    const r = rcScore({ han: 2, fu: 20, dealer: false, tsumo: true });
    expect(r.from).toEqual({ type: 'tsumoNonDealer', dealer: 700, other: 400 });
    expect(r.total).toBe(1500);
  });

  it('庄家自摸 30符3番:各家 2000(标准值)', () => {
    const r = rcScore({ han: 3, fu: 30, dealer: true, tsumo: true });
    expect(r.from).toEqual({ type: 'tsumoDealer', each: 2000 });
    expect(r.total).toBe(6000);
  });

  it('30符4番闲家自摸:2000/3900(标准值)', () => {
    const r = rcScore({ han: 4, fu: 30, dealer: false, tsumo: true });
    expect(r.from).toEqual({ type: 'tsumoNonDealer', dealer: 3900, other: 2000 });
    expect(r.total).toBe(7900);
  });

  it('基本点封顶:40符4番 → 满贯(切上满贯简化)', () => {
    expect(rcBasePoints(4, 40)).toBe(2000);
    const r = rcScore({ han: 4, fu: 40, dealer: false, tsumo: false });
    expect(r.total).toBe(8000);
    expect(r.label).toBe('满贯');
  });

  it('满贯/跳满/倍满/三倍满/累计役满档位', () => {
    expect(rcScore({ han: 5, fu: 30, dealer: false, tsumo: false }).total).toBe(8000);
    expect(rcScore({ han: 5, fu: 30, dealer: true, tsumo: false }).total).toBe(12000);
    expect(rcScore({ han: 6, fu: 30, dealer: false, tsumo: false }).total).toBe(12000);
    expect(rcScore({ han: 8, fu: 30, dealer: false, tsumo: false }).total).toBe(16000);
    expect(rcScore({ han: 11, fu: 30, dealer: false, tsumo: false }).total).toBe(24000);
    expect(rcScore({ han: 13, fu: 30, dealer: false, tsumo: false }).total).toBe(32000);
    expect(rcScoreLabel(rcBasePoints(6, 30))).toBe('跳满');
    expect(rcScoreLabel(rcBasePoints(8, 30))).toBe('倍满');
    expect(rcScoreLabel(rcBasePoints(11, 30))).toBe('三倍满');
  });

  it('役满:闲家荣和 32000 / 庄家荣和 48000 / 闲家自摸 16000+8000×2', () => {
    expect(rcScore({ han: 13, fu: 40, yakuman: 1, dealer: false, tsumo: false }).total).toBe(32000);
    expect(rcScore({ han: 13, fu: 40, yakuman: 1, dealer: true, tsumo: false }).total).toBe(48000);
    const tsumo = rcScore({ han: 13, fu: 40, yakuman: 1, dealer: false, tsumo: true });
    expect(tsumo.from).toEqual({ type: 'tsumoNonDealer', dealer: 16000, other: 8000 });
    expect(tsumo.total).toBe(32000);
    const dealerTsumo = rcScore({ han: 13, fu: 40, yakuman: 1, dealer: true, tsumo: true });
    expect(dealerTsumo.from).toEqual({ type: 'tsumoDealer', each: 16000 });
    expect(rcScoreLabel(8000)).toBe('役满');
  });

  it('支付取整到百位', () => {
    // 30符2番闲家自摸:base 480 → 庄 960→1000,闲 480→500
    const r = rcScore({ han: 2, fu: 30, dealer: false, tsumo: true });
    expect(r.from).toEqual({ type: 'tsumoNonDealer', dealer: 1000, other: 500 });
    expect(r.total).toBe(2000);
  });
});
