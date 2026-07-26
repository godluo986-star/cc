/**
 * 立直麻将牌桌(服务器权威)· 四人东风战(东1-东4)。
 *
 * 规则引擎在 @nexuspark/shared 的 riichi/ 模块;本文件只做桌面层:
 * 入座/离座(bot 接管)、发牌摸打、立直(1000 供托 + 服务器自动摸切)、
 * 吃碰杠(含暗杠/加杠,杠后翻新宝牌 + 岭上摸)、荣和/自摸、振听、
 * 荒牌流局(听牌者各收 1000,由未听者分摊)、8 秒鸣牌窗口(tick 驱动)、
 * viewFor 脱敏、结算 pendingEvents。
 *
 * 简化点(README 级):无抢杠/无九种九牌等途中流局;立直后不暗杠;
 * 本场棒 100×本场/家;连庄本场上限 8(防死循环,超限强制进下一局);
 * 打完一局 phase=finished,再次 start 续开下一局(东4 后重置积分)。
 */
import type { Session } from './session';
import { profileOf } from './session';
import {
  rcAllTiles, rcShuffle, rcCounts, rcShanten, rcTenpai, rcWaits,
  rcEvaluateWin, rcScore, rcIsFuriten, rcRiichiDiscards,
  rcCanChiFrom, rcChiOptions, rcCanPon, rcPonOptions,
  rcCanMinkan, rcMinkanMeld, rcAnkanFaces, rcAnkanMeld, rcKakanFaces, rcKakanMeld,
} from '@nexuspark/shared';
import type {
  RcTile, RcRng, RcMeld,
  RiichiView, RiichiPublic, RjSeatPublic, RjActions, RjSettle, RjPayment, RjPhase, RjRiverTile,
} from '@nexuspark/shared';

const BOT_NAMES = ['雀士·梅', '雀士·兰', '雀士·竹', '雀士·菊'];
const CLAIM_WINDOW_MS = 8000;
const START_POINTS = 25000;
const RIICHI_STICK = 1000;
const HONBA_CAP = 8;

interface RjSeat {
  session: Session | null;
  isBot: boolean;
  /** 门内牌(含自摸牌),始终排序。 */
  hand: RcTile[];
  drawn: RcTile | null;
  melds: RcMeld[];
  river: RjRiverTile[];
  riichi: boolean;
  ippatsu: boolean;
  /** 同巡见逃的可荣和 face(摸牌时清空)。 */
  missedSinceDraw: number[];
  /** 立直后见逃 → 永久振听。 */
  riichiMissed: boolean;
  points: number;
}

type RjResponse = 'ron' | 'pon' | 'kan' | 'chi' | 'pass';

interface RjClaim {
  tile: RcTile;
  from: number;
  deadline: number;
  responses: (RjResponse | null)[];
  eligible: { ron: boolean; pon: boolean; kan: boolean; chi: boolean }[];
  /** 玩家选定的吃/碰组合(红5 区分)。 */
  meldChoice: (RcMeld | null)[];
  /** 打出时余牌已空(河底)。 */
  houtei: boolean;
}

export type RjEvent = { kind: 'finish'; winnerSeat: number; reward: number };

function freshSeat(): RjSeat {
  return {
    session: null, isBot: false, hand: [], drawn: null, melds: [], river: [],
    riichi: false, ippatsu: false, missedSinceDraw: [], riichiMissed: false,
    points: START_POINTS,
  };
}

function sortHand(hand: RcTile[]): void {
  hand.sort((a, b) => a.face - b.face || a.id - b.id);
}

