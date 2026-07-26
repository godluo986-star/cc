/**
 * 立直麻将牌桌(server/src/game/riichiTable.ts)· 注入种子 rng 的全流程测试。
 * 白盒:直接操作公开字段摆牌型,校验摸打/鸣牌/立直/结算/振听/脱敏。
 */
import { describe, it, expect } from 'vitest';
import { testRig } from './helpers';
import { RiichiTable } from '../src/game/riichiTable';
import { rcSeededRng, rcParseFaces, rcTileFromId } from '@nexuspark/shared';
import type { RcTile } from '@nexuspark/shared';

const RED_CAPABLE = [4, 13, 22];

/** 实体牌分配器:同一测试内保证 id 全局唯一;红5 面默认避开 copy0(不出红牌)。 */
function allocator() {
  const next = new Map<number, number>();
  return (face: number): RcTile => {
    const start = RED_CAPABLE.includes(face) ? 1 : 0;
    const copy = next.get(face) ?? start;
    if (copy > 3) throw new Error(`copy overflow for face ${face}`);
    next.set(face, copy + 1);
    return rcTileFromId(face * 4 + copy);
  };
}

const sortHand = (h: RcTile[]) => h.sort((a, b) => a.face - b.face || a.id - b.id);

/** 手动摆桌:东1、座0 为庄,各 13 张,指定余牌;岭上/指示牌为空(宝牌 0)。 */
function stage(
  table: RiichiTable,
  hands: [string, string, string, string],
  wallSpec: string,
  alloc: (f: number) => RcTile,
): void {
  table.phase = 'playing';
  table.kyoku = 0;
  table.honba = 0;
  table.dealer = 0;
  table.turn = 0;
  table.settle = null;
  table.lastDiscard = null;
  table.claim = null;
  table.gameOver = false;
  table.riichiSticks = 0;
  for (let i = 0; i < 4; i++) {
    const st = table.seats[i];
    st.isBot = !st.session;
    st.hand = rcParseFaces(hands[i]).map(alloc);
    sortHand(st.hand);
    st.drawn = null;
    st.melds = [];
    st.river = [];
    st.riichi = false;
    st.ippatsu = false;
    st.missedSinceDraw = [];
    st.riichiMissed = false;
    st.points = 25000;
  }
  table.wall = rcParseFaces(wallSpec).map(alloc);
  table.rinshan = [];
}

/** 给某座“摸”一张指定牌(入手 + 设为自摸牌)。 */
function give(table: RiichiTable, seat: number, faceSpec: string, alloc: (f: number) => RcTile): RcTile {
  const t = alloc(rcParseFaces(faceSpec)[0]);
  table.seats[seat].hand.push(t);
  sortHand(table.seats[seat].hand);
  table.seats[seat].drawn = t;
  return t;
}

const pointsSum = (table: RiichiTable) =>
  table.seats.reduce((a, s) => a + s.points, 0) + table.riichiSticks * 1000;

