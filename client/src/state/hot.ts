/**
 * Hot per-frame entity state, kept OUTSIDE React so 10-20Hz network updates
 * and 60fps interpolation never trigger re-renders. React components read
 * from here inside useFrame via refs.
 */
import type { PublicProfile, EntitySnap } from '@nexuspark/shared';
import { INTERP_DELAY_MS, unpackState, Anim } from '@nexuspark/shared';
import { angleLerp } from '@nexuspark/shared';

export interface SnapPoint { t: number; x: number; y: number; z: number; ry: number; st: number; }

export interface RemoteEntity {
  id: number;
  profile: PublicProfile;
  buf: SnapPoint[];
  x: number; y: number; z: number; ry: number; st: number;
  /** Transient emote override. */
  emoteAnim: number;
  emoteUntil: number;
  /** Live voice activity level 0..1 (from WebRTC analyser). */
  voiceLevel: number;
  /** 抓取:谁抓着这只团子(会话 id;null=没被抓)。 */
  grabbedBy: number | null;
  /** 抓取:身体局部抓取点(驱动侧倾表现)。 */
  grabPointLocal: [number, number, number] | null;
}

export interface LocalState {
  x: number; y: number; z: number; ry: number;
  vy: number;
  grounded: boolean;
  anim: number;
  held: number;
  heldUntil: number;
  emoteAnim: number;
  emoteUntil: number;
  seatId: string | null;
  seatRy: number;
  speaking: boolean;
  /** Walk cycle phase for footstep sounds. */
  stepPhase: number;
  /** 被谁抓着(会话 id;非空 → 本地预测暂停,吸附服务器快照)。 */
  grabbedBy: number | null;
  /** 自己正抓着谁(会话 id)。 */
  grabbing: number | null;
  /** 自己被抓时的身体局部抓取点(侧倾表现用)。 */
  grabPointLocal: [number, number, number] | null;
}

export interface CameraRig {
  yaw: number; pitch: number; dist: number;
  shake: number;
  /** 'third' 第三人称跟随;'first' 第一人称(V 键切换)。 */
  mode: 'third' | 'first';
}

export interface BallState { x: number; y: number; z: number; active: boolean; rx: number; rz: number; }

class HotState {
  selfId = 0;
  local: LocalState = {
    x: 0, y: 0, z: 0, ry: 0, vy: 0, grounded: true, anim: 0,
    held: 0, heldUntil: 0, emoteAnim: 0, emoteUntil: 0, seatId: null, seatRy: 0,
    speaking: false, stepPhase: 0, grabbedBy: null, grabbing: null, grabPointLocal: null,
  };
  camera: CameraRig = { yaw: Math.PI, pitch: 0.32, dist: 5.2, shake: 0, mode: 'third' };
  players = new Map<number, RemoteEntity>();
  /** 自己在服务器 10Hz snap 里的最新条目(被抓时本地预测吸附它)。 */
  selfSnap: SnapPoint | null = null;
  ball: BallState = { x: 0, y: 0, z: 0, active: false, rx: 0, rz: 0 };
  /** Server time offset estimate (serverNow ≈ Date.now() + offset). */
  serverTimeOffset = 0;
  keys = new Set<string>();
  /** 手机虚拟摇杆向量(屏幕系:x 右+,z 前+;模长 ≤1;无触控恒 0)。 */
  touchVec = { x: 0, z: 0 };
  chatFocused = false;
  uiOpen = false;

  reset(selfId: number, spawn: [number, number, number, number]): void {
    this.selfId = selfId;
    this.players.clear();
    this.ball.active = false;
    const l = this.local;
    [l.x, l.y, l.z, l.ry] = spawn;
    l.vy = 0; l.grounded = true; l.anim = 0; l.seatId = null;
    l.emoteUntil = 0;
    l.grabbedBy = null; l.grabbing = null; l.grabPointLocal = null;
    this.selfSnap = null;
    this.camera.yaw = spawn[3] + Math.PI; // behind the player
  }

