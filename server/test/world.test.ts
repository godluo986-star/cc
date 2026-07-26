import { describe, it, expect } from 'vitest';
import { testRig, lastOf } from './helpers';
import { handlers } from '../src/game/handlers';
import { packState, Anim, SPACE, roomSpaceKey } from '@nexuspark/shared';

describe('world membership and movement', () => {
  it('joins the plaza and receives peers', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    const initA = world.join(a.session, SPACE.PLAZA)!;
    expect(initA.spaceKey).toBe('plaza');
    world.join(b.session, SPACE.PLAZA);
    const joinMsg = lastOf(a.ws, 'player_join');
    expect(joinMsg?.d.profile.username).toBe('bob');
    // NPCs are included in the roster
    expect(initA.players.some((p) => p.isNpc)).toBe(true);
  });

  it('accepts valid movement and rejects teleports', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    world.join(a.session, SPACE.PLAZA);
    const [sx, , sz] = [a.session.x, a.session.y, a.session.z];
    a.session.lastInputAt = Date.now() - 100;
    handlers.input(world, a.session, { p: [sx + 0.4, 0, sz - 0.4], ry: 1, st: packState(Anim.Walk, false, 0), seq: 1 });
    expect(a.session.x).toBeCloseTo(sx + 0.4, 3);

    a.session.lastInputAt = Date.now() - 50;
    handlers.input(world, a.session, { p: [sx + 200, 0, sz], ry: 1, st: 0, seq: 2 });
    expect(a.session.x).toBeCloseTo(sx + 0.4, 3); // rejected
    expect(lastOf(a.ws, 'correction')).toBeTruthy();
  });

  it('blocks walking into the fountain collider', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    world.join(a.session, SPACE.PLAZA);
    // walk toward the fountain center step by step
    for (let i = 0; i < 60; i++) {
      a.session.lastInputAt = Date.now() - 120;
      const nz = a.session.z - 0.35;
      handlers.input(world, a.session, { p: [0, 0, nz], ry: 0, st: 0, seq: i + 1 });
    }
    expect(Math.hypot(a.session.x, a.session.z)).toBeGreaterThan(4.8);
  });

  it('sits, blocks double-sit, and stands', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    world.join(a.session, SPACE.PLAZA);
    world.join(b.session, SPACE.PLAZA);
    // teleport near a fountain bench seat
    a.session.x = 0; a.session.z = 8; b.session.x = 0; b.session.z = 8;
    handlers.sit(world, a.session, { seatId: 'pb3-s0' });
    expect(a.session.seatId).toBe('pb3-s0');
    handlers.sit(world, b.session, { seatId: 'pb3-s0' });
    expect(b.session.seatId).toBe(null);
    handlers.stand(world, a.session, {});
    expect(a.session.seatId).toBe(null);
    handlers.sit(world, b.session, { seatId: 'pb3-s0' });
    expect(b.session.seatId).toBe('pb3-s0');
  });

  it('enforces door adjacency for space switching', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    world.join(a.session, SPACE.PLAZA);
    // far from the café door: rejected
    handlers.switch_space(world, a.session, { target: SPACE.CAFE });
    expect(a.session.spaceKey).toBe('plaza');
    // move to the café door and try again
    a.session.x = -30; a.session.z = -16.4;
    handlers.switch_space(world, a.session, { target: SPACE.CAFE });
    expect(a.session.spaceKey).toBe('cafe');
  });

  it('chat is rate limited and broadcast', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    world.join(a.session, SPACE.PLAZA);
    world.join(b.session, SPACE.PLAZA);
    for (let i = 0; i < 10; i++) handlers.chat(world, a.session, { text: `msg ${i}` });
    const received = b.ws.sent.filter((m) => m.t === 'chat' && (m.d as any).fromId === a.session.id);
    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThan(10); // limiter kicked in
  });
});