export class RiichiTable {
  seats: RjSeat[] = Array.from({ length: 4 }, freshSeat);
  phase: RjPhase = 'idle';
  /** 局:0-3 = 东1-东4(同时决定庄家座位)。 */
  kyoku = 0;
  honba = 0;
  dealer = 0;
  riichiSticks = 0;
  turn = 0;
  gameOver = false;
  wall: RcTile[] = [];
  /** 岭上牌(杠后摸)。 */
  rinshan: RcTile[] = [];
  private doraStack: RcTile[] = [];
  private uraStack: RcTile[] = [];
  private doraCount = 1;
  /** 当前自摸牌是否岭上摸(岭上开花判定)。 */
  private rinshanDraw = false;
  lastDiscard: { seat: number; tile: RcTile } | null = null;
  claim: RjClaim | null = null;
  settle: RjSettle | null = null;
  /** 机器人 / 立直自动摸切的下一次动作时间(tick 驱动)。 */
  nextActionAt = 0;
  private pendingEvents: RjEvent[] = [];

  constructor(public tableId: string, private rng: RcRng = Math.random) {}

  // ── 入座 / 离座 ───────────────────────────────────────────────────────────
  seatOf(s: Session): number {
    return this.seats.findIndex((x) => x.session === s);
  }

  sit(s: Session): string | null {
    if (this.seatOf(s) !== -1) return null;
    const playing = this.phase === 'playing' || this.phase === 'claim';
    const idx = playing
      ? this.seats.findIndex((x) => !x.session && x.isBot) // 顶替机器人
      : this.seats.findIndex((x) => !x.session);
    if (idx === -1) return '桌子满了,先观战吧!';
    this.seats[idx].session = s;
    this.seats[idx].isBot = false;
    return null;
  }

  leave(s: Session): void {
    const idx = this.seatOf(s);
    if (idx === -1) return;
    this.seats[idx].session = null;
    if (this.phase === 'playing' || this.phase === 'claim') {
      this.seats[idx].isBot = true; // 机器人接手
      if (this.claim && this.claim.responses[idx] === null) {
        this.respond(idx, this.claim.eligible[idx].ron ? 'ron' : 'pass');
      }
      this.scheduleAuto();
    } else {
      const points = this.seats[idx].points;
      this.seats[idx] = freshSeat();
      this.seats[idx].points = points;
    }
  }

  dropSession(s: Session): boolean {
    if (this.seatOf(s) === -1) return false;
    this.leave(s);
    return true;
  }

  // ── 开局 ─────────────────────────────────────────────────────────────────
  start(s: Session): string | null {
    if (this.phase === 'playing' || this.phase === 'claim') return '牌局进行中。';
    if (this.seatOf(s) === -1) return '先坐下再开局。';
    if (this.gameOver || this.phase === 'idle') {
      // 新东风战:重置积分与场况
      this.kyoku = 0;
      this.honba = 0;
      this.riichiSticks = 0;
      this.gameOver = false;
      for (const seat of this.seats) seat.points = START_POINTS;
    }
    this.deal();
    return null;
  }

  private deal(): void {
    this.dealer = this.kyoku;
    this.phase = 'playing';
    this.settle = null;
    this.lastDiscard = null;
    this.claim = null;
    this.rinshanDraw = false;
    for (const seat of this.seats) {
      if (!seat.session) seat.isBot = true;
      seat.hand = []; seat.drawn = null; seat.melds = []; seat.river = [];
      seat.riichi = false; seat.ippatsu = false;
      seat.missedSinceDraw = []; seat.riichiMissed = false;
    }
    // 洗牌:王牌 14 张(岭上 4 + 宝牌指示 5 + 里宝牌指示 5)
    this.wall = rcShuffle(rcAllTiles(), this.rng);
    const dead = this.wall.splice(0, 14);
    this.rinshan = dead.slice(0, 4);
    this.doraStack = dead.slice(4, 9);
    this.uraStack = dead.slice(9, 14);
    this.doraCount = 1;
    for (let r = 0; r < 13; r++) {
      for (let p = 0; p < 4; p++) this.seats[(this.dealer + p) % 4].hand.push(this.wall.pop()!);
    }
    for (const seat of this.seats) sortHand(seat.hand);
    this.turn = this.dealer;
    this.drawFor(this.dealer);
  }

  seatWindOf(idx: number): number {
    return 27 + ((idx - this.dealer + 4) % 4);
  }

