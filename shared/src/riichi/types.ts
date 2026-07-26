/**
 * 立直麻将 · 引擎级类型(riichi/types.ts)
 * 全部结构可直接 JSON 序列化(无类实例 / Map / Set / 函数)。
 */
import type { RcTile } from './tiles';

/** 副露种类:吃 / 碰 / 明杠 / 暗杠 / 加杠。 */
export type RcMeldKind = 'chi' | 'pon' | 'minkan' | 'ankan' | 'kakan';

export interface RcMeld {
  kind: RcMeldKind;
  /** 组成牌(吃/碰 3 张,杠 4 张,含被叫的那张)。 */
  tiles: RcTile[];
  /** 被叫牌来源座位(0-3);暗杠为 null。 */
  from: number | null;
  /** 被叫的那张牌;暗杠为 null。 */
  called: RcTile | null;
}

/** 暗杠不破门清,其余副露都算「开门」。 */
export function rcMeldIsOpen(meld: RcMeld): boolean {
  return meld.kind !== 'ankan';
}

/** 和牌判定输入(役种 + 宝牌 + 符/番 一站式)。 */
export interface RcWinInput {
  /** 门内牌(含和了牌),长度 = 14 - 3 * melds.length。 */
  concealed: RcTile[];
  melds: RcMeld[];
  winTile: RcTile;
  /** true = 自摸,false = 荣和。 */
  tsumo: boolean;
  /** 场风 face(27-30)。 */
  roundWind: number;
  /** 自风 face(27-30)。 */
  seatWind: number;
  riichi?: boolean;
  /** 一发(需同时 riichi;中间有人鸣牌与否由桌面层保证)。 */
  ippatsu?: boolean;
  /** 岭上开花(杠后摸牌自摸;杠的存在由桌面层保证)。 */
  rinshan?: boolean;
  /** 海底摸月(最后一张自摸)。 */
  haitei?: boolean;
  /** 河底捞鱼(最后一张打牌荣和)。 */
  houtei?: boolean;
  /** 宝牌指示牌 face 列表。 */
  doraIndicators?: number[];
  /** 里宝牌指示牌 face 列表(仅立直时计入)。 */
  uraIndicators?: number[];
}

/** 单个役种:name 中文,han 已按门清/副露折算;役满时 yakuman=true 且 han=13。 */
export interface RcYaku {
  name: string;
  han: number;
  yakuman?: boolean;
}

/** 振听判定输入。 */
export interface RcFuritenInput {
  /** 当前听牌 face 列表。 */
  waits: number[];
  /** 自家牌河 face 列表。 */
  discards: number[];
  /** 上次自摸后被自己放过的可荣和 face(同巡振听;摸牌时由桌面层清空)。 */
  missedSinceDraw?: number[];
  /** 立直后见逃过荣和 → 永久振听(只能自摸)。 */
  riichiMissed?: boolean;
}

/** 一名玩家一手牌的引擎级快照(桌面层在此之上加公共信息)。 */
export interface RcHandState {
  concealed: RcTile[];
  melds: RcMeld[];
  discards: RcTile[];
  riichi: boolean;
  /** 立直宣言牌在 discards 中的下标;未立直为 null。 */
  riichiIndex: number | null;
  ippatsu: boolean;
  missedSinceDraw: number[];
  riichiMissed: boolean;
  /** 自风 face(27-30)。 */
  seatWind: number;
  points: number;
}