describe('personal rooms', () => {
  it('owner can edit; strangers cannot', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    world.join(a.session, roomSpaceKey(a.session.user.id));
    const room = world.spaces.get(roomSpaceKey(a.session.user.id))!.roomData!;
    const before = room.objects.length;
    handlers.room_edit(world, a.session, { op: 'add', type: 'armchair', x: 2, y: 0, z: 2, ry: 0, color: '#aa5544' });
    expect(room.objects.length).toBe(before + 1);

    world.join(b.session, roomSpaceKey(a.session.user.id));
    handlers.room_edit(world, b.session, { op: 'add', type: 'armchair', x: 1, y: 0, z: 1, ry: 0, color: '#aa5544' });
    expect(room.objects.length).toBe(before + 1); // rejected
  });

  it('respects private visibility', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    const key = roomSpaceKey(a.session.user.id);
    world.join(a.session, key);
    handlers.room_edit(world, a.session, { op: 'visibility', visibility: 'private' });
    world.join(b.session, SPACE.LOBBY);
    b.session.x = 0; b.session.z = -5.0; // near elevator
    handlers.switch_space(world, b.session, { target: key });
    expect(b.session.spaceKey).toBe(SPACE.LOBBY); // denied
    const toast = lastOf(b.ws, 'toast');
    expect(String(toast?.d.text)).toMatch(/private/i);
  });

  it('placing premium furniture requires an unlock', () => {
    const { world, mkSession, db } = testRig();
    const a = mkSession('alice');
    world.join(a.session, roomSpaceKey(a.session.user.id));
    const room = world.spaces.get(roomSpaceKey(a.session.user.id))!.roomData!;
    const before = room.objects.length;
    handlers.room_edit(world, a.session, { op: 'add', type: 'aquarium', x: 2, y: 0, z: -2, ry: 0, color: '#2b6f8f' });
    expect(room.objects.length).toBe(before); // locked
    db.prepare('INSERT INTO unlocks (user_id, furniture_type) VALUES (?, ?)').run(a.session.user.id, 'aquarium');
    handlers.room_edit(world, a.session, { op: 'add', type: 'aquarium', x: 2, y: 0, z: -2, ry: 0, color: '#2b6f8f' });
    expect(room.objects.length).toBe(before + 1);
  });

  it('persists room edits across space reloads', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const key = roomSpaceKey(a.session.user.id);
    world.join(a.session, key);
    handlers.room_edit(world, a.session, { op: 'style', wallColor: '#112233' });
    handlers.room_edit(world, a.session, { op: 'rename', name: 'Cool Cave' });
    world.leaveCurrent(a.session);
    world.spaces.delete(key); // simulate GC
    const reloaded = world.getSpace(key)!;
    expect(reloaded.roomData!.style.wallColor).toBe('#112233');
    expect(reloaded.roomData!.name).toBe('Cool Cave');
  });
});

describe('media sync', () => {
  it('cinema accepts valid urls and syncs position', async () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    world.join(a.session, SPACE.PLAZA);
    a.session.x = 30; a.session.z = -17.4;
    handlers.switch_space(world, a.session, { target: SPACE.CINEMA });
    const cinema = world.spaces.get(SPACE.CINEMA)!;
    handlers.media_set(world, a.session, { url: 'https://example.com/movie.mp4' });
    expect(cinema.media!.url).toBe('https://example.com/movie.mp4');
    expect(cinema.media!.kind).toBe('video');
    expect(cinema.media!.playing).toBe(true);

    handlers.media_ctrl(world, a.session, { op: 'seek', value: 42 });
    expect(cinema.media!.position).toBe(42);
    handlers.media_ctrl(world, a.session, { op: 'pause' });
    expect(cinema.media!.playing).toBe(false);
    expect(cinema.mediaPosition()).toBeCloseTo(42, 0);
  });

  it('normalizes youtube urls and rejects junk', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    world.join(a.session, SPACE.PLAZA);
    a.session.x = 30; a.session.z = -17.4;
    handlers.switch_space(world, a.session, { target: SPACE.CINEMA });
    const cinema = world.spaces.get(SPACE.CINEMA)!;
    handlers.media_set(world, a.session, { url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(cinema.media!.kind).toBe('youtube');
    expect(cinema.media!.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const before = cinema.media!.url;
    handlers.media_set(world, a.session, { url: 'ftp://bad.example/file.mp4' });
    expect(cinema.media!.url).toBe(before);
    expect(String(lastOf(a.ws, 'toast')?.d.text)).toMatch(/unsupported/i);
  });

  it('classifies plain websites as embeddable sites', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    world.join(a.session, SPACE.PLAZA);
    a.session.x = 30; a.session.z = -17.4;
    handlers.switch_space(world, a.session, { target: SPACE.CINEMA });
    const cinema = world.spaces.get(SPACE.CINEMA)!;
    handlers.media_set(world, a.session, { url: 'https://en.wikipedia.org/wiki/Dango' });
    expect(cinema.media!.kind).toBe('site');
  });

  it('room media control respects owner policy', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    const key = roomSpaceKey(a.session.user.id);
    world.join(a.session, key);
    world.join(b.session, key);
    const sp = world.spaces.get(key)!;
    handlers.media_set(world, b.session, { url: 'https://example.com/movie.mp4' });
    expect(sp.media!.url).toBe(null); // guests denied by default
    handlers.room_edit(world, a.session, { op: 'mediaControl', policy: 'guests' });
    handlers.media_set(world, b.session, { url: 'https://example.com/movie.mp4' });
    expect(sp.media!.url).toBe('https://example.com/movie.mp4');
  });
});

