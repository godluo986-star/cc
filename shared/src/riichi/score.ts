/**
 * 立直麻将 · 符数与点数(riichi/score.ts)
 *
 * ── 简化点(与标准日麻的差异,需写进 README)───────────────────────
 * 1. 符数不做逐项累加,只分四档:
 *      七对子固定 25 符;平和+自摸 20 符;门清荣和一律 40 符;其余一律 30 符。
 *    因此「平和荣和」在本引擎是 40 符(标准为 30 符),
 *    含暗刻/幺九刻/单骑等的手牌不会得到额外符。
 * 2. 1-4 番:基本点 = 符 × 2^(2+番),封顶 2000(即 4番40符起即为满贯,
 *    相当于标准规则的切上满贯)。
 * 3. 5番=满贯(基本点2000)/ 6-7番=跳满(3000)/ 8-10番=倍满(4000)/
 *    11-12番=三倍满(6000)/ 13番以上=累计役满(8000)。
 * 4. 役满基本点 8000 × 役满数(本引擎唯一役满为国士无双,单倍)。
 * 5. 支付:荣和 = 放铳者付 基本点×4(庄家和牌 ×6);
 *    庄家自摸 = 三家各付 基本点×2;闲家自摸 = 庄付 ×2、闲各付 ×1;
 *    每笔支付单独向上取整到百位。总点 total = 各笔支付之和
 *    (庄家收入约为闲家 1.5 倍)。
 * 6. 立直棒供托、本场棒不在本模块计(桌面层结算)。
 */

export interface RcFuFlags {
  chiitoi: boolean;
  pinfu: boolean;
  menzen: boolean;
  tsumo: boolean;
}

/** 简化符数(见模块头注释)。 */
export function rcSimpleFu(x: RcFuFlags): number {
  if (x.chiitoi) return 25;
  if (x.pinfu && x.tsumo) return 20;
  if (x.menzen && !x.tsumo) return 40;
  return 30;
}

export function rcRoundUp100(n: number): number {
  return Math.ceil(n / 100) * 100;
}

/** 基本点(未乘支付倍率、未取整)。 */
export function rcBasePoints(han: number, fu: number, yakumanCount = 0): number {
  if (yakumanCount > 0) return 8000 * yakumanCount;
  if (han >= 13) return 8000; // 累计役满
  if (han >= 11) return 6000; // 三倍满
  if (han >= 8) return 4000; // 倍满
  if (han >= 6) return 3000; // 跳满
  if (han >= 5) return 2000; // 满贯
  return Math.min(fu * (1 << (2 + han)), 2000);
}

/** 点数档位中文名;普通手为 null。 */
export function rcScoreLabel(base: number): string | null {
  if (base >= 8000) return '役满';
  if (base >= 6000) return '三倍满';
  if (base >= 4000) return '倍满';
  if (base >= 3000) return '跳满';
  if (base >= 2000) return '满贯';
  return null;
}

export interface RcScoreInput {
  han: number;
  fu: number;
  /** 役满数(>0 时忽略 han/fu)。 */
  yakuman?: number;
  /** 和牌者是否庄家。 */
  dealer: boolean;
  tsumo: boolean;
}

export type RcPayment =
  | { type: 'ron'; value: number }
  | { type: 'tsumoDealer'; each: number }
  | { type: 'tsumoNonDealer'; dealer: number; other: number };

export interface RcScoreResult {
  /** 和牌者总收入(不含供托/本场)。 */
  total: number;
  from: RcPayment;
  base: number;
  label: string | null;
}

/** 按番/符/役满查点数表。 */
export function rcScore(input: RcScoreInput): RcScoreResult {
  const base = rcBasePoints(input.han, input.fu, input.yakuman ?? 0);
  const label = rcScoreLabel(base);
  if (input.tsumo) {
    if (input.dealer) {
      const each = rcRoundUp100(base * 2);
      return { total: each * 3, from: { type: 'tsumoDealer', each }, base, label };
    }
    const dealer = rcRoundUp100(base * 2);
    const other = rcRoundUp100(base);
    return { total: dealer + other * 2, from: { type: 'tsumoNonDealer', dealer, other }, base, label };
  }
  const value = rcRoundUp100(base * (input.dealer ? 6 : 4));
  return { total: value, from: { type: 'ron', value }, base, label };
}