  doraIndicators(): number[] {
    return this.doraStack.slice(0, this.doraCount).map((t) => t.face);
  }
  private uraIndicators(): number[] {
    return this.uraStack.slice(0, this.doraCount).map((t) => t.face);
  }

  // ── 摸牌 ─────────────────────────────────────────────────────────────────
  private drawFor(seatIdx: number): void {
    if (this.wall.length === 0) { this.exhaustiveDraw(); return; }
    const seat = this.seats[seatIdx];
    const t = this.wall.pop()!;
    seat.hand.push(t);
    sortHand(seat.hand);
    seat.drawn = t;
    seat.missedSinceDraw = []; // 摸牌清空同巡见逃
    this.rinshanDraw = false;
    this.turn = seatIdx;
    this.scheduleAuto();
  }

  private rinshanDrawFor(seatIdx: number): void {
    const t = this.rinshan.pop();
    if (!t) { this.exhaustiveDraw(); return; }
    const seat = this.seats[seatIdx];
    seat.hand.push(t);
    sortHand(seat.hand);
    seat.drawn = t;
    seat.missedSinceDraw = [];
    this.rinshanDraw = true;
    this.turn = seatIdx;
    this.scheduleAuto();
  }

  // ── 打牌 / 立直 ───────────────────────────────────────────────────────────
  discardAction(seatIdx: number, tileId: number | undefined): string | null {
    if (this.phase !== 'playing' || this.claim) return null;
    if (this.turn !== seatIdx) return '还没轮到你出牌。';
    const seat = this.seats[seatIdx];
    if (seat.hand.length % 3 !== 2) return null;
    if (seat.riichi) return null; // 立直后由服务器自动摸切
    const tile = seat.hand.find((t) => t.id === tileId);
    if (!tile) return null;
    this.doDiscard(seatIdx, tile, false);
    return null;
  }

  riichiAction(seatIdx: number, tileId: number | undefined): string | null {
    if (this.phase !== 'playing' || this.claim) return null;
    if (this.turn !== seatIdx) return '还没轮到你。';
    const seat = this.seats[seatIdx];
    if (seat.riichi) return null;
    if (seat.hand.length % 3 !== 2) return null;
    const faces = rcRiichiDiscards(seat.hand, seat.melds, seat.points);
    if (faces.length === 0) return '现在不能立直。';
    const tile = seat.hand.find((t) => t.id === tileId);
    if (!tile) return null;
    if (!faces.includes(tile.face)) return '这张打出去就不听了。';
    seat.riichi = true;
    seat.ippatsu = true;
    seat.points -= RIICHI_STICK;
    this.riichiSticks++;
    this.doDiscard(seatIdx, tile, true);
    return null;
  }

  private doDiscard(seatIdx: number, tile: RcTile, declaring: boolean): void {
    const seat = this.seats[seatIdx];
    seat.hand.splice(seat.hand.findIndex((t) => t.id === tile.id), 1);
    seat.drawn = null;
    if (seat.riichi && !declaring) seat.ippatsu = false; // 立直后第二打起一发消失
    seat.river.push({ tile, riichi: declaring });
    this.lastDiscard = { seat: seatIdx, tile };
    this.rinshanDraw = false;
    this.openClaims(seatIdx, tile);
  }

  // ── 鸣牌窗口 ─────────────────────────────────────────────────────────────
  private canRon(seatIdx: number, tile: RcTile, houtei: boolean): boolean {
    const seat = this.seats[seatIdx];
    if (seat.hand.length % 3 !== 1) return false;
    const faces = seat.hand.map((t) => t.face);
    const winCounts = rcCounts([...faces, tile.face]);
    if (rcShanten(winCounts, seat.melds.length) !== -1) return false;
    const waits = rcWaits(rcCounts(faces), seat.melds.length);
    if (rcIsFuriten({
      waits,
      discards: seat.river.map((r) => r.tile.face),
      missedSinceDraw: seat.missedSinceDraw,
      riichiMissed: seat.riichiMissed,
    })) return false;
    const result = rcEvaluateWin(this.winInput(seatIdx, tile, false, houtei));
    return !!result && result.hasYaku;
  }