describe('arcade games', () => {
  function arcadeRig() {
    const rig = testRig();
    const a = rig.mkSession('alice');
    const b = rig.mkSession('bob');
    for (const p of [a, b]) {
      rig.world.join(p.session, SPACE.PLAZA);
      p.session.x = 29.4; p.session.z = 10;
      handlers.switch_space(rig.world, p.session, { target: SPACE.ARCADE });
      p.session.x = -4.4; p.session.z = -4.2; // near ttt1
    }
    return { ...rig, a, b };
  }

  it('plays a tic-tac-toe game to a win', () => {
    const { world, a, b } = arcadeRig();
    handlers.game_join(world, a.session, { machineId: 'ttt1' });
    handlers.game_join(world, b.session, { machineId: 'ttt1' });
    const sp = world.spaces.get(SPACE.ARCADE)!;
    const t = sp.ttt.get('ttt1')!;
    expect(t.players[0]).toBe(a.session);
    expect(t.players[1]).toBe(b.session);
    // a: 0,1,2 wins; b: 3,4
    handlers.game_move(world, a.session, { machineId: 'ttt1', cell: 0 });
    handlers.game_move(world, b.session, { machineId: 'ttt1', cell: 3 });
    handlers.game_move(world, a.session, { machineId: 'ttt1', cell: 1 });
    handlers.game_move(world, b.session, { machineId: 'ttt1', cell: 4 });
    handlers.game_move(world, a.session, { machineId: 'ttt1', cell: 2 });
    expect(t.winner).toBe(1);
    // moves after win are ignored
    handlers.game_move(world, b.session, { machineId: 'ttt1', cell: 5 });
    expect(t.board[5]).toBe(0);
  });

  it('rejects out-of-turn moves', () => {
    const { world, a, b } = arcadeRig();
    handlers.game_join(world, a.session, { machineId: 'ttt1' });
    handlers.game_join(world, b.session, { machineId: 'ttt1' });
    const t = world.spaces.get(SPACE.ARCADE)!.ttt.get('ttt1')!;
    handlers.game_move(world, b.session, { machineId: 'ttt1', cell: 0 });
    expect(t.board[0]).toBe(0);
  });

  it('lights-out puzzle is solvable and tracked', () => {
    const { world, a } = arcadeRig();
    a.session.x = -1.5; a.session.z = -4.2;
    handlers.game_join(world, a.session, { machineId: 'lo1' });
    const lo = world.spaces.get(SPACE.ARCADE)!.lo.get('lo1')!;
    expect(lo.session).toBe(a.session);
    expect(lo.grid.some((v) => v)).toBe(true);
  });
});

describe('screen sharing + rtc relay', () => {
  it('broadcasts the screen roster and relays signaling for screen-only links', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    world.join(a.session, SPACE.PLAZA);
    world.join(b.session, SPACE.PLAZA);
    // no media on either side: relay refused
    handlers.rtc(world, a.session, { to: b.session.id, kind: 'offer', payload: '{}' });
    expect(lastOf(b.ws, 'rtc')).toBeUndefined();
    // a starts sharing a screen (no voice)
    handlers.screen_share(world, a.session, { on: true });
    const roster = lastOf(b.ws, 'screen_roster');
    expect(roster?.d.ids).toContain(a.session.id);
    handlers.rtc(world, a.session, { to: b.session.id, kind: 'offer', payload: '{}' });
    expect(lastOf(b.ws, 'rtc')?.d.from).toBe(a.session.id);
    // leaving the space clears the flag
    world.leaveCurrent(a.session);
    expect(a.session.screenOn).toBe(false);
  });
});

describe('economy', () => {
  it('vends items with credit deduction', () => {
    const { world, mkSession, db } = testRig();
    const a = mkSession('alice');
    world.join(a.session, SPACE.PLAZA);
    a.session.x = -29.4; a.session.z = 10;
    handlers.switch_space(world, a.session, { target: SPACE.SHOP });
    a.session.x = -3; a.session.z = -4.6;
    const before = (db.prepare('SELECT credits FROM users WHERE id = ?').get(a.session.user.id) as { credits: number }).credits;
    handlers.buy(world, a.session, { itemId: 'soda', source: 'shop-vend1' });
    const after = (db.prepare('SELECT credits FROM users WHERE id = ?').get(a.session.user.id) as { credits: number }).credits;
    expect(before - after).toBe(4);
    const inv = db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?').get(a.session.user.id, 'soda') as { qty: number };
    expect(inv.qty).toBe(1);
    // buying an item the machine doesn't stock is rejected
    handlers.buy(world, a.session, { itemId: 'ticket', source: 'shop-vend1' });
    expect(db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?').get(a.session.user.id, 'ticket')).toBeUndefined();
  });
});