describe('riichi table · 发牌与轮转', () => {
  it('入座开局:13×4 + 庄家摸 1(共 14),王牌 14 张,宝牌指示 1 张', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const table = new RiichiTable('rj1', rcSeededRng(7));
    expect(table.sit(a.session)).toBeNull();
    expect(table.start(a.session)).toBeNull();
    expect(table.phase).toBe('playing');
    expect(table.dealer).toBe(0);
    expect(table.seats[0].hand.length).toBe(14);
    expect(table.seats[0].drawn).not.toBeNull();
    for (let i = 1; i < 4; i++) expect(table.seats[i].hand.length).toBe(13);
    // 136 - 14(王牌) - 52(配牌) - 1(庄家第一摸) = 69
    expect(table.wall.length).toBe(69);
    expect(table.rinshan.length).toBe(4);
    expect(table.doraIndicators().length).toBe(1);
    expect(table.seats.every((s) => s.points === 25000)).toBe(true);
    // 实体牌 id 全局唯一
    const all = [...table.wall, ...table.rinshan, ...table.seats.flatMap((s) => s.hand)];
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    expect(pointsSum(table)).toBe(100000);
  });

  it('打牌轮转:庄家打出后轮到下家并自动摸牌', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const table = new RiichiTable('rj1', rcSeededRng(7));
    table.sit(a.session);
    table.start(a.session);
    const drawn = table.seats[0].drawn!;
    expect(table.discardAction(0, drawn.id)).toBeNull();
    expect(table.seats[0].hand.length).toBe(13);
    expect(table.seats[0].river.length).toBe(1);
    expect(table.lastDiscard?.seat).toBe(0);
    expect(table.phase).toBe('playing'); // 机器人即时表态,窗口不滞留
    expect(table.turn).toBe(1);
    expect(table.seats[1].hand.length).toBe(14);
  });

  it('碰后轮转正确:碰家立即行牌,打出后轮到其下家', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    const table = new RiichiTable('rj1', rcSeededRng(1));
    table.seats[0].session = a.session;
    table.seats[2].session = b.session;
    const alloc = allocator();
    stage(table, [
      '123m456p789s1122z', // 座0 alice
      '147m147p147s1234z', // 座1 bot
      '55m123s456s99p377z', // 座2 bob:两张 5万 可碰
      '268m258p258s5677z', // 座3 bot
    ], '9999m555666z', alloc);
    const fiveM = give(table, 0, '5m', alloc);
    expect(table.discardAction(0, fiveM.id)).toBeNull();
    expect(table.phase).toBe('claim');
    expect(table.claim?.eligible[2].pon).toBe(true);
    // 鸣牌窗口内 viewFor 给出碰选项
    const bv = table.viewFor(b.session);
    expect(bv.priv?.actions.pon.length).toBeGreaterThan(0);
    expect(bv.priv?.actions.pass).toBe(true);
    expect(table.action(b.session, 'pon')).toBeNull();
    // 碰完成:轮到 bob,面子 +1,手牌 11 张(须打出),牌河被叫走
    expect(table.turn).toBe(2);
    expect(table.seats[2].melds).toHaveLength(1);
    expect(table.seats[2].melds[0].kind).toBe('pon');
    expect(table.seats[2].hand.length).toBe(11);
    expect(table.seats[0].river).toHaveLength(0);
    // bob 打出一张后轮到座3(其下家)
    const out = table.seats[2].hand.find((t) => t.face === 33)!; // 打中
    expect(table.action(b.session, 'discard', out.id)).toBeNull();
    expect(table.turn).toBe(3);
    expect(table.seats[3].hand.length).toBe(14);
  });

  it('鸣牌窗口超时视为 pass:tick 越过 deadline 后自动过并轮转', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    const table = new RiichiTable('rj1', rcSeededRng(1));
    table.seats[0].session = a.session;
    table.seats[2].session = b.session;
    const alloc = allocator();
    stage(table, [
      '123m456p789s1122z',
      '147m147p147s1234z',
      '55m123s456s99p377z',
      '268m258p258s5677z',
    ], '9999m555666z', alloc);
    const fiveM = give(table, 0, '5m', alloc);
    table.discardAction(0, fiveM.id);
    expect(table.phase).toBe('claim');
    const deadline = table.claim!.deadline;
    expect(table.tick(deadline - 1)).toBe(false); // 未到点不动
    expect(table.tick(deadline + 1)).toBe(true);
    expect(table.claim).toBeNull();
    expect(table.phase).toBe('playing');
    expect(table.turn).toBe(1); // 无人鸣牌 → 下家摸牌
    expect(table.seats[1].hand.length).toBe(14);
    expect(table.seats[2].melds).toHaveLength(0);
  });
});

