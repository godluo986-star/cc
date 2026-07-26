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
}

export interface CameraRig {
  yaw: number; pitch: number; dist: number;
  shake: number;
}

export interface BallState { x: number; y: number; z: number; active: boolean; rx: number; rz: number; }

class HotState {
  selfId = 0;
  local: LocalState = {
    x: 0, y: 0, z: 0, ry: 0, vy: 0, grounded: true, anim: 0,
    held: 0, heldUntil: 0, emoteAnim: 0, emoteUntil: 0, seatId: null, seatRy: 0,
    speaking: false, stepPhase: 0,
  };
  camera: CameraRig = { yaw: Math.PI, pitch: 0.32, dist: 5.2, shake: 0 };
  players = new Map<number, RemoteEntity>();
  ball: BallState = { x: 0, y: 0, z: 0, active: false, rx: 0, rz: 0 };
  /** Server time offset estimate (serverNow ≈ Date.now() + offset). */
  serverTimeOffset = 0;
  keys = new Set<string>();
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
    this.camera.yaw = spawn[3] + Math.PI; // behind the player
  }

  upsertPlayer(profile: PublicProfile): RemoteEntity {
    let e = this.players.get(profile.id);
    if (!e) {
      e = {
        id: profile.id, profile, buf: [], x: 0, y: 0, z: 0, ry: 0, st: 0,
        emoteAnim: 0, emoteUntil: 0, voiceLevel: 0,
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
      if (id === this.selfId) continue; // local player is client-predicted
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
