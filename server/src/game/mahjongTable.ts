/**
 * 福州麻将牌桌(服务器权威)。不能吃;碰/杠/胡;开金(翻金定百搭);
 * 三金倒即胡。空位由陪打机器人补齐。简化说明见 README:无游金/抢金、
 * 无番数计算(固定彩头)、无补杠。
 */
import type { Session } from './session';
import { profileOf } from './session';
import {
  mjFullWall, mjCanWin, mjSanJinDao, mjCounts,
} from '@nexuspark/shared';
import type { MahjongPublic, MahjongView, MjMeld, MjSeatPublic } from '@nexuspark/shared';

interface Seat {
  session: Session | null;
  isBot: boolean;
  hand: number[];
  melds: MjMeld[];
  discards: number[];
  drawn: number | null;
}

interface Claim {
  tile: number;
  from: number;
  deadline: number;
  /** seat → 'hu' | 'pong' | 'kong' | 'pass' | null(未表态) */
  responses: (string | null)[];
  eligible: { hu: boolean; pong: boolean; kong: boolean }[];
}

export type MjEvent =
  | { kind: 'state' }
  | { kind: 'finish'; winnerSeat: number; winKind: 'hu' | 'zimo' | 'sanjindao'; reward: number }
  | { kind: 'toast'; session: Session; text: string };

export class MahjongTable {
  seats: Seat[] = Array.from({ length: 4 }, () => ({
    session: null, isBot: false, hand: [], melds: [], discards: [], drawn: null,
  }));
  phase: 'waiting' | 'playing' | 'finished' = 'waiting';
  wall: number[] = [];
  turn = 0;
  dealer = 0;
  goldFace = -1;
  winner = -1;
  winKind: 'hu' | 'zimo' | 'sanjindao' | null = null;
  lastDiscard: { seat: number; tile: number } | null = null;
  claim: Claim | null = null;
  /** 机器人/超时的下一次动作时间(tick 驱动)。 */
  nextActionAt = 0;

  constructor(public tableId: string) {}

  seatOf(s: Session): number {
    return this.seats.findIndex((x) => x.session === s);
  }

  sit(s: Session): string | null {
    if (this.seatOf(s) !== -1) return null;
    const free = this.seats.findIndex((x) => !x.session && !(this.phase === 'playing' && x.isBot === false));
    const idx = this.phase === 'playing'
      ? this.seats.findIndex((x) => !x.session && x.isBot) // 顶替机器人
      : this.seats.findIndex((x) => !x.session);
    if (idx === -1) return '桌子满了,先看看牌局吧!';
    this.seats[idx].session = s;
    this.seats[idx].isBot = false;
    void free;
    return null;
  }

  leave(s: Session): void {
    const idx = this.seatOf(s);
    if (idx === -1) return;
    this.seats[idx].session = null;
    if (this.phase === 'playing') {
      this.seats[idx].isBot = true; // 机器人接手
      this.scheduleBot();
    } else {
      this.seats[idx] = { session: null, isBot: false, hand: [], melds: [], discards: [], drawn: null };
    }
  }