  private openClaims(from: number, tile: RcTile): void {
    const houtei = this.wall.length === 0;
    const eligible = this.seats.map((seat, idx) => {
      if (idx === from) return { ron: false, pon: false, kan: false, chi: false };
      const ron = this.canRon(idx, tile, houtei);
      const canCall = !seat.riichi && !houtei;
      const pon = canCall && rcCanPon(seat.hand, tile.face);
      const kan = canCall && this.rinshan.length > 0 && rcCanMinkan(seat.hand, tile.face);
      const chi = canCall && rcCanChiFrom(from, idx) && rcChiOptions(seat.hand, tile, from).length > 0;
      return { ron, pon, kan, chi };
    });
    if (!eligible.some((e) => e.ron || e.pon || e.kan || e.chi)) {
      this.afterDiscardNoClaim(from);
      return;
    }
    this.claim = {
      tile, from,
      deadline: Date.now() + CLAIM_WINDOW_MS,
      responses: this.seats.map((seat, idx) => {
        const e = eligible[idx];
        if (!(e.ron || e.pon || e.kan || e.chi)) return 'pass';
        // 机器人与立直玩家自动化:能荣和就荣和,其余一律过
        if (seat.isBot || seat.riichi) return e.ron ? 'ron' : 'pass';
        return null;
      }),
      eligible,
      meldChoice: [null, null, null, null],
      houtei,
    };
    this.phase = 'claim';
    this.maybeResolveClaims();
  }

  respond(seatIdx: number, action: RjResponse, meldIds?: number[]): string | null {
    const c = this.claim;
    if (!c) return null;
    if (c.responses[seatIdx] !== null) return null;
    const e = c.eligible[seatIdx];
    if (action !== 'pass' && !e[action]) return null;
    const seat = this.seats[seatIdx];
    if (action === 'chi' || action === 'pon') {
      const options = action === 'chi'
        ? rcChiOptions(seat.hand, c.tile, c.from)
        : rcPonOptions(seat.hand, c.tile, c.from);
      let pick = options[0] ?? null;
      if (meldIds && meldIds.length > 0) {
        const want = [...meldIds].sort((a, b) => a - b).join(',');
        const match = options.find((m) =>
          m.tiles.filter((t) => t.id !== c.tile.id).map((t) => t.id).sort((a, b) => a - b).join(',') === want);
        if (match) pick = match;
      }
      if (!pick) return null;
      c.meldChoice[seatIdx] = pick;
    }
    c.responses[seatIdx] = action;
    this.maybeResolveClaims();
    return null;
  }

  private maybeResolveClaims(force = false): void {
    const c = this.claim;
    if (!c) return;
    if (!force && c.responses.some((r) => r === null)) return;
    for (let i = 0; i < 4; i++) if (c.responses[i] === null) c.responses[i] = 'pass';
    // 见逃标记:有荣和资格却放过 → 同巡振听;立直则永久振听
    for (let i = 0; i < 4; i++) {
      if (c.eligible[i].ron && c.responses[i] !== 'ron') {
        this.seats[i].missedSinceDraw.push(c.tile.face);
        if (this.seats[i].riichi) this.seats[i].riichiMissed = true;
      }
    }
    // 优先级:荣和(头跳:自打牌者顺位最近者)> 杠 > 碰 > 吃
    for (let k = 1; k < 4; k++) {
      const idx = (c.from + k) % 4;
      if (c.responses[idx] === 'ron') { this.doRon(idx); return; }
    }
    for (const kind of ['kan', 'pon', 'chi'] as const) {
      const idx = c.responses.findIndex((r, i) => r === kind && c.eligible[i][kind]);
      if (idx !== -1) { this.takeCall(idx, kind); return; }
    }
    const from = c.from;
    this.claim = null;
    this.phase = 'playing';
    this.afterDiscardNoClaim(from);
  }

