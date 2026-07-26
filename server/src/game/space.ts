import type { DB } from '../db/database';
import { kvGet, kvSet } from '../db/database';
import type {
  SpaceLayout, Interactable, ChatMsg, MediaState, MusicState, Stroke, RoomData,
  EntitySnap, ObjSnap, TicTacToeState, LightsOutState, PublicProfile, NpcDef, BoardPost,
} from '@nexuspark/shared';
import {
  LAYOUTS, ROOM_BOUNDS, ROOM_DOOR, ROOM_SWITCH, FURNITURE_BY_TYPE, CHAT_HISTORY,
  isRoomSpace, roomOwnerId, Anim, packState, dist2d,
} from '@nexuspark/shared';
import type { Collider } from '@nexuspark/shared';
import { loadRoom } from './roomService';
import type { Session } from './session';
import { sendRaw, send } from './session';
import { encode } from '@nexuspark/shared';

export interface SeatDef { x: number; y: number; z: number; ry: number; }

interface NpcRuntime {
  def: NpcDef;
  x: number; z: number; ry: number;
  wpIdx: number;
  pauseUntil: number;
  moving: boolean;
}

export interface TttInternal {
  machineId: string;
  board: number[];
  players: [Session | null, Session | null];
  turn: 1 | 2;
  winner: 0 | 1 | 2 | 3;
}
export interface LoInternal {
  machineId: string;
  grid: boolean[];
  moves: number;
  session: Session | null;
  best: { name: string; moves: number } | null;
}

const BALL_R = 0.36;

export class Space {
  readonly key: string;
  readonly label: string;
  readonly layout: SpaceLayout;
  readonly isRoom: boolean;
  roomData: RoomData | null = null;

  sessions = new Set<Session>();
  chat: ChatMsg[] = [];
  seats = new Map<string, SeatDef>();
  seatOcc = new Map<string, number>();
  whiteboards = new Map<string, Stroke[]>();
  wbDirty = new Set<string>();
  switches = new Map<string, boolean>();
  media: MediaState | null = null;
  music: MusicState | null = null;
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null = null;
  npcs: NpcRuntime[] = [];
  colliders: Collider[] = [];
  ttt = new Map<string, TttInternal>();
  lo = new Map<string, LoInternal>();
  emptySince = Date.now();
  /** True if this space supports a synchronized media screen. */
  readonly hasScreen: boolean;
  readonly hasMusic: boolean;

  constructor(private db: DB, key: string) {
    this.key = key;
    this.isRoom = isRoomSpace(key);
    if (this.isRoom) {
      const ownerId = roomOwnerId(key);
      const room = ownerId ? loadRoom(db, ownerId) : null;
      if (!room) throw new Error(`room not found for ${key}`);
      this.roomData = room;
      this.label = room.name;
      this.layout = {
        key, label: room.name, indoor: true, bounds: ROOM_BOUNDS,
        spawn: [0, 0, 3.6, Math.PI],
        colliders: [], interactables: [ROOM_DOOR, ROOM_SWITCH], props: [], npcs: [], heightZones: [],
      };
      this.hasScreen = true;
      this.hasMusic = true;
      this.rebuildRoomDerived();
    } else {
      const layout = LAYOUTS[key];
      if (!layout) throw new Error(`unknown space ${key}`);
      this.layout = layout;
      this.label = layout.label;
      this.hasScreen = layout.mediaPolicy === 'everyone';
      this.hasMusic = layout.interactables.some((i) => i.kind === 'jukebox');
      this.colliders = [...layout.colliders];
      for (const i of layout.interactables) {
        if (i.kind === 'seat') this.seats.set(i.id, { x: i.pos[0], y: i.pos[1], z: i.pos[2], ry: i.ry });
        if (i.kind === 'whiteboard') {
          const boardId = String(i.data?.boardId ?? i.id);
          this.whiteboards.set(boardId, this.loadWhiteboard(boardId));
        }
        if (i.kind === 'switch') {
          const swId = String(i.data?.switchId ?? i.id);
          this.switches.set(swId, kvGet(this.db, `switch:${key}:${swId}`, true));
        }
        if (i.kind === 'ttt') {
          this.ttt.set(i.id, { machineId: i.id, board: Array(9).fill(0), players: [null, null], turn: 1, winner: 0 });
        }
        if (i.kind === 'lightsout') {
          this.lo.set(i.id, {
            machineId: i.id, grid: Array(25).fill(false), moves: 0, session: null,
            best: kvGet(this.db, `lo-best:${i.id}`, null as { name: string; moves: number } | null),
          });
        }
      }
      this.npcs = layout.npcs.map((def) => ({
        def, x: def.waypoints[0][0], z: def.waypoints[0][1], ry: 0, wpIdx: 0, pauseUntil: 0, moving: false,
      }));
      if (layout.hasBall) this.ball = { x: -12, y: BALL_R, z: 24, vx: 0, vy: 0, vz: 0 };
    }
    if (this.hasScreen) this.media = this.loadMedia();
    if (this.hasMusic) this.music = { trackId: null, startedAt: 0, setBy: null };
  }