  start(s: Session): string | null {
    if (this.phase === 'playing') return '牌局进行中。';
    if (this.seatOf(s) === -1) return '先坐下再开局。';
    for (const seat of this.seats) {
      if (!seat.session) seat.isBot = true;
      seat.hand = []; seat.melds = []; seat.discards = []; seat.drawn = null;
    }
    this.phase = 'playing';
    this.winner = -1;
    this.winKind = null;
    this.lastDiscard = null;
    this.claim = null;
    this.dealer = this.seats.findIndex((x) => x.session) >= 0 ? this.seatOf(s) : 0;
    // 洗牌发牌
    this.wall = mjFullWall();
    for (let i = this.wall.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.wall[i], this.wall[j]] = [this.wall[j], this.wall[i]];
    }
    for (let r = 0; r < 13; r++) {
      for (let p = 0; p < 4; p++) this.seats[(this.dealer + p) % 4].hand.push(this.wall.pop()!);
    }
    // 开金
    this.goldFace = this.wall.shift()!; // 从牌墙头翻一张定金
    for (const seat of this.seats) seat.hand.sort((a, b) => a - b);
    // 三金倒检查(起手)
    for (let p = 0; p < 4; p++) {
      if (mjSanJinDao(this.seats[p].hand, this.goldFace)) {
        return this.finish(p, 'sanjindao'), null;
      }
    }
    this.turn = this.dealer;
    this.drawFor(this.turn);
    return null;
  }

  private drawFor(seat: number): void {
    if (this.wall.length === 0) {
      this.phase = 'finished';
      this.winner = -2;
      this.winKind = null;
      return;
    }
    const t = this.wall.pop()!;
    this.seats[seat].hand.push(t);
    this.seats[seat].hand.sort((a, b) => a - b);
    this.seats[seat].drawn = t;
    if (mjSanJinDao(this.seats[seat].hand, this.goldFace)) {
      this.finish(seat, 'sanjindao');
      return;
    }
    this.scheduleBot();
  }

  /** 出牌(当前回合玩家)。 */
  discard(seatIdx: number, tile: number): string | null {
    if (this.phase !== 'playing' || this.claim) return null;
    if (this.turn !== seatIdx) return '还没轮到你出牌。';
    const seat = this.seats[seatIdx];
    const i = seat.hand.indexOf(tile);
    if (i === -1) return null;
    seat.hand.splice(i, 1);
    seat.drawn = null;
    seat.discards.push(tile);
    this.lastDiscard = { seat: seatIdx, tile };
    this.openClaims(seatIdx, tile);
    return null;
  }

  private openClaims(from: number, tile: number): void {
    const eligible = this.seats.map((seat, idx) => {
      if (idx === from || this.phase !== 'playing') return { hu: false, pong: false, kong: false };
      const counts = mjCounts(seat.hand);
      const pong = counts[tile] >= 2;
      const kong = counts[tile] >= 3;
      const hu = mjCanWin([...seat.hand, tile], this.goldFace);
      return { hu, pong, kong };
    });
    const anyone = eligible.some((e) => e.hu || e.pong || e.kong);
    if (!anyone) {
      this.advanceTurn(from);
      return;
    }
    this.claim = {
      tile, from,
      deadline: Date.now() + 6500,
      responses: this.seats.map((seat, idx) => {
        const e = eligible[idx];
        if (!(e.hu || e.pong || e.kong)) return 'pass';
        if (seat.isBot) return e.hu ? 'hu' : 'pass'; // 机器人只胡不碰
        return null;
      }),
      eligible,
    };
    this.maybeResolveClaims();
  }

  respond(seatIdx: number, action: 'hu' | 'pong' | 'kong' | 'pass'): string | null {
    const c = this.claim;
    if (!c) return null;
    const e = c.eligible[seatIdx];
    if (!e || c.responses[seatIdx] !== null) return null;
    if (action !== 'pass' && !e[action]) return null;
    c.responses[seatIdx] = action;
    this.maybeResolveClaims();
    return null;
  }

  private maybeResolveClaims(force = false): void {
    const c = this.claim;
    if (!c) return;
    const pending = c.responses.some((r) => r === null);
    if (pending && !force) return;
    // 优先级:胡 > 杠 > 碰
    const pick = (kind: string) => c.responses.findIndex((r, i) => r === kind && c.eligible[i][kind as 'hu']);
    let seat = c.responses.findIndex((r) => r === 'hu');
    if (seat !== -1) {
      const tile = c.tile;
      this.claim = null;
      this.seats[seat].hand.push(tile);
      this.finish(seat, 'hu');
      return;
    }
    seat = c.responses.findIndex((r) => r === 'kong');
    if (seat !== -1) {
      const { tile, from } = c;
      this.claim = null;
      this.takeMeld(seat, tile, from, 'kong');
      return;
    }
    seat = c.responses.findIndex((r) => r === 'pong');
    if (seat !== -1) {
      const { tile, from } = c;
      this.claim = null;
      this.takeMeld(seat, tile, from, 'pong');
      return;
    }
    void pick;
    const from = c.from;
    this.claim = null;
    this.advanceTurn(from);
  }

  private takeMeld(seatIdx: number, tile: number, from: number, kind: 'pong' | 'kong'): void {
    const seat = this.seats[seatIdx];
    const need = kind === 'pong' ? 2 : 3;
    for (let n = 0; n < need; n++) seat.hand.splice(seat.hand.indexOf(tile), 1);
    this.seats[from].discards.pop(); // 从弃牌河拿走
    seat.melds.push({ kind, tile, from });
    this.lastDiscard = null;
    this.turn = seatIdx;
    if (kind === 'kong') {
      this.drawFor(seatIdx); // 杠上补一张
    } else {
      seat.drawn = null;
      this.scheduleBot();
    }
  }

  /** 自摸胡 / 暗杠(轮到自己时)。 */
  selfAction(seatIdx: number, action: 'hu' | 'kong', tile?: number): string | null {
    if (this.phase !== 'playing' || this.claim || this.turn !== seatIdx) return null;
    const seat = this.seats[seatIdx];
    if (action === 'hu') {
      if (!mjCanWin(seat.hand, this.goldFace)) return '还差一点,不能胡。';
      this.finish(seatIdx, 'zimo');
      return null;
    }
    // 暗杠
    const t = tile ?? -1;
    const counts = mjCounts(seat.hand);
    if (t < 0 || counts[t] < 4) return null;
    for (let n = 0; n < 4; n++) seat.hand.splice(seat.hand.indexOf(t), 1);
    seat.melds.push({ kind: 'kong', tile: t, from: seatIdx });
    this.drawFor(seatIdx);
    return null;
  }

  private pendingEvents: MjEvent[] = [];

  private finish(seat: number, kind: 'hu' | 'zimo' | 'sanjindao'): void {
    this.phase = 'finished';
    this.winner = seat;
    this.winKind = kind;
    this.claim = null;
    const reward = kind === 'sanjindao' ? 36 : kind === 'zimo' ? 24 : 18;
    this.pendingEvents.push({ kind: 'finish', winnerSeat: seat, winKind: kind, reward });
  }

  drainEvents(): MjEvent[] {
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  private scheduleBot(): void {
    this.nextActionAt = Date.now() + 900 + Math.random() * 600;
  }

  /** tick 驱动:机器人出牌 + 超时判定。返回 true 表示状态有变化需广播。 */
  tick(now: number): boolean {
    if (this.phase !== 'playing') return false;
    // 超时的抢牌窗口 → 未表态视为过
    if (this.claim && now > this.claim.deadline) {
      for (let i = 0; i < 4; i++) if (this.claim.responses[i] === null) this.claim.responses[i] = 'pass';
      this.maybeResolveClaims(true);
      return true;
    }
    if (this.claim) return false;
    const seat = this.seats[this.turn];
    if (!seat.isBot || now < this.nextActionAt) return false;
    // 机器人回合:能胡就胡,否则出一张最"孤"的非金牌
    if (mjCanWin(seat.hand, this.goldFace)) {
      this.finish(this.turn, 'zimo');
      return true;
    }
    const counts = mjCounts(seat.hand);
    let best = seat.hand[0];
    let bestScore = Infinity;
    for (const t of new Set(seat.hand)) {
      if (t === this.goldFace) continue; // 金不打
      let score = counts[t] * 3;
      if (t < 27) {
        const base = Math.floor(t / 9) * 9;
        for (const n of [t - 2, t - 1, t + 1, t + 2]) {
          if (n >= base && n < base + 9) score += counts[n];
        }
      }
      if (score < bestScore) { bestScore = score; best = t; }
    }
    this.discard(this.turn, best);
    return true;
  }

  private advanceTurn(from: number): void {
    this.turn = (from + 1) % 4;
    this.drawFor(this.turn);
  }

  dropSession(s: Session): boolean {
    const idx = this.seatOf(s);
    if (idx === -1) return false;
    this.leave(s);
    return true;
  }

  // ── 视图(按观众身份脱敏) ──────────────────────────────────────────────
  publicState(): MahjongPublic {
    return {
      tableId: this.tableId,
      phase: this.phase,
      seats: this.seats.map((seat): MjSeatPublic => ({
        profile: seat.session ? profileOf(seat.session) : null,
        isBot: seat.isBot,
        handCount: seat.hand.length,
        melds: seat.melds.map((m) => ({ ...m })),
        discards: [...seat.discards],
      })) as MahjongPublic['seats'],
      turn: this.turn,
      goldFace: this.goldFace,
      wallCount: this.wall.length,
      dealer: this.dealer,
      winner: this.winner,
      winKind: this.winKind,
      lastDiscard: this.lastDiscard ? { ...this.lastDiscard } : null,
      claimDeadline: this.claim?.deadline ?? null,
    };
  }

  viewFor(s: Session | null): MahjongView {
    const pub = this.publicState();
    const idx = s ? this.seatOf(s) : -1;
    if (idx === -1) return { pub, priv: null };
    const seat = this.seats[idx];
    const claimE = this.claim?.eligible[idx];
    const awaitingMe = !!this.claim && this.claim.responses[idx] === null;
    const myDiscardTurn = !this.claim && this.phase === 'playing' && this.turn === idx && seat.hand.length % 3 === 2;
    return {
      pub,
      priv: {
        mySeat: idx,
        hand: [...seat.hand],
        drawn: seat.drawn,
        canHu: awaitingMe ? !!claimE?.hu : (myDiscardTurn && mjCanWin(seat.hand, this.goldFace)),
        canPong: awaitingMe ? !!claimE?.pong : false,
        canKong: awaitingMe
          ? !!claimE?.kong
          : (myDiscardTurn && [...new Set(seat.hand)].some((t) => mjCounts(seat.hand)[t] >= 4)),
        mustAct: awaitingMe || myDiscardTurn,
      },
    };
  }
}