  private afterDiscardNoClaim(from: number): void {
    if (this.wall.length === 0) { this.exhaustiveDraw(); return; }
    this.drawFor((from + 1) % 4);
  }

  private clearIppatsuAll(): void {
    for (const seat of this.seats) seat.ippatsu = false;
  }

  private takeCall(seatIdx: number, kind: 'chi' | 'pon' | 'kan'): void {
    const c = this.claim!;
    const seat = this.seats[seatIdx];
    const meld = kind === 'kan'
      ? rcMinkanMeld(seat.hand, c.tile, c.from)
      : (c.meldChoice[seatIdx] ?? (kind === 'chi'
        ? rcChiOptions(seat.hand, c.tile, c.from)[0]
        : rcPonOptions(seat.hand, c.tile, c.from)[0]));
    this.claim = null;
    this.phase = 'playing';
    if (!meld) { this.afterDiscardNoClaim(c.from); return; }
    // 从手里移走自家参与的牌(被叫牌来自牌河)
    for (const t of meld.tiles) {
      if (t.id === c.tile.id) continue;
      const i = seat.hand.findIndex((h) => h.id === t.id);
      if (i !== -1) seat.hand.splice(i, 1);
    }
    this.seats[c.from].river.pop(); // 被叫走
    seat.melds.push(meld);
    seat.drawn = null;
    this.lastDiscard = null;
    this.clearIppatsuAll();
    this.turn = seatIdx;
    if (kind === 'kan') {
      this.doraCount = Math.min(this.doraCount + 1, 5); // 杠后翻新宝牌
      this.rinshanDrawFor(seatIdx);
    } else {
      this.scheduleAuto();
    }
  }

  // ── 自家杠(暗杠 / 加杠) ─────────────────────────────────────────────────
  selfKan(seatIdx: number, tileId: number | undefined): string | null {
    if (this.phase !== 'playing' || this.claim) return null;
    if (this.turn !== seatIdx) return null;
    const seat = this.seats[seatIdx];
    if (seat.hand.length % 3 !== 2) return null;
    if (seat.riichi) return null; // 简化:立直后不杠
    if (this.rinshan.length === 0) return '岭上牌用完,不能再杠。';
    const tile = seat.hand.find((t) => t.id === tileId);
    if (!tile) return null;
    if (rcAnkanFaces(seat.hand).includes(tile.face)) {
      const meld = rcAnkanMeld(seat.hand, tile.face)!;
      for (const t of meld.tiles) seat.hand.splice(seat.hand.findIndex((h) => h.id === t.id), 1);
      seat.melds.push(meld);
    } else if (rcKakanFaces(seat.hand, seat.melds).includes(tile.face)) {
      const meld = rcKakanMeld(tile, seat.melds)!;
      const ponIdx = seat.melds.findIndex((m) => m.kind === 'pon' && m.tiles[0].face === tile.face);
      seat.melds.splice(ponIdx, 1, meld);
      seat.hand.splice(seat.hand.findIndex((h) => h.id === tile.id), 1);
    } else {
      return null;
    }
    seat.drawn = null;
    this.clearIppatsuAll();
    this.doraCount = Math.min(this.doraCount + 1, 5);
    this.rinshanDrawFor(seatIdx);
    return null;
  }

  // ── 和牌 ─────────────────────────────────────────────────────────────────
  private winInput(seatIdx: number, winTile: RcTile, tsumo: boolean, houtei = false) {
    const seat = this.seats[seatIdx];
    return {
      concealed: tsumo ? [...seat.hand] : [...seat.hand, winTile],
      melds: seat.melds,
      winTile,
      tsumo,
      roundWind: 27,
      seatWind: this.seatWindOf(seatIdx),
      riichi: seat.riichi,
      ippatsu: seat.riichi && seat.ippatsu,
      rinshan: tsumo && this.rinshanDraw,
      haitei: tsumo && this.wall.length === 0,
      houtei: !tsumo && houtei,
      doraIndicators: this.doraIndicators(),
      uraIndicators: this.uraIndicators(), // 引擎仅在 riichi 时计入
    };
  }