  upsertPlayer(profile: PublicProfile): RemoteEntity {
    let e = this.players.get(profile.id);
    if (!e) {
      e = {
        id: profile.id, profile, buf: [], x: 0, y: 0, z: 0, ry: 0, st: 0,
        emoteAnim: 0, emoteUntil: 0, voiceLevel: 0, grabbedBy: null, grabPointLocal: null,
      };
      this.players.set(profile.id, e);
    } else {
      e.profile = profile;
    }
    return e;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
  }

  applySnapshot(t: number, snaps: EntitySnap[], objs?: [string, number, number, number][]): void {
    for (const [id, x, y, z, ry, st] of snaps) {
      if (id === this.selfId) {
        // 本地玩家通常走客户端预测,跳过;但记录最新条目 —— 被抓时
        // (local.grabbedBy != null)LocalPlayer 每帧向这里吸附(升降跟随服务器)。
        this.selfSnap = { t, x, y, z, ry, st };
        continue;
      }
      const e = this.players.get(id);
      if (!e) continue; // profile not yet known (join msg races snapshot)
      e.buf.push({ t, x, y, z, ry, st });
      if (e.buf.length > 30) e.buf.splice(0, e.buf.length - 30);
    }
    if (objs) {
      for (const [oid, x, y, z] of objs) {
        if (oid === 'ball') {
          const prevX = this.ball.x, prevZ = this.ball.z;
          this.ball.active = true;
          if (this.ball.x !== 0 || this.ball.z !== 0) {
            this.ball.rx += (x - prevX) * 2.6;
            this.ball.rz += (z - prevZ) * 2.6;
          }
          this.ball.x = x; this.ball.y = y; this.ball.z = z;
        }
      }
    }
  }

  /** Advance every remote entity to the interpolated render position. */
  interpolate(now: number): void {
    const renderT = now + this.serverTimeOffset - INTERP_DELAY_MS;
    for (const e of this.players.values()) {
      const buf = e.buf;
      while (buf.length > 2 && buf[1].t <= renderT) buf.shift();
      if (buf.length === 0) continue;
      if (buf.length === 1 || buf[0].t >= renderT) {
        const p = buf[0];
        e.x = p.x; e.y = p.y; e.z = p.z; e.ry = p.ry; e.st = p.st;
        continue;
      }
      const a = buf[0], b = buf[1];
      const span = Math.max(1, b.t - a.t);
      const f = Math.min(1.5, Math.max(0, (renderT - a.t) / span));
      e.x = a.x + (b.x - a.x) * f;
      e.y = a.y + (b.y - a.y) * f;
      e.z = a.z + (b.z - a.z) * f;
      e.ry = angleLerp(a.ry, b.ry, Math.min(1, f));
      e.st = f < 0.5 ? a.st : b.st;
    }
  }

  /** grab_state 分发:维护本地/远端双向抓取字段;released/broken 清理。 */
  applyGrabState(g: { grabberId: number; targetId: number; pointLocal: [number, number, number]; phase: 'held' | 'released' | 'broken' }): void {
    const held = g.phase === 'held';
    if (g.grabberId === this.selfId) {
      this.local.grabbing = held ? g.targetId : null;
    }
    if (g.targetId === this.selfId) {
      this.local.grabbedBy = held ? g.grabberId : null;
      this.local.grabPointLocal = held ? g.pointLocal : null;
    }
    const te = this.players.get(g.targetId);
    if (te) {
      te.grabbedBy = held ? g.grabberId : null;
      te.grabPointLocal = held ? g.pointLocal : null;
    }
  }

  playEmote(id: number, anim: number): void {
    if (id === this.selfId) return;
    const e = this.players.get(id);
    if (!e) return;
    e.emoteAnim = anim;
    e.emoteUntil = performance.now() + 3200;
  }

  /** Effective anim for a remote entity (emote override wins while fresh). */
  remoteAnim(e: RemoteEntity): { anim: Anim; speaking: boolean; held: number } {
    const base = unpackState(e.st);
    if (e.emoteUntil > performance.now() && base.anim !== Anim.Walk && base.anim !== Anim.Run && base.anim !== Anim.Jump) {
      return { ...base, anim: e.emoteAnim as Anim };
    }
    return base;
  }
}

export const hot = new HotState();
