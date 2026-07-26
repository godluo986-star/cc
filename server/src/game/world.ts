import type { DB } from '../db/database';
import { kvGet, kvSet } from '../db/database';
import { log } from '../config';
import { Space } from './space';
import type { Session } from './session';
import { send, sendRaw, profileOf } from './session';
import {
  SPACE, LAYOUTS, isRoomSpace, roomOwnerId, roomSpaceKey, ROOM_SPAWN,
  DAY_LENGTH_SEC, DAY_START_FRACTION, WEATHERS, WEATHER_MIN_SEC, WEATHER_MAX_SEC,
  SNAPSHOT_RATE, encode, RESUME_GRACE_MS,
  clampToBounds, resolveCollisions, floorHeightAt, PLAYER_RADIUS, dist3d,
  SPRING_K, DAMPING, MAX_FORCE, MASS, MAX_VEL, BREAK_DIST, ESCAPE_BREAK,
} from '@nexuspark/shared';
import type { Weather, WorldEnv, SpaceInit, SelfState, InventoryEntry, ChatMsg } from '@nexuspark/shared';
import { loadRoom } from './roomService';

export class World {
  spaces = new Map<string, Space>();
  sessionsById = new Map<number, Session>();
  sessionsByUser = new Map<number, Session>();
  /** Recently disconnected users → where to restore them (grace resume). */
  resumeInfo = new Map<number, { spaceKey: string; pos: [number, number, number]; ry: number; at: number }>();

  private envStart = Date.now();
  private envStartFraction = DAY_START_FRACTION;
  weather: Weather = 'clear';
  private weatherUntil = 0;
  private lastEnvBroadcast = 0;
  private lastPersist = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();

  constructor(public db: DB) {
    this.envStartFraction = kvGet(db, 'env:timeOfDay', DAY_START_FRACTION);
    this.weather = kvGet(db, 'env:weather', 'clear');
    this.weatherUntil = Date.now() + (WEATHER_MIN_SEC + Math.random() * (WEATHER_MAX_SEC - WEATHER_MIN_SEC)) * 1000;
    this.getSpace(SPACE.PLAZA); // pre-warm the main space
  }