  tsumoAction(seatIdx: number): string | null {
    if (this.phase !== 'playing' || this.claim) return null;
    if (this.turn !== seatIdx) return null;
    const seat = this.seats[seatIdx];
    if (seat.hand.length % 3 !== 2 || !seat.drawn) return null;
    const result = rcEvaluateWin(this.winInput(seatIdx, seat.drawn, true));
    if (!result) return '还没和牌。';
    if (!result.hasYaku) return '无役,不能和。';
    this.finishWin(seatIdx, null, seat.drawn, true);
    return null;
  }

  private doRon(seatIdx: number): void {
    const c = this.claim!;
    this.claim = null;
    this.seats[c.from].river.pop(); // 和了牌从牌河移走
    this.finishWin(seatIdx, c.from, c.tile, false, c.houtei);
  }

  private finishWin(winner: number, fromSeat: number | null, winTile: RcTile, tsumo: boolean, houtei = false): void {
    const seat = this.seats[winner];
    const result = rcEvaluateWin(this.winInput(winner, winTile, tsumo, houtei))!;
    if (!tsumo) { seat.hand.push(winTile); sortHand(seat.hand); }
    const dealerWin = winner === this.dealer;
    const score = rcScore({
      han: result.han, fu: result.fu, yakuman: result.yakumanCount,
      dealer: dealerWin, tsumo,
    });
    const payments: RjPayment[] = [];
    let total = 0;
    if (score.from.type === 'ron') {
      const pay = score.from.value + 300 * this.honba;
      this.seats[fromSeat!].points -= pay;
      payments.push({ seat: fromSeat!, delta: -pay });
      total += pay;
    } else {
      for (let i = 0; i < 4; i++) {
        if (i === winner) continue;
        const base = score.from.type === 'tsumoDealer'
          ? score.from.each
          : (i === this.dealer ? score.from.dealer : score.from.other);
        const pay = base + 100 * this.honba;
        this.seats[i].points -= pay;
        payments.push({ seat: i, delta: -pay });
        total += pay;
      }
    }
    total += this.riichiSticks * RIICHI_STICK; // 供托归和牌者
    this.riichiSticks = 0;
    seat.points += total;
    payments.unshift({ seat: winner, delta: total });
    this.settle = {
      type: 'win',
      winner, tsumo,
      from: fromSeat,
      winTile,
      yaku: result.yaku.map((y) => ({ ...y })),
      han: result.han,
      fu: result.fu,
      label: score.label,
      total,
      uraIndicators: seat.riichi ? this.uraIndicators() : [],
      payments,
    };
    this.phase = 'finished';
    this.claim = null;
    this.advanceHand(dealerWin, false);
    this.pendingEvents.push({ kind: 'finish', winnerSeat: winner, reward: 30 });
  }

  // ── 荒牌流局 ─────────────────────────────────────────────────────────────
  private exhaustiveDraw(): void {
    const tenpai = this.seats.map((seat) =>
      seat.hand.length % 3 === 1 && rcTenpai(rcCounts(seat.hand.map((t) => t.face)), seat.melds.length));
    const payments: RjPayment[] = [];
    const T = tenpai.filter(Boolean).length;
    if (T > 0 && T < 4) {
      // 简化听牌料:听牌各收 1000,未听者按 100 位均摊
      const noten = tenpai.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      const totalPay = 1000 * T;
      const base = Math.floor(totalPay / noten.length / 100) * 100;
      let rem = totalPay - base * noten.length;
      for (const i of noten) {
        const extra = rem > 0 ? 100 : 0;
        rem -= extra;
        const pay = base + extra;
        this.seats[i].points -= pay;
        payments.push({ seat: i, delta: -pay });
      }
      for (let i = 0; i < 4; i++) {
        if (tenpai[i]) {
          this.seats[i].points += 1000;
          payments.push({ seat: i, delta: 1000 });
        }
      }
    }
    this.settle = { type: 'draw', tenpai, payments };
    this.phase = 'finished';
    this.claim = null;
    this.advanceHand(tenpai[this.dealer], true);
    // 供托留场,由下局和牌者取
  }