  // ── Personal-room derived data (colliders, seats, whiteboards) ────────────
  rebuildRoomDerived(): void {
    if (!this.roomData) return;
    const colliders: Collider[] = [];
    const seats = new Map<string, SeatDef>();
    const wbIds = new Set<string>();
    for (const o of this.roomData.objects) {
      const def = FURNITURE_BY_TYPE[o.type];
      if (!def) continue;
      const [w, d] = def.size;
      const solid = def.type !== 'rug' && !def.wallMounted && def.interaction !== 'seat' ? true : false;
      // seats stay walk-through-able so avatars can reach them; big solids collide
      if (solid && Math.max(w, d) > 0.45) {
        const c = Math.abs(Math.cos(o.ry));
        const s = Math.abs(Math.sin(o.ry));
        colliders.push({ kind: 'box', x: o.x, z: o.z, w: c * w + s * d, d: s * w + c * d });
      }
      if (def.interaction === 'seat' && def.seats) {
        def.seats.forEach((sp, i) => {
          const cos = Math.cos(o.ry), sin = Math.sin(o.ry);
          seats.set(`obj:${o.id}:s${i}`, {
            x: o.x + sp.x * cos + sp.z * sin,
            y: o.y + sp.y,
            z: o.z - sp.x * sin + sp.z * cos,
            ry: o.ry + sp.ry,
          });
        });
      }
      if (def.interaction === 'whiteboard') wbIds.add(`obj:${o.id}`);
    }
    this.colliders = colliders;
    // Preserve occupancy of seats that still exist
    for (const [seatId] of this.seatOcc) if (!seats.has(seatId)) this.seatOcc.delete(seatId);
    this.seats = seats;
    for (const id of wbIds) if (!this.whiteboards.has(id)) this.whiteboards.set(id, this.loadWhiteboard(id));
    for (const id of [...this.whiteboards.keys()]) if (!wbIds.has(id)) this.whiteboards.delete(id);
  }

  // ── Interactable lookup with range validation ─────────────────────────────
  findInteractable(id: string): Interactable | null {
    const it = this.layout.interactables.find((i) => i.id === id);
    return it ?? null;
  }
  isNear(s: Session, x: number, z: number, range = 4.5): boolean {
    return dist2d(s.x, s.z, x, z) <= range;
  }

  // ── Whiteboard persistence ────────────────────────────────────────────────
  private wbKey(boardId: string) { return `${this.key}#${boardId}`; }
  private loadWhiteboard(boardId: string): Stroke[] {
    const row = this.db.prepare('SELECT strokes FROM whiteboards WHERE board_key = ?').get(this.wbKey(boardId)) as { strokes: string } | undefined;
    if (!row) return [];
    try { return JSON.parse(row.strokes) as Stroke[]; } catch { return []; }
  }
  flushWhiteboards(): void {
    for (const boardId of this.wbDirty) {
      const strokes = this.whiteboards.get(boardId) ?? [];
      this.db.prepare('INSERT INTO whiteboards (board_key, strokes) VALUES (?, ?) ON CONFLICT(board_key) DO UPDATE SET strokes = excluded.strokes')
        .run(this.wbKey(boardId), JSON.stringify(strokes));
    }
    this.wbDirty.clear();
  }