  start(): void {
    const interval = 1000 / SNAPSHOT_RATE;
    this.lastTick = Date.now();
    this.tickTimer = setInterval(() => this.tick(), interval);
    log.info('world tick started at', SNAPSHOT_RATE, 'Hz');
  }
  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.persistAll();
  }

  // ── Environment ───────────────────────────────────────────────────────────
  timeOfDay(now = Date.now()): number {
    return (this.envStartFraction + (now - this.envStart) / 1000 / DAY_LENGTH_SEC) % 1;
  }
  envState(now = Date.now()): WorldEnv {
    return { timeOfDay: this.timeOfDay(now), at: now, dayLengthSec: DAY_LENGTH_SEC, weather: this.weather };
  }

  // ── Space registry ────────────────────────────────────────────────────────
  getSpace(key: string): Space | null {
    let space = this.spaces.get(key);
    if (space) return space;
    try {
      space = new Space(this.db, key);
    } catch (e) {
      log.debug('getSpace failed', key, e);
      return null;
    }
    this.spaces.set(key, space);
    return space;
  }

  roomOnlineCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const [key, space] of this.spaces) {
      const ownerId = roomOwnerId(key);
      if (ownerId && space.sessions.size > 0) counts.set(ownerId, space.sessions.size);
    }
    return counts;
  }

  // ── Membership ────────────────────────────────────────────────────────────
  /** Validates that `session` may enter `target` from its current space. */
  canSwitch(session: Session, target: string): { ok: true } | { ok: false; reason: string } {
    if (target === session.spaceKey) return { ok: false, reason: '你已经在这里啦。' };
    if (target === SPACE.PLAZA) return { ok: true }; // always allowed (safety hatch)
    if (isRoomSpace(target)) {
      const ownerId = roomOwnerId(target);
      if (!ownerId) return { ok: false, reason: '房间编号不对。' };
      if (session.spaceKey !== SPACE.LOBBY && session.spaceKey !== target) {
        return { ok: false, reason: '拜访房间要坐团子塔的电梯。' };
      }
      if (ownerId === session.user.id) return { ok: true };
      const room = this.spaces.get(target)?.roomData ?? loadRoom(this.db, ownerId);
      if (!room) return { ok: false, reason: '这个房间不存在。' };
      if (room.visibility === 'private') return { ok: false, reason: '这个房间是私密的。' };
      return { ok: true };
    }
    if (!LAYOUTS[target]) return { ok: false, reason: '不认识的目的地。' };
    const current = this.spaces.get(session.spaceKey);
    const hasDoor = current?.layout.interactables.some((i) => i.kind === 'door' && i.data?.target === target);
    if (!hasDoor) return { ok: false, reason: '这里没有通往那边的门。' };
    return { ok: true };
  }

  join(session: Session, spaceKey: string, spawnOverride?: [number, number, number, number]): SpaceInit | null {
    const space = this.getSpace(spaceKey) ?? this.getSpace(SPACE.PLAZA)!;
    const [sx, sy, sz, sry] = spawnOverride ?? space.layout.spawn;
    session.spaceKey = space.key;
    session.x = sx; session.y = sy; session.z = sz; session.ry = sry;
    session.st = 0;
    session.seatId = null;

    space.sessions.add(session);
    space.emptySince = 0;
    space.broadcast('player_join', { profile: profileOf(session) }, session);
    space.broadcast('voice_roster', this.voicePayload(space));
    space.broadcast('screen_roster', { ids: space.screenRoster() });
    this.systemChat(space, `${session.user.username} 来了`);
    return this.buildSpaceInit(space, session);
  }

  leaveCurrent(session: Session, reason?: string): void {
    const space = this.spaces.get(session.spaceKey);
    if (!space) return;
    this.releaseGrabsFor(session); // 抓取者/被抓者任一方离开 → 解除并广播 released
    this.releaseSeat(session, space);
    space.dropFromGames(session);
    space.sessions.delete(session);
    const wasWorldVoice = session.voiceOn && session.voiceScope === 'world';
    session.voiceOn = false;
    session.voiceScope = 'near';
    session.screenOn = false;
    this.clearShareIfOwner(space, session.id);
    space.broadcast('player_leave', { id: session.id, reason });
    space.broadcast('voice_roster', this.voicePayload(space));
    space.broadcast('screen_roster', { ids: space.screenRoster() });
    this.systemChat(space, `${session.user.username} 离开了`);
    if (space.sessions.size === 0) space.emptySince = Date.now();
    if (wasWorldVoice) this.broadcastVoiceRosters();
  }

  switchSpace(session: Session, target: string, spawnOverride?: [number, number, number, number]): SpaceInit | null {
    const check = this.canSwitch(session, target);
    if (!check.ok) {
      send(session, 'toast', { level: 'warn', text: check.reason });
      return null;
    }
    // Determine arrival point: door's declared spawn, else layout spawn
    let spawn = spawnOverride;
    if (!spawn) {
      const current = this.spaces.get(session.spaceKey);
      const door = current?.layout.interactables.find((i) => i.kind === 'door' && i.data?.target === target);
      const doorSpawn = door?.data?.spawn as [number, number, number, number] | undefined;
      spawn = doorSpawn ?? (isRoomSpace(target) ? ROOM_SPAWN : undefined);
    }
    this.leaveCurrent(session);
    return this.join(session, target, spawn);
  }

  /** 大屏正在放某会话的共享画面,而该会话停止共享/离开空间时:自动清屏并广播。 */
  clearShareIfOwner(space: Space, sessionId: number): void {
    const m = space.media;
    if (!m || m.kind !== 'share' || m.ownerId !== sessionId) return;
    space.media = { url: null, kind: null, playing: false, position: 0, rate: 1, loop: false, updatedAt: Date.now(), setBy: m.setBy, revision: (m.revision ?? 0) + 1 };
    space.saveMedia();
    space.broadcast('media_state', space.media);
  }

  releaseSeat(session: Session, space: Space): void {
    if (!session.seatId) return;
    space.seatOcc.delete(session.seatId);
    space.broadcast('seat', { seatId: session.seatId, playerId: session.id, released: true });
    session.seatId = null;
  }

  // ── 抓取(服务器权威点质量模拟)────────────────────────────────────────────
  /** 该会话涉及的所有抓取关系一并解除(离开空间/断线时调用)。 */
  releaseGrabsFor(session: Session): void {
    if (session.grabbing !== null) this.releaseGrab(session, 'released');
    if (session.grabbedBy !== null) {
      const grabber = this.sessionsById.get(session.grabbedBy);
      if (grabber && grabber.grabbing === session.id) this.releaseGrab(grabber, 'released');
      session.grabbedBy = null;
      session.escapeDir = [0, 0, 0];
      session.escapeAccum = 0;
    }
  }

  /** 解除 grabber 的抓取;phase: released(松手/被动解除)或 broken(拉断/挣脱)。 */
  releaseGrab(grabber: Session, phase: 'released' | 'broken'): void {
    const targetId = grabber.grabbing;
    if (targetId === null) return;
    const pointLocal = grabber.grabPointLocal ?? ([0, 0, 0] as [number, number, number]);
    grabber.grabbing = null;
    grabber.grabPointLocal = null;
    grabber.grabTargetWorld = null;
    const target = this.sessionsById.get(targetId) ?? null;
    if (target && target.grabbedBy === grabber.id) {
      target.grabbedBy = null;
      target.escapeAccum = 0;
      target.escapeDir = [0, 0, 0];
      // 保留当前 grabVel:离地/带速则进入自然抛落阶段,落地即恢复
      const sp2 = this.spaces.get(target.spaceKey);
      const floor = sp2 ? floorHeightAt(sp2.layout, target.x, target.z) : 0;
      const speed = Math.hypot(target.grabVel[0], target.grabVel[1], target.grabVel[2]);
      target.grabAirborne = target.y > floor + 0.03 || speed > 0.5;
      if (!target.grabAirborne) target.grabVel = [0, 0, 0];
    }
    const sp = this.spaces.get(grabber.spaceKey) ?? (target ? this.spaces.get(target.spaceKey) : undefined);
    sp?.broadcast('grab_state', { grabberId: grabber.id, targetId, pointLocal, phase });
    if (phase === 'broken') {
      send(grabber, 'toast', { level: 'info', text: '没抓住,溜了。' });
      if (target) send(target, 'toast', { level: 'info', text: '挣脱了!' });
    }
  }

  /** 每 tick:对本空间所有被抓/抛落中的会话做弹簧-重力积分与解算。 */
  tickGrabs(space: Space, dt: number): void {
    for (const t of [...space.sessions]) {
      if (t.grabbedBy === null) {
        if (t.grabAirborne) this.tickFall(space, t, dt);
        continue;
      }
      const g = this.sessionsById.get(t.grabbedBy);
      if (!g || g.grabbing !== t.id || g.spaceKey !== t.spaceKey) {
        // 悬空引用(理论上不该发生):就地清理
        t.grabbedBy = null;
        t.escapeDir = [0, 0, 0];
        t.escapeAccum = 0;
        continue;
      }
      const target = g.grabTargetWorld ?? [t.x, t.y, t.z];
      const v = t.grabVel;
      // 弹簧:F = K*(target-pos) - DAMPING*vel,‖F‖≤MAX_FORCE
      let fx = SPRING_K * (target[0] - t.x) - DAMPING * v[0];
      let fy = SPRING_K * (target[1] - t.y) - DAMPING * v[1];
      let fz = SPRING_K * (target[2] - t.z) - DAMPING * v[2];
      const fn = Math.hypot(fx, fy, fz);
      if (fn > MAX_FORCE) { const k = MAX_FORCE / fn; fx *= k; fy *= k; fz *= k; }
      fy -= 9.8 * MASS; // 重力
      // 挣扎:方向非零加 6N 力并积累时间;方向为零缓慢衰减
      const ed = t.escapeDir;
      if (Math.hypot(ed[0], ed[1], ed[2]) > 1e-3) {
        fx += ed[0] * 6; fy += ed[1] * 6; fz += ed[2] * 6;
        t.escapeAccum += dt;
      } else {
        t.escapeAccum = Math.max(0, t.escapeAccum - dt * 0.5);
      }
      // 积分 + 限速
      v[0] += (fx / MASS) * dt; v[1] += (fy / MASS) * dt; v[2] += (fz / MASS) * dt;
      const vn = Math.hypot(v[0], v[1], v[2]);
      if (vn > MAX_VEL) { const k = MAX_VEL / vn; v[0] *= k; v[1] *= k; v[2] *= k; }
      let nx = t.x + v[0] * dt, ny = t.y + v[1] * dt, nz = t.z + v[2] * dt;
      if (!Number.isFinite(nx + ny + nz)) { this.grabSafetyReset(space, g, t); continue; }
      // 共享碰撞解算:不穿墙、不出界、不穿地
      [nx, nz] = clampToBounds(nx, nz, space.layout.bounds);
      [nx, nz] = resolveCollisions(nx, nz, PLAYER_RADIUS, space.colliders);
      const floor = floorHeightAt(space.layout, nx, nz);
      if (ny <= floor) { ny = floor; if (v[1] < 0) v[1] = 0; }
      t.x = nx; t.y = ny; t.z = nz;
      if (t.y < -4) { this.grabSafetyReset(space, g, t); continue; }
      // 断裂:拉太远,或挣扎积累够秒数
      if (dist3d(t.x, t.y, t.z, g.x, g.y, g.z) > BREAK_DIST || t.escapeAccum >= ESCAPE_BREAK) {
        this.releaseGrab(g, 'broken');
      }
    }
  }

  /** 松手/挣脱后的自由抛落:重力积分直到落地。 */
  private tickFall(space: Space, t: Session, dt: number): void {
    const v = t.grabVel;
    v[1] -= 9.8 * dt;
    const vn = Math.hypot(v[0], v[1], v[2]);
    if (vn > MAX_VEL) { const k = MAX_VEL / vn; v[0] *= k; v[1] *= k; v[2] *= k; }
    let nx = t.x + v[0] * dt, ny = t.y + v[1] * dt, nz = t.z + v[2] * dt;
    if (!Number.isFinite(nx + ny + nz)) { this.grabSafetyReset(space, null, t); return; }
    [nx, nz] = clampToBounds(nx, nz, space.layout.bounds);
    [nx, nz] = resolveCollisions(nx, nz, PLAYER_RADIUS, space.colliders);
    const floor = floorHeightAt(space.layout, nx, nz);
    if (ny <= floor) {
      ny = floor;
      t.grabAirborne = false;
      t.grabVel = [0, 0, 0];
    } else {
      const drag = Math.pow(0.5, dt);
      v[0] *= drag; v[2] *= drag;
    }
    t.x = nx; t.y = ny; t.z = nz;
    if (t.y < -4) this.grabSafetyReset(space, null, t);
  }

  /** 安全复位:坐标 NaN 或掉出世界(y<-4)→ 释放并送回本空间出生点。 */
  private grabSafetyReset(space: Space, grabber: Session | null, t: Session): void {
    if (grabber) this.releaseGrab(grabber, 'released');
    const [sx, sy, sz, sry] = space.layout.spawn;
    t.x = sx; t.y = sy; t.z = sz; t.ry = sry;
    t.grabVel = [0, 0, 0];
    t.grabAirborne = false;
    t.escapeDir = [0, 0, 0];
    t.escapeAccum = 0;
    send(t, 'toast', { level: 'info', text: '摔出了世界边缘,已把你送回出生点。' });
  }

  disconnect(session: Session, kicked = false): void {
    session.closed = true;
    if (!kicked) {
      this.resumeInfo.set(session.user.id, {
        spaceKey: session.spaceKey, pos: [session.x, session.y, session.z], ry: session.ry, at: Date.now(),
      });
    }
    this.persistSessionPos(session);
    this.leaveCurrent(session, kicked ? 'kicked' : 'disconnected');
    this.sessionsById.delete(session.id);
    if (this.sessionsByUser.get(session.user.id) === session) this.sessionsByUser.delete(session.user.id);
  }

  persistSessionPos(session: Session): void {
    try {
      this.db.prepare('UPDATE users SET last_space = ?, last_pos = ? WHERE id = ?')
        .run(session.spaceKey, JSON.stringify([session.x, session.y, session.z]), session.user.id);
    } catch (e) {
      log.error('persist pos failed', e);
    }
  }

  /** Space + spawn a fresh connection should land in (handles grace resume). */
  entryFor(userId: number, lastSpace: string | null, lastPos: [number, number, number] | null):
    { spaceKey: string; spawn?: [number, number, number, number] } {
    const grace = this.resumeInfo.get(userId);
    if (grace && Date.now() - grace.at < RESUME_GRACE_MS) {
      this.resumeInfo.delete(userId);
      if (this.spaceAccessible(userId, grace.spaceKey)) {
        return { spaceKey: grace.spaceKey, spawn: [grace.pos[0], grace.pos[1], grace.pos[2], grace.ry] };
      }
    }
    if (lastSpace && this.spaceAccessible(userId, lastSpace)) {
      if (lastPos) return { spaceKey: lastSpace, spawn: [lastPos[0], lastPos[1], lastPos[2], 0] };
      return { spaceKey: lastSpace };
    }
    return { spaceKey: SPACE.PLAZA };
  }

  private spaceAccessible(userId: number, key: string): boolean {
    if (LAYOUTS[key]) return true;
    const ownerId = roomOwnerId(key);
    if (!ownerId) return false;
    if (ownerId === userId) return !!loadRoom(this.db, ownerId);
    const room = this.spaces.get(key)?.roomData ?? loadRoom(this.db, ownerId);
    return !!room && room.visibility === 'public';
  }

  // ── Init payloads ─────────────────────────────────────────────────────────
  buildSpaceInit(space: Space, session: Session): SpaceInit {
    const players = [...space.sessions].map(profileOf).concat(space.npcProfiles());
    const { e, o } = space.buildSnapshot(Date.now());
    const boards: Record<string, never[] | ReturnType<Space['loadBoard']>> = {};
    for (const i of space.layout.interactables) {
      if (i.kind === 'board') boards[i.id] = space.loadBoard(i.id);
    }
    const media = space.media ? { ...space.media, position: space.mediaPosition(), updatedAt: Date.now() } : null;
    // riichi 字段由并行工单并入 SpaceInit.games 类型;先经变量赋值绕过冗余属性检查
    const games = {
      tictactoe: [...space.ttt.values()].map((t) => space.tttPublic(t)),
      lightsout: [...space.lo.values()].map((l) => space.loPublic(l)),
      xiangqi: [...space.xq.values()].map((t) => t.publicState()),
      mahjong: [...space.mj.values()].map((t) => t.viewFor(session)),
      riichi: [...space.rj.values()].map((t) => t.viewFor(session)),
    };
    return {
      spaceKey: space.key,
      label: space.label,
      selfId: session.id,
      spawn: [session.x, session.y, session.z, session.ry],
      players,
      snaps: e,
      seats: [...space.seatOcc.entries()].map(([seatId, playerId]) => ({ seatId, playerId })),
      chat: space.chat.slice(-40),
      media,
      music: space.music,
      whiteboards: Object.fromEntries(space.whiteboards),
      boards,
      switches: Object.fromEntries(space.switches),
      objs: o ?? [],
      room: space.roomData,
      games,
      voiceRoster: space.voiceRoster(),
      voiceWorldRoster: this.worldVoiceIds(),
      screenRoster: space.screenRoster(),
    };
  }

  /** 全服"全世界语音"广播者(任何空间的人都应听到并与其建链)。 */
  worldVoiceIds(): number[] {
    return [...this.sessionsById.values()]
      .filter((s) => s.voiceOn && s.voiceScope === 'world')
      .map((s) => s.id);
  }

  voicePayload(space: Space): { ids: number[]; world: number[] } {
    return { ids: space.voiceRoster(), world: this.worldVoiceIds() };
  }

  /** 世界语音名单变化时,通知所有有人的空间。 */
  broadcastVoiceRosters(): void {
    for (const space of this.spaces.values()) {
      if (space.sessions.size > 0) space.broadcast('voice_roster', this.voicePayload(space));
    }
  }

  buildSelfState(session: Session): SelfState {
    const inv = this.db.prepare('SELECT item_id, qty FROM inventory WHERE user_id = ? AND qty > 0').all(session.user.id) as Array<{ item_id: string; qty: number }>;
    const unlocks = this.db.prepare('SELECT furniture_type FROM unlocks WHERE user_id = ?').all(session.user.id) as Array<{ furniture_type: string }>;
    const credits = (this.db.prepare('SELECT credits FROM users WHERE id = ?').get(session.user.id) as { credits: number }).credits;
    session.user.credits = credits;
    const inventory: InventoryEntry[] = inv.map((r) => ({ itemId: r.item_id, qty: r.qty }));
    return {
      userId: session.user.id, username: session.user.username, avatar: session.user.avatar,
      credits, inventory, unlocks: unlocks.map((u) => u.furniture_type),
    };
  }

  systemChat(space: Space, text: string): void {
    const msg: ChatMsg = { from: '', fromId: 0, text, ts: Date.now(), system: true };
    space.pushChat(msg);
    space.broadcast('chat', msg);
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  private tick(): void {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;

    // Weather changes
    if (now >= this.weatherUntil) {
      const roll = Math.random();
      const next: Weather = roll < 0.5 ? 'clear' : roll < 0.8 ? 'cloudy' : 'rain';
      this.weatherUntil = now + (WEATHER_MIN_SEC + Math.random() * (WEATHER_MAX_SEC - WEATHER_MIN_SEC)) * 1000;
      if (next !== this.weather) {
        this.weather = next;
        this.broadcastAll('env', this.envState(now));
        this.lastEnvBroadcast = now;
      }
    }
    // Periodic env sync (clients extrapolate; this corrects drift)
    if (now - this.lastEnvBroadcast > 10000) {
      this.lastEnvBroadcast = now;
      this.broadcastAll('env', this.envState(now));
    }

    for (const [key, space] of this.spaces) {
      if (space.sessions.size > 0) {
        space.tickNpcs(dt, now);
        space.tickBall(dt);
        this.tickGrabs(space, dt);
        for (const table of space.mj.values()) {
          if (table.tick(now)) {
            space.broadcastMahjong(table);
            for (const ev of table.drainEvents()) {
              if (ev.kind === 'finish') this.settleMahjong(space, table, ev.winnerSeat, ev.winKind, ev.reward);
            }
          }
        }
        for (const table of space.rj.values()) {
          if (table.tick(now)) {
            space.broadcastRiichi(table);
            this.settleRiichi(space, table);
          }
        }
        const snap = space.buildSnapshot(now);
        const raw = encode('snap', { t: now, ...snap });
        for (const s of space.sessions) sendRaw(s, raw);
      } else if (space.emptySince && now - space.emptySince > 5 * 60 * 1000 && isRoomSpace(key)) {
        space.flushWhiteboards();
        this.spaces.delete(key); // room spaces are reloaded from DB on next visit
      }
    }

    if (now - this.lastPersist > 5000) {
      this.lastPersist = now;
      this.persistAll(false);
    }
    // Expire stale resume grace entries
    for (const [uid, info] of this.resumeInfo) {
      if (now - info.at > RESUME_GRACE_MS) this.resumeInfo.delete(uid);
    }
  }

  persistAll(final = true): void {
    kvSet(this.db, 'env:timeOfDay', this.timeOfDay());
    kvSet(this.db, 'env:weather', this.weather);
    for (const space of this.spaces.values()) {
      space.flushWhiteboards();
      if (final) {
        for (const s of space.sessions) this.persistSessionPos(s);
      }
    }
  }

  /** 结算麻将胡牌:发彩头 + 系统播报。 */
  settleMahjong(space: Space, table: Space['mj'] extends Map<string, infer T> ? T : never, winnerSeat: number, winKind: string, reward: number): void {
    const seat = table.seats[winnerSeat];
    const kindText = winKind === 'sanjindao' ? '三金倒!' : winKind === 'zimo' ? '自摸' : '胡牌';
    if (seat.session) {
      this.db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(reward, seat.session.user.id);
      send(seat.session, 'self_update', this.buildSelfState(seat.session));
      this.systemChat(space, `${seat.session.user.username} ${kindText} 赢了 ${reward} 金币!`);
    } else {
      this.systemChat(space, `机器人${kindText},下次加油!`);
    }
  }

  /** 结算日麻和牌:排空 pendingEvents,给真人赢家发信用点 + 系统播报。 */
  settleRiichi(space: Space, table: Space['rj'] extends Map<string, infer T> ? T : never): void {
    for (const ev of table.drainEvents()) {
      if (ev.kind !== 'finish') continue;
      const seat = table.seats[ev.winnerSeat];
      if (seat.session) {
        this.db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(ev.reward, seat.session.user.id);
        send(seat.session, 'self_update', this.buildSelfState(seat.session));
        this.systemChat(space, `${seat.session.user.username} 在立直麻将桌和牌,赢了 ${ev.reward} 金币!`);
      } else {
        this.systemChat(space, '立直麻将桌上机器人和牌了,下次加油!');
      }
    }
  }

  broadcastAll(t: string, d: unknown): void {
    const raw = encode(t, d);
    for (const s of this.sessionsById.values()) sendRaw(s, raw);
  }
}