  /** 局况推进:连庄 / 进下一局;东4 结束置 gameOver。 */
  private advanceHand(renchan: boolean, draw: boolean): void {
    if (renchan && this.honba < HONBA_CAP) {
      this.honba++;
    } else {
      this.kyoku++;
      this.honba = renchan ? 0 : (draw ? Math.min(this.honba + 1, HONBA_CAP) : 0);
    }
    if (this.kyoku > 3) this.gameOver = true;
  }

  drainEvents(): RjEvent[] {
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  // ── 动作分发(handlers 用) ────────────────────────────────────────────────
  action(s: Session, act: string, tileId?: number, meldIds?: number[]): string | null {
    const seat = this.seatOf(s);
    if (seat === -1) return null;
    switch (act) {
      case 'discard': return this.discardAction(seat, tileId);
      case 'riichi': return this.riichiAction(seat, tileId);
      case 'tsumo': return this.tsumoAction(seat);
      case 'ron':
      case 'pon':
      case 'chi':
      case 'pass':
        if (this.claim) return this.respond(seat, act, meldIds);
        return null;
      case 'kan':
        if (this.claim) return this.respond(seat, 'kan', meldIds);
        return this.selfKan(seat, tileId);
      default: return null;
    }
  }

  // ── tick:鸣牌超时 + 机器人 / 立直自动化 ──────────────────────────────────
  private scheduleAuto(): void {
    this.nextActionAt = Date.now() + 700 + this.rng() * 600;
  }

  /** 返回 true 表示状态有变需广播。 */
  tick(now: number): boolean {
    if (this.phase !== 'playing' && this.phase !== 'claim') return false;
    if (this.claim) {
      if (now > this.claim.deadline) {
        this.maybeResolveClaims(true);
        return true;
      }
      return false;
    }
    const seat = this.seats[this.turn];
    if (!(seat.isBot || seat.riichi)) return false;
    if (now < this.nextActionAt) return false;
    this.autoTurn(this.turn);
    return true;
  }

  private autoTurn(seatIdx: number): void {
    const seat = this.seats[seatIdx];
    if (seat.hand.length % 3 !== 2) { this.scheduleAuto(); return; }
    // 能和就和
    if (seat.drawn) {
      const win = rcEvaluateWin(this.winInput(seatIdx, seat.drawn, true));
      if (win && win.hasYaku) { this.finishWin(seatIdx, null, seat.drawn, true); return; }
    }
    if (seat.riichi) {
      // 立直自动摸切
      const t = seat.drawn ?? seat.hand[seat.hand.length - 1];
      this.doDiscard(seatIdx, t, false);
      return;
    }
    // 机器人:能立直就立直
    const riichiFaces = rcRiichiDiscards(seat.hand, seat.melds, seat.points);
    if (riichiFaces.length > 0) {
      const tile = seat.hand.find((t) => t.face === riichiFaces[0] && !t.red)
        ?? seat.hand.find((t) => t.face === riichiFaces[0])!;
      this.riichiAction(seatIdx, tile.id);
      return;
    }
    // 暗杠(仅暗杠,不吃碰)
    if (this.rinshan.length > 0) {
      const kanFaces = rcAnkanFaces(seat.hand);
      if (kanFaces.length > 0) {
        const tile = seat.hand.find((t) => t.face === kanFaces[0])!;
        this.selfKan(seatIdx, tile.id);
        return;
      }
    }
    this.doDiscard(seatIdx, this.botPickDiscard(seat), false);
  }

  /** 凑数 AI:枚举 14 张各弃一张取向听最小,同向听打最孤的张。 */
  private botPickDiscard(seat: RjSeat): RcTile {
    const counts = rcCounts(seat.hand.map((t) => t.face));
    let best: RcTile = seat.hand[seat.hand.length - 1];
    let bestShanten = 99;
    let bestIso = Infinity;
    for (const face of new Set(seat.hand.map((t) => t.face))) {
      counts[face]--;
      const sh = rcShanten(counts, seat.melds.length);
      counts[face]++;
      let iso = counts[face] * 3;
      if (face < 27) {
        const base = Math.floor(face / 9) * 9;
        for (const n of [face - 2, face - 1, face + 1, face + 2]) {
          if (n >= base && n < base + 9) iso += counts[n];
        }
      }
      if (sh < bestShanten || (sh === bestShanten && iso < bestIso)) {
        bestShanten = sh;
        bestIso = iso;
        best = seat.hand.find((t) => t.face === face && !t.red) ?? seat.hand.find((t) => t.face === face)!;
      }
    }
    return best;
  }

  // ── 视图(按观众身份脱敏) ─────────────────────────────────────────────────
  publicState(): RiichiPublic {
    return {
      tableId: this.tableId,
      kyoku: this.kyoku,
      honba: this.honba,
      roundWind: 27,
      dealer: this.dealer,
      seats: this.seats.map((seat, i): RjSeatPublic => ({
        profile: seat.session ? profileOf(seat.session) : null,
        botName: seat.isBot ? BOT_NAMES[i] : null,
        points: seat.points,
        seatWind: this.seatWindOf(i),
        melds: seat.melds.map((m) => ({ ...m, tiles: m.tiles.map((t) => ({ ...t })) })),
        river: seat.river.map((r) => ({ tile: { ...r.tile }, riichi: r.riichi })),
        riichi: seat.riichi,
        handCount: seat.hand.length,
      })),
      doraIndicators: this.doraIndicators(),
      wallCount: this.wall.length,
      turn: this.turn,
      phase: this.phase,
      lastDiscard: this.lastDiscard ? { seat: this.lastDiscard.seat, tile: { ...this.lastDiscard.tile } } : null,
      riichiSticks: this.riichiSticks,
      claimDeadline: this.claim?.deadline ?? null,
      settle: this.settle,
      gameOver: this.gameOver,
    };
  }

  viewFor(s: Session | null): RiichiView {
    const pub = this.publicState();
    const idx = s ? this.seatOf(s) : -1;
    if (idx === -1) return { pub, priv: null };
    const seat = this.seats[idx];
    const actions: RjActions = {
      discard: false, riichiFaces: [], ankanFaces: [], kakanFaces: [],
      chi: [], pon: [], kan: false, ron: false, tsumo: false, pass: false,
    };
    const c = this.claim;
    if (c && c.responses[idx] === null) {
      const e = c.eligible[idx];
      actions.ron = e.ron;
      actions.kan = e.kan;
      actions.pass = true;
      if (e.pon) actions.pon = rcPonOptions(seat.hand, c.tile, c.from);
      if (e.chi) actions.chi = rcChiOptions(seat.hand, c.tile, c.from);
    } else if (!c && this.phase === 'playing' && this.turn === idx && seat.hand.length % 3 === 2 && !seat.riichi) {
      actions.discard = true;
      actions.riichiFaces = rcRiichiDiscards(seat.hand, seat.melds, seat.points);
      if (this.rinshan.length > 0) {
        actions.ankanFaces = rcAnkanFaces(seat.hand);
        actions.kakanFaces = rcKakanFaces(seat.hand, seat.melds);
      }
      if (seat.drawn) {
        const win = rcEvaluateWin(this.winInput(idx, seat.drawn, true));
        actions.tsumo = !!win && win.hasYaku;
      }
    }
    const waits = seat.hand.length % 3 === 1
      ? rcWaits(rcCounts(seat.hand.map((t) => t.face)), seat.melds.length)
      : [];
    return {
      pub,
      priv: {
        mySeat: idx,
        hand: seat.hand.map((t) => ({ ...t })),
        drawn: seat.drawn ? { ...seat.drawn } : null,
        actions,
        waits,
      },
    };
  }
}