describe('riichi table · 立直 / 和牌 / 振听', () => {
  it('立直:供托 1000、宣言牌横置、之后转服务器自动摸切', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const table = new RiichiTable('rj1', rcSeededRng(1));
    table.seats[0].session = a.session;
    const alloc = allocator();
    stage(table, [
      '123m456m789m2355s', // 打掉多余一张即听 1s/4s
      '147m147p147s1234z',
      '258m258p258s5566z',
      '369m369p369s1122z',
    ], '777z88m', alloc);
    const sevenZ = give(table, 0, '7z', alloc);
    expect(table.action(a.session, 'riichi', sevenZ.id)).toBeNull();
    const st = table.seats[0];
    expect(st.riichi).toBe(true);
    expect(st.ippatsu).toBe(true);
    expect(st.points).toBe(24000);
    expect(table.riichiSticks).toBe(1);
    expect(st.river.at(-1)?.riichi).toBe(true); // 横置标记
    expect(st.river.at(-1)?.tile.face).toBe(33);
    const v = table.viewFor(a.session);
    expect(v.priv?.actions.discard).toBe(false); // 立直后不再手动打牌
    expect(v.priv?.waits.slice().sort((x, y) => x - y)).toEqual([18, 21]); // 听 1s/4s
    expect(v.pub.seats[0].riichi).toBe(true);
    expect(pointsSum(table)).toBe(100000);
  });

  it('荣和结算:断幺九 门清荣和 1番40符,放铳者付 1300,点数守恒', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    const table = new RiichiTable('rj1', rcSeededRng(1));
    table.seats[0].session = a.session;
    table.seats[1].session = b.session;
    const alloc = allocator();
    stage(table, [
      '123m111p999s1122z', // alice
      '234m456m678m456p7s', // bob:听 7s 单骑,全断幺
      '147m147p258s1234z',
      '369m369p369s5566z',
    ], '11114444s', alloc);
    give(table, 0, '7s', alloc);
    const sevenS = table.seats[0].drawn!;
    expect(table.discardAction(0, sevenS.id)).toBeNull();
    expect(table.phase).toBe('claim');
    expect(table.claim?.eligible[1].ron).toBe(true);
    expect(table.action(b.session, 'ron')).toBeNull();
    expect(table.phase).toBe('finished');
    const s = table.settle!;
    expect(s.type).toBe('win');
    if (s.type !== 'win') return;
    expect(s.winner).toBe(1);
    expect(s.tsumo).toBe(false);
    expect(s.from).toBe(0);
    expect(s.yaku.map((y) => y.name)).toContain('断幺九');
    expect(s.han).toBe(1);
    expect(s.fu).toBe(40); // 门清荣和一律 40 符(引擎简化)
    expect(s.total).toBe(1300); // 40符1番 base 320 × 4 → 1300
    expect(s.uraIndicators).toEqual([]); // 未立直不公开里宝牌
    expect(s.payments).toContainEqual({ seat: 0, delta: -1300 });
    expect(table.seats[1].points).toBe(26300);
    expect(table.seats[0].points).toBe(23700);
    expect(pointsSum(table)).toBe(100000);
    expect(table.kyoku).toBe(1); // 闲家和牌 → 进东2
    const events = table.drainEvents();
    expect(events).toContainEqual({ kind: 'finish', winnerSeat: 1, reward: 30 });
  });

  it('自摸分摊:闲家自摸 2番30符,庄付 1000 闲各付 500', () => {
    const { mkSession } = testRig();
    const b = mkSession('bob');
    const table = new RiichiTable('rj1', rcSeededRng(1));
    table.seats[1].session = b.session;
    const alloc = allocator();
    stage(table, [
      '123m111p999s1122z',
      '234m456m678m456p7s', // bob:听 7s 单骑
      '147m147p258s1234z',
      '369m369p369s5566z',
    ], '11114444s', alloc);
    table.turn = 1;
    give(table, 1, '7s', alloc);
    expect(table.action(b.session, 'tsumo')).toBeNull();
    expect(table.phase).toBe('finished');
    const s = table.settle!;
    expect(s.type).toBe('win');
    if (s.type !== 'win') return;
    const names = s.yaku.map((y) => y.name);
    expect(names).toContain('门前清自摸和');
    expect(names).toContain('断幺九');
    expect(s.han).toBe(2);
    expect(s.fu).toBe(30);
    expect(s.total).toBe(2000); // base 480:庄 1000 + 闲 500×2
    expect(s.payments).toContainEqual({ seat: 0, delta: -1000 });
    expect(s.payments).toContainEqual({ seat: 2, delta: -500 });
    expect(s.payments).toContainEqual({ seat: 3, delta: -500 });
    expect(table.seats[1].points).toBe(27000);
    expect(pointsSum(table)).toBe(100000);
  });

  it('振听禁荣和:自家牌河有听牌张时不开鸣牌窗口', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    const table = new RiichiTable('rj1', rcSeededRng(1));
    table.seats[0].session = a.session;
    table.seats[1].session = b.session;
    const alloc = allocator();
    stage(table, [
      '123m111p999s1122z',
      '234m456m678m456p7s', // bob 听 7s,但牌河已有 7s → 振听
      '147m147p258s1234z',
      '369m369p369s5566z',
    ], '11114444s', alloc);
    table.seats[1].river.push({ tile: alloc(rcParseFaces('7s')[0]), riichi: false });
    give(table, 0, '7s', alloc);
    const sevenS = table.seats[0].drawn!;
    expect(table.discardAction(0, sevenS.id)).toBeNull();
    // 振听 → 无人可鸣 → 直接轮转,不结算
    expect(table.claim).toBeNull();
    expect(table.phase).toBe('playing');
    expect(table.settle).toBeNull();
    expect(table.turn).toBe(1);
    expect(table.seats[1].hand.length).toBe(14);
  });

  it('bot 补位自动打完一局:tick 快进至 finished,点数守恒 100000(含供托)', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const table = new RiichiTable('rj-bot', rcSeededRng(123));
    table.sit(a.session);
    table.start(a.session);
    table.leave(a.session); // 机器人接管 → 四家全自动
    expect(table.seats[0].isBot).toBe(true);
    let now = Date.now();
    for (let i = 0; i < 4000 && table.phase !== 'finished'; i++) {
      now += 500;
      table.tick(now);
    }
    expect(table.phase).toBe('finished');
    expect(table.settle).not.toBeNull();
    expect(pointsSum(table)).toBe(100000);
    // 局况已推进(连庄加本场或进下一局)
    expect(table.kyoku + table.honba).toBeGreaterThan(0);
  });

  it('viewFor 脱敏:他家手牌只给张数,旁观者与未入座者无私有视图', () => {
    const { mkSession } = testRig();
    const a = mkSession('alice');
    const c = mkSession('carol');
    const table = new RiichiTable('rj1', rcSeededRng(7));
    table.sit(a.session);
    table.start(a.session);
    const mine = table.viewFor(a.session);
    expect(mine.priv?.mySeat).toBe(0);
    expect(mine.priv?.hand.length).toBe(14);
    // 公共视图不含任何别家手牌实体,只有张数
    for (let i = 1; i < 4; i++) {
      const seatPub = mine.pub.seats[i] as unknown as Record<string, unknown>;
      expect(seatPub.hand).toBeUndefined();
      expect(seatPub.drawn).toBeUndefined();
      expect(mine.pub.seats[i].handCount).toBe(13);
    }
    expect(mine.pub.settle).toBeNull(); // 结算前不公开里宝牌
    const spectator = table.viewFor(c.session);
    expect(spectator.priv).toBeNull();
    expect(table.viewFor(null).priv).toBeNull();
    // 全部可 JSON 序列化(round-trip 不丢字段)
    expect(JSON.parse(JSON.stringify(mine))).toEqual(mine);
  });
});
