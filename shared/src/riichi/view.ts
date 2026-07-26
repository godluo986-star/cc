/**
 * 立直麻将 · 视图类型(riichi/view.ts)
 *
 * 服务器 viewFor(session) 脱敏后的桌面快照:别家手牌只给张数,
 * 里宝牌仅在立直和牌结算时公开。全部结构可直接 JSON 序列化。
 */
import type { RcTile } from './tiles';
import type { RcMeld, RcYaku } from './types';
import type { PublicProfile } from '../types';

/** 桌面阶段:idle 等待开局 / playing 摸打 / claim 鸣牌窗口 / finished 本局结束。 */
export type RjPhase = 'idle' | 'playing' | 'claim' | 'finished';

/** 牌河一张:riichi=true 表示立直宣言牌(客户端横置渲染)。 */
export interface RjRiverTile {
  tile: RcTile;
  riichi: boolean;
}

export interface RjSeatPublic {
  /** 真人资料;空位 / 机器人为 null。 */
  profile: PublicProfile | null;
  /** 机器人名(非机器人为 null)。 */
  botName: string | null;
  points: number;
  /** 自风 face(27-30)。 */
  seatWind: number;
  melds: RcMeld[];
  /** 牌河(含横置立直标记)。 */
  river: RjRiverTile[];
  riichi: boolean;
  handCount: number;
}

/** 支付明细一笔:delta 正=收入,负=支出(含供托 / 本场棒)。 */
export interface RjPayment {
  seat: number;
  delta: number;
}

export interface RjWinSettle {
  type: 'win';
  winner: number;
  tsumo: boolean;
  /** 放铳者座位;自摸为 null。 */
  from: number | null;
  winTile: RcTile;
  yaku: RcYaku[];
  han: number;
  fu: number;
  /** 满贯 / 跳满 / 倍满…;普通手为 null。 */
  label: string | null;
  /** 和牌者总得点(含供托与本场)。 */
  total: number;
  /** 里宝牌指示牌 face(仅立直和牌时公开,否则 [])。 */
  uraIndicators: number[];
  payments: RjPayment[];
}

/** 荒牌流局:听牌者各收 1000(由未听者分摊,见桌面层)。 */
export interface RjDrawSettle {
  type: 'draw';
  /** 各座是否听牌。 */
  tenpai: boolean[];
  payments: RjPayment[];
}

export type RjSettle = RjWinSettle | RjDrawSettle;

export interface RiichiPublic {
  tableId: string;
  /** 局:0-3 = 东1-东4。 */
  kyoku: number;
  /** 本场数。 */
  honba: number;
  /** 场风 face(东风战恒为 27)。 */
  roundWind: number;
  dealer: number;
  seats: RjSeatPublic[];
  /** 宝牌指示牌 face 列表(杠后追加)。 */
  doraIndicators: number[];
  /** 余牌数(可摸)。 */
  wallCount: number;
  /** 当前巡到的座位。 */
  turn: number;
  phase: RjPhase;
  /** 最近打出的一张。 */
  lastDiscard: { seat: number; tile: RcTile } | null;
  /** 供托立直棒数(每根 1000)。 */
  riichiSticks: number;
  claimDeadline: number | null;
  /** 本局结算(phase=finished 时非 null)。 */
  settle: RjSettle | null;
  /** 东4 打完:true 时再次 start 会重置积分开新东风战。 */
  gameOver: boolean;
}

/** 当前可执行动作列表(不可执行的为 false / [])。 */
export interface RjActions {
  /** 轮到我打牌(立直后由服务器自动摸切,恒为 false)。 */
  discard: boolean;
  /** 可宣言立直时允许打出的 face 列表([] = 不能立直)。 */
  riichiFaces: number[];
  /** 可暗杠的 face 列表。 */
  ankanFaces: number[];
  /** 可加杠的 face 列表。 */
  kakanFaces: number[];
  /** 鸣牌窗口内可选的吃组合。 */
  chi: RcMeld[];
  /** 鸣牌窗口内可选的碰组合。 */
  pon: RcMeld[];
  /** 可明杠。 */
  kan: boolean;
  ron: boolean;
  tsumo: boolean;
  /** 处于鸣牌窗口且尚未表态时可过。 */
  pass: boolean;
}

export interface RiichiPrivate {
  mySeat: number;
  /** 手牌实体牌(含红5、含自摸牌,已排序)。 */
  hand: RcTile[];
  /** 自摸牌(没有则 null)。 */
  drawn: RcTile | null;
  actions: RjActions;
  /** 听牌提示:13 张形时的待牌 face 列表(非 13 张形为 [])。 */
  waits: number[];
}

export interface RiichiView {
  pub: RiichiPublic;
  priv: RiichiPrivate | null;
}
