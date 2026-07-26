/**
 * Local player: input → physics (shared collision code) → camera rig →
 * network input → interaction scanning. The avatar mesh is client-predicted;
 * the server validates and corrects.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  WALK_SPEED, RUN_SPEED, JUMP_VELOCITY, GRAVITY, PLAYER_RADIUS,
  resolveCollisions, clampToBounds, floorHeightAt, LAYOUTS, isRoomSpace,
  ROOM_BOUNDS, Anim, EMOTES, INTERACT_RANGE, dist2d,
} from '@nexuspark/shared';
import { hot } from '../state/hot';
import { useWorld, useUI, useSession, useVoice } from '../state/stores';
import { connection } from '../net/connection';
import { Avatar, type AvatarHandle } from './Avatar';
import ScreenBillboard from './ScreenBillboard';
import { buildTargets, buildColliders, performAction, labelFor, type Target } from './interact';
import { audio } from '../audio/engine';

/** Interior ceiling heights for camera containment (rooms default to 3.0). */
const CEILINGS: Record<string, number> = { cafe: 3.4, cinema: 7.2, arcade: 3.6, shop: 3.4, lobby: 4.2 };

export default function LocalPlayer() {
  const avatarRef = useRef<AvatarHandle>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { gl, camera } = useThree();
  const spaceKey = useWorld((s) => s.spaceKey);
  const room = useWorld((s) => s.room);
  const self = useSession((s) => s.self);
  const screenOn = useVoice((s) => s.screenOn);
  const vel = useRef({ x: 0, z: 0 });
  const lastStep = useRef(0);
  const currentTarget = useRef<Target | null>(null);
  const seatTargets = useRef(new Map<string, Target>());

  const layout = useMemo(
    () => (isRoomSpace(spaceKey) ? null : LAYOUTS[spaceKey] ?? null),
    [spaceKey]
  );
  const bounds = layout?.bounds ?? ROOM_BOUNDS;
  const targets = useMemo(() => {
    const t = buildTargets(spaceKey, room);
    seatTargets.current = new Map(t.filter((x) => x.kind === 'seat').map((x) => [x.id, x]));
    return t;
  }, [spaceKey, room]);
  const colliders = useMemo(() => buildColliders(spaceKey, room), [spaceKey, room]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (hot.chatFocused) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      hot.keys.add(e.code);
      if (e.code === 'KeyE' && !hot.uiOpen) {
        if (currentTarget.current) performAction(currentTarget.current);
      }
      const emoteIdx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (emoteIdx >= 0 && !hot.uiOpen) triggerEmote(EMOTES[emoteIdx].anim);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => hot.keys.delete(e.code);
    const blur = () => hot.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ── Mouse orbit ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0, lastY = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      hot.camera.yaw -= dx * 0.0052;
      const invert = false;
      hot.camera.pitch = THREE.MathUtils.clamp(
        hot.camera.pitch + dy * 0.0045 * (invert ? -1 : 1), -0.5, 1.25
      );
    };
    const onUp = (e: PointerEvent) => { dragging = false; try { el.releasePointerCapture(e.pointerId); } catch { /* fine */ } };
    const onWheel = (e: WheelEvent) => {
      hot.camera.dist = THREE.MathUtils.clamp(hot.camera.dist + e.deltaY * 0.0035, 2.2, 10);
      e.preventDefault();
    };
    const onCtx = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onCtx);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onCtx);
    };
  }, [gl]);

  // ── Main loop ─────────────────────────────────────────────────────────────
  useFrame((state, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const l = hot.local;
    const now = performance.now();
    const editMode = useUI.getState().editMode;

    const inputBlocked = hot.chatFocused || hot.uiOpen || editMode;
    const k = hot.keys;
    let ix = 0, iz = 0;
    if (!inputBlocked) {
      if (k.has('KeyW') || k.has('ArrowUp')) iz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) iz -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    }
    const moving = ix !== 0 || iz !== 0;
    const running = moving && (k.has('ShiftLeft') || k.has('ShiftRight'));

    if (l.seatId) {
      // Seated: locked to the seat; movement keys stand up
      const seat = seatTargets.current.get(l.seatId);
      if (seat) {
        l.x = seat.x; l.y = seat.y; l.z = seat.z; l.ry = seat.ry;
      }
      l.anim = Anim.Sit;
      if (moving || (!inputBlocked && k.has('Space'))) {
        connection.send('stand', {});
        l.seatId = null;
      }
    } else {
      // Horizontal velocity, camera-relative
      const yaw = hot.camera.yaw;
      const targetSpeed = moving ? (running ? RUN_SPEED : WALK_SPEED) : 0;
      // 前向 = 相机指向角色的方向 (-sin,-cos);屏幕右 = 前向×上 = (cos,-sin)
      const dirX = -(Math.sin(yaw) * iz) + Math.cos(yaw) * ix;
      const dirZ = -(Math.cos(yaw) * iz) - Math.sin(yaw) * ix;
      const dl = Math.hypot(dirX, dirZ) || 1;
      const accel = l.grounded ? 26 : 9;
      vel.current.x += ((dirX / dl) * targetSpeed - vel.current.x) * Math.min(1, accel * dt);
      vel.current.z += ((dirZ / dl) * targetSpeed - vel.current.z) * Math.min(1, accel * dt);

      let nx = l.x + vel.current.x * dt;
      let nz = l.z + vel.current.z * dt;
      [nx, nz] = clampToBounds(nx, nz, bounds);
      [nx, nz] = resolveCollisions(nx, nz, PLAYER_RADIUS, colliders);

      // Vertical
      const floor = floorHeightAt(layout, nx, nz);
      if (!inputBlocked && k.has('Space') && l.grounded) {
        l.vy = JUMP_VELOCITY;
        l.grounded = false;
        audio.jump();
      }
      l.vy -= GRAVITY * dt;
      let ny = l.y + l.vy * dt;
      if (ny <= floor) { ny = floor; l.vy = 0; l.grounded = true; }
      else if (ny > floor + 0.02) l.grounded = false;

      l.x = nx; l.y = ny; l.z = nz;

      // Facing follows movement
      const hspeed = Math.hypot(vel.current.x, vel.current.z);
      if (hspeed > 0.35) {
        const targetRy = Math.atan2(vel.current.x, vel.current.z);
        let d = targetRy - l.ry;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        l.ry += d * Math.min(1, dt * 12);
      }

      // Anim selection (+ transient emote override)
      if (!l.grounded) l.anim = Anim.Jump;
      else if (hspeed > 4.3) l.anim = Anim.Run;
      else if (hspeed > 0.3) l.anim = Anim.Walk;
      else if (l.emoteUntil > now) l.anim = l.emoteAnim;
      else l.anim = Anim.Idle;
      if (moving) l.emoteUntil = 0;

      // Hop "boing" sounds — one per bounce of the walk cycle
      if (l.grounded && hspeed > 0.5) {
        const stride = l.anim === Anim.Run ? 0.72 : 0.98;
        l.stepPhase += hspeed * dt;
        if (l.stepPhase - lastStep.current > stride) {
          lastStep.current = l.stepPhase;
          audio.footstep(l.anim === Anim.Run);
        }
      }
    }

    if (l.heldUntil > 0 && now > l.heldUntil) { l.held = 0; l.heldUntil = 0; }

    // ── Camera rig ──
    const cam = hot.camera;
    const headY = l.y + 0.8; // 团子矮墩墩,取景点跟着放低
    let cx = l.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    let cz = l.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    let cy = headY + Math.sin(cam.pitch) * cam.dist;
    // keep the camera inside small interiors instead of behind their walls
    const ceiling = CEILINGS[spaceKey] ?? (isRoomSpace(spaceKey) ? 3.0 : 0);
    if (ceiling > 0) {
      cx = Math.min(Math.max(cx, bounds.minX + 0.35), bounds.maxX - 0.35);
      cz = Math.min(Math.max(cz, bounds.minZ + 0.35), bounds.maxZ - 0.35);
      cy = Math.min(cy, ceiling - 0.25);
    }
    const floorAtCam = floorHeightAt(layout, cx, cz);
    const clampedCy = Math.max(cy, floorAtCam + 0.35);
    const kPos = 1 - Math.exp(-dt * 14);
    camera.position.x += (cx - camera.position.x) * kPos;
    camera.position.y += (clampedCy - camera.position.y) * kPos;
    camera.position.z += (cz - camera.position.z) * kPos;
    camera.lookAt(l.x, headY - 0.22, l.z);

    // ── Avatar visuals ──
    if (groupRef.current) {
      groupRef.current.position.set(l.x, l.y, l.z);
      groupRef.current.rotation.y = l.ry;
      const camDist = camera.position.distanceTo(groupRef.current.position);
      groupRef.current.visible = camDist > 1.1;
    }
    avatarRef.current?.setPose(l.anim, Math.hypot(vel.current.x, vel.current.z), dt, state.clock.elapsedTime);
    avatarRef.current?.setHeld(l.held);
    avatarRef.current?.setSpeaking(l.speaking);

    // ── Network ──
    connection.sendInput();

    // ── Interaction scan ──
    scanInteractions(targets, l.x, l.z, l.ry);
  });

  // Rebuild scan targets when roster changes (NPC positions come from hot)
  const scanInteractions = (staticTargets: Target[], px: number, pz: number, _ry: number) => {
    const ui = useUI.getState();
    if (hot.uiOpen || useUI.getState().editMode) {
      if (currentTarget.current) { currentTarget.current = null; ui.setPrompt(null); }
      return;
    }
    let best: Target | null = null;
    let bestScore = Infinity;
    const camYaw = hot.camera.yaw;
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const consider = (t: Target) => {
      const dx = t.x - px, dz = t.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > INTERACT_RANGE) return;
      const facing = d > 0.001 ? (dx / d) * fx + (dz / d) * fz : 1;
      const score = d * (1.35 - Math.max(-0.2, facing));
      if (score < bestScore) { bestScore = score; best = t; }
    };
    for (const t of staticTargets) consider(t);
    // dynamic: NPCs
    for (const e of hot.players.values()) {
      if (e.profile.isNpc) {
        consider({
          id: `npc:${e.id}`, kind: 'npc', x: e.x, y: 0.5, z: e.z, ry: 0,
          label: `和 ${e.profile.username} 聊聊`, data: { npcId: e.id },
        });
      }
    }
    // dynamic: beach ball
    if (hot.ball.active && dist2d(px, pz, hot.ball.x, hot.ball.z) < 2.1) {
      consider({ id: 'ball', kind: 'ball', x: hot.ball.x, y: 0.3, z: hot.ball.z, ry: 0, label: '踢一脚沙滩球' });
    }
    currentTarget.current = best;
    ui.setPrompt(best ? { label: labelFor(best), key: 'E' } : null);
  };

  if (!self) return null;
  return (
    <group ref={groupRef}>
      <Avatar ref={avatarRef} config={self.avatar} name={self.username} />
      {screenOn && <ScreenBillboard sessionId={hot.selfId} isLocal />}
    </group>
  );
}

export function triggerEmote(anim: Anim): void {
  const l = hot.local;
  l.emoteAnim = anim;
  l.emoteUntil = performance.now() + 3200;
  l.anim = anim;
  connection.send('emote', { anim });
  connection.sendInput(true);
}