  // ── Media persistence ─────────────────────────────────────────────────────
  private loadMedia(): MediaState {
    const row = this.db.prepare('SELECT * FROM media_states WHERE space_key = ?').get(this.key) as
      | { url: string | null; kind: string | null; playing: number; position: number; rate: number; loop: number; updated_at: number; set_by: string | null }
      | undefined;
    if (!row) return { url: null, kind: null, playing: false, position: 0, rate: 1, loop: false, updatedAt: Date.now(), setBy: null };
    return {
      url: row.url, kind: (row.kind as 'video' | 'youtube' | null),
      playing: !!row.playing, position: row.position, rate: row.rate || 1,
      loop: !!row.loop, updatedAt: row.updated_at, setBy: row.set_by,
    };
  }
  saveMedia(): void {
    if (!this.media) return;
    const m = this.media;
    this.db.prepare(
      `INSERT INTO media_states (space_key, url, kind, playing, position, rate, loop, updated_at, set_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(space_key) DO UPDATE SET url=excluded.url, kind=excluded.kind, playing=excluded.playing,
         position=excluded.position, rate=excluded.rate, loop=excluded.loop, updated_at=excluded.updated_at, set_by=excluded.set_by`
    ).run(this.key, m.url, m.kind, m.playing ? 1 : 0, m.position, m.rate, m.loop ? 1 : 0, m.updatedAt, m.setBy);
  }
  /** Current playhead position, extrapolated. */
  mediaPosition(now = Date.now()): number {
    if (!this.media || !this.media.url) return 0;
    return this.media.playing ? this.media.position + ((now - this.media.updatedAt) / 1000) * this.media.rate : this.media.position;
  }

  saveSwitch(switchId: string, on: boolean): void {
    if (this.isRoom) return; // room master light lives in room style
    kvSet(this.db, `switch:${this.key}:${switchId}`, on);
  }

  // ── Boards ────────────────────────────────────────────────────────────────
  boardKey(boardId: string) { return `${this.key}#${boardId}`; }
  loadBoard(boardId: string): BoardPost[] {
    const rows = this.db.prepare(
      'SELECT id, user_id, username, text, created_at FROM board_posts WHERE board_key = ? ORDER BY id DESC LIMIT 40'
    ).all(this.boardKey(boardId)) as Array<{ id: number; user_id: number; username: string; text: string; created_at: number }>;
    return rows.map((r) => ({ id: r.id, userId: r.user_id, username: r.username, text: r.text, createdAt: r.created_at }));
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  pushChat(msg: ChatMsg): void {
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY) this.chat.splice(0, this.chat.length - CHAT_HISTORY);
  }

  // ── Broadcast helpers ─────────────────────────────────────────────────────
  broadcast(t: string, d?: unknown, except?: Session): void {
    const raw = encode(t, d);
    for (const s of this.sessions) if (s !== except) sendRaw(s, raw);
  }

  // ── Tick: NPCs + ball ─────────────────────────────────────────────────────
  tickNpcs(dt: number, now: number): void {
    for (const n of this.npcs) {
      const wps = n.def.waypoints;
      if (wps.length < 2) { n.moving = false; continue; }
      if (now < n.pauseUntil) { n.moving = false; continue; }
      const [tx, tz] = wps[(n.wpIdx + 1) % wps.length];
      const dx = tx - n.x, dz = tz - n.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        n.wpIdx = (n.wpIdx + 1) % wps.length;
        n.pauseUntil = now + n.def.pause * 1000 * (0.6 + Math.random() * 0.8);
        n.moving = false;
      } else {
        const step = Math.min(d, n.def.speed * dt);
        n.x += (dx / d) * step;
        n.z += (dz / d) * step;
        n.ry = Math.atan2(dx, dz);
        n.moving = true;
      }
    }
  }

  pauseNpc(npcId: number, faceX: number, faceZ: number, ms = 9000): void {
    const n = this.npcs.find((v) => v.def.id === npcId);
    if (!n) return;
    n.pauseUntil = Date.now() + ms;
    n.ry = Math.atan2(faceX - n.x, faceZ - n.z);
    n.moving = false;
  }

  tickBall(dt: number): void {
    const b = this.ball;
    if (!b) return;
    const speed = Math.hypot(b.vx, b.vz);
    if (speed < 0.03 && b.y <= BALL_R + 0.001 && Math.abs(b.vy) < 0.05) { b.vx = 0; b.vz = 0; b.vy = 0; return; }
    b.vy -= 12 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy) > 0.8 ? -b.vy * 0.5 : 0; }
    const drag = b.y <= BALL_R + 0.01 ? Math.pow(0.35, dt) : Math.pow(0.85, dt);
    b.vx *= drag; b.vz *= drag;
    const bd = this.layout.bounds;
    if (b.x < bd.minX + BALL_R) { b.x = bd.minX + BALL_R; b.vx = Math.abs(b.vx); }
    if (b.x > bd.maxX - BALL_R) { b.x = bd.maxX - BALL_R; b.vx = -Math.abs(b.vx); }
    if (b.z < bd.minZ + BALL_R) { b.z = bd.minZ + BALL_R; b.vz = Math.abs(b.vz); }
    if (b.z > bd.maxZ - BALL_R) { b.z = bd.maxZ - BALL_R; b.vz = -Math.abs(b.vz); }
    for (const c of this.colliders) {
      if (c.kind === 'circle') {
        const dx = b.x - c.x, dz = b.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + BALL_R;
        if (d < min && d > 1e-6) {
          b.x = c.x + (dx / d) * min; b.z = c.z + (dz / d) * min;
          const dot = (b.vx * dx + b.vz * dz) / d;
          if (dot < 0) { b.vx -= 1.7 * dot * (dx / d); b.vz -= 1.7 * dot * (dz / d); }
        }
      } else {
        const hw = c.w / 2 + BALL_R, hd = c.d / 2 + BALL_R;
        const dx = b.x - c.x, dz = b.z - c.z;
        if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
          const px = hw - Math.abs(dx), pz = hd - Math.abs(dz);
          if (px < pz) { b.x = c.x + Math.sign(dx || 1) * hw; b.vx = -b.vx * 0.7; }
          else { b.z = c.z + Math.sign(dz || 1) * hd; b.vz = -b.vz * 0.7; }
        }
      }
    }
  }

  kickBall(s: Session, dirX: number, dirZ: number): boolean {
    const b = this.ball;
    if (!b) return false;
    if (dist2d(s.x, s.z, b.x, b.z) > 2.2) return false;
    const len = Math.hypot(dirX, dirZ) || 1;
    b.vx = (dirX / len) * 7.5;
    b.vz = (dirZ / len) * 7.5;
    b.vy = 3.6;
    return true;
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────
  buildSnapshot(now: number): { e: EntitySnap[]; o?: ObjSnap[] } {
    const e: EntitySnap[] = [];
    for (const s of this.sessions) {
      e.push([s.id, round2(s.x), round2(s.y), round2(s.z), round3(s.ry), s.st]);
    }
    for (const n of this.npcs) {
      const st = packState(n.moving ? Anim.Walk : Anim.Idle, false, 0);
      e.push([n.def.id, round2(n.x), 0, round2(n.z), round3(n.ry), st]);
    }
    const o: ObjSnap[] | undefined = this.ball
      ? [['ball', round2(this.ball.x), round2(this.ball.y), round2(this.ball.z)]]
      : undefined;
    return o ? { e, o } : { e };
  }

  npcProfiles(): PublicProfile[] {
    return this.npcs.map((n) => ({
      id: n.def.id, userId: 0, username: n.def.name, avatar: n.def.avatar, isNpc: true,
    }));
  }

  tttPublic(t: TttInternal): TicTacToeState {
    return {
      machineId: t.machineId, board: [...t.board],
      players: [
        t.players[0] ? { id: t.players[0].id, userId: t.players[0].user.id, username: t.players[0].user.username, avatar: t.players[0].user.avatar } : null,
        t.players[1] ? { id: t.players[1].id, userId: t.players[1].user.id, username: t.players[1].user.username, avatar: t.players[1].user.avatar } : null,
      ],
      turn: t.turn, winner: t.winner,
    };
  }
  loPublic(l: LoInternal): LightsOutState {
    return {
      machineId: l.machineId, grid: [...l.grid], moves: l.moves,
      playerId: l.session?.id ?? null, playerName: l.session?.user.username ?? null,
      best: l.best?.moves ?? null,
    };
  }

  /** Remove a session from any game machines it occupies. */
  dropFromGames(s: Session): void {
    for (const t of this.ttt.values()) {
      const idx = t.players.indexOf(s);
      if (idx >= 0) {
        t.players[idx] = null;
        t.board = Array(9).fill(0);
        t.turn = 1;
        t.winner = 0;
        this.broadcast('game_ttt', this.tttPublic(t));
      }
    }
    for (const l of this.lo.values()) {
      if (l.session === s) {
        l.session = null;
        this.broadcast('game_lo', this.loPublic(l));
      }
    }
  }

  voiceRoster(): number[] {
    return [...this.sessions].filter((s) => s.voiceOn).map((s) => s.id);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export { BALL_R };
