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
  GRAB_RANGE, HOLD_MIN, HOLD_MAX, LIFT_MAX, GRABBER_SLOW, INPUT_RATE,
} from '@nexuspark/shared';
import { hot } from '../state/hot';
import { useWorld, useUI, useSession, useVoice, useSettings, useSocial } from '../state/stores';
import { connection } from '../net/connection';
import { Avatar, type AvatarHandle } from './Avatar';
import ScreenBillboard from './ScreenBillboard';
import { buildTargets, buildColliders, performAction, labelFor, type Target } from './interact';
import { audio } from '../audio/engine';

/** Interior ceiling heights for camera containment (rooms default to 3.0). */
const CEILINGS: Record<string, number> = { cafe: 3.4, cinema: 7.2, arcade: 3.6, shop: 3.4, lobby: 4.2 };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

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
  // ── 抓取 / 第一人称状态 ──
  const grabCandidate = useRef<number | null>(null);
  const grabHeld = useRef<false | 'key' | 'mouse'>(false);
  const lastGrabMove = useRef(0);
  const wasGrabbedBy = useRef<number | null>(null);
  /** 第三↔第一人称过渡进度(0=third, 1=first;0.25s 线性)。 */
  const fpBlend = useRef(0);
  /** 平滑后的第一人称眼位高度(reduceMotion 被抓时降速)。 */
  const eyeY = useRef(0);
  const ringRef = useRef<THREE.Group>(null);

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

  // ── 抓取输入:按住即抓、松手即放(长按 G,或鼠标左键按住准星内目标)────
  const startGrab = (src: 'key' | 'mouse') => {
    const l = hot.local;
    if (hot.uiOpen || hot.chatFocused || useUI.getState().editMode) return;
    if (grabHeld.current || l.grabbing != null || l.grabbedBy != null || l.seatId) return;
    const id = grabCandidate.current;
    if (id == null) return;
    const e = hot.players.get(id);
    if (!e) return;
    // 抓取点近似:从相机到目标身体中心的连线,与半径 0.44 球面近侧交点,
    // 转为身体局部偏移(|p|=0.44 ≤ 0.6,满足协议约束)
    let dx = e.x - camera.position.x;
    let dy = e.y + 0.31 - camera.position.y; // 0.31 ≈ 团子身体中心高
    let dz = e.z - camera.position.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    grabHeld.current = src;
    connection.send('grab', {
      op: 'start', targetId: id,
      point: [r3(-dx * 0.44), r3(-dy * 0.44), r3(-dz * 0.44)],
    });
  };
  const endGrab = (src?: 'key' | 'mouse') => {
    if (!grabHeld.current) return;
    if (src && grabHeld.current !== src) return;
    grabHeld.current = false;
    connection.send('grab', { op: 'end' });
  };

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
      // 长按 G 抓住附近团子(keydown 抓、keyup 放 = 按住即抓)
      if (e.code === 'KeyG' && !e.repeat && !hot.uiOpen) startGrab('key');
      // V 切换第一/第三人称
      if (e.code === 'KeyV' && !e.repeat && !hot.uiOpen) {
        hot.camera.mode = hot.camera.mode === 'first' ? 'third' : 'first';
      }
      const emoteIdx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (emoteIdx >= 0 && !hot.uiOpen) triggerEmote(EMOTES[emoteIdx].anim);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      hot.keys.delete(e.code);
      if (e.code === 'KeyG') endGrab('key');
    };
    const blur = () => { hot.keys.clear(); endGrab(); };
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
      // 左键按住:准星/屏心 GRAB_RANGE 内有可抓团子且未开面板 → 按住即抓
      // (拖动旋转视角与把持并存:按住期间拖动可调整把持方向/高度)
      if (e.button === 0 && !hot.uiOpen && grabCandidate.current != null) startGrab('mouse');
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
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (e.button === 0) endGrab('mouse'); // 松手即放
      try { el.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    };
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
      // 手机虚拟摇杆(与按键叠加后钳到单位圆;推满自动跑)
      ix += hot.touchVec.x;
      iz += hot.touchVec.z;
      const il = Math.hypot(ix, iz);
      if (il > 1) { ix /= il; iz /= il; }
    }
    const moving = Math.hypot(ix, iz) > 0.12;
    const running = moving && (k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(hot.touchVec.x, hot.touchVec.z) > 0.92);

    // 相机系移动方向(被抓时同样用它编码挣扎意图)
    // 前向 = 相机指向角色的方向 (-sin,-cos);屏幕右 = 前向×上 = (cos,-sin)
    const camYawNow = hot.camera.yaw;
    const dirX = -(Math.sin(camYawNow) * iz) + Math.cos(camYawNow) * ix;
    const dirZ = -(Math.cos(camYawNow) * iz) - Math.sin(camYawNow) * ix;
    const dirLen = Math.hypot(dirX, dirZ) || 1;

    // 挣脱/释放:以服务器位置为新起点恢复本地预测,防跳变
    if (wasGrabbedBy.current != null && l.grabbedBy == null) {
      const snap = hot.selfSnap;
      if (snap) { l.x = snap.x; l.y = snap.y; l.z = snap.z; }
      vel.current.x = 0; vel.current.z = 0; l.vy = 0;
    }
    wasGrabbedBy.current = l.grabbedBy;

    if (l.grabbedBy != null) {
      // 被抓:本地位移预测停用,每帧向服务器 10Hz snap 里自己的条目吸附
      // (k=dt*12)。方向键不再驱动位移,但作为挣扎意图叠加一个小偏移进
      // l.x/z —— sendInput 照发,服务器把 (p - 实际位置) 当挣扎力方向。
      const snap = hot.selfSnap;
      const kAttach = Math.min(1, dt * 12);
      const ox = moving ? (dirX / dirLen) * 0.3 : 0;
      const oz = moving ? (dirZ / dirLen) * 0.3 : 0;
      if (snap) {
        l.x += (snap.x + ox - l.x) * kAttach;
        l.y += (snap.y - l.y) * kAttach;
        l.z += (snap.z + oz - l.z) * kAttach;
      }
      vel.current.x = 0; vel.current.z = 0; l.vy = 0;
      const floor = floorHeightAt(layout, l.x, l.z);
      l.grounded = l.y <= floor + 0.05;
      l.anim = l.grounded ? Anim.Idle : Anim.Jump;
    } else if (l.seatId) {
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
      // 拖着人时服务器按 GRABBER_SLOW 减速,客户端把期望速度同步打折,
      // 以免持续被 correction 拉扯(对跑/走统一生效)
      const speedMul = l.grabbing != null ? GRABBER_SLOW : 1;
      const targetSpeed = moving ? (running ? RUN_SPEED : WALK_SPEED) * speedMul : 0;
      const accel = l.grounded ? 26 : 9;
      vel.current.x += ((dirX / dirLen) * targetSpeed - vel.current.x) * Math.min(1, accel * dt);
      vel.current.z += ((dirZ / dirLen) * targetSpeed - vel.current.z) * Math.min(1, accel * dt);

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

    // ── 抓取候选扫描:准星/屏心方向 GRAB_RANGE 内最近的其他玩家团子 ──
    let candId: number | null = null;
    if (!inputBlocked && l.grabbing == null && l.grabbedBy == null && !l.seatId) {
      const ffx = -Math.sin(hot.camera.yaw), ffz = -Math.cos(hot.camera.yaw);
      let candScore = Infinity;
      const blocked = useSocial.getState().blocked;
      for (const e of hot.players.values()) {
        if (e.profile.isNpc) continue; // 第一阶段:只抓玩家团子
        if (blocked.includes(e.profile.userId)) continue; // 屏蔽对象不作为抓取候选
        const dx = e.x - l.x, dz = e.z - l.z;
        const d = Math.hypot(dx, dz, e.y - l.y);
        if (d > GRAB_RANGE || d < 0.05) continue;
        const hl = Math.hypot(dx, dz) || 1;
        const facing = (dx / hl) * ffx + (dz / hl) * ffz;
        if (facing < 0.35) continue; // 需大致在准星/屏心方向
        const score = d * (1.35 - facing);
        if (score < candScore) { candScore = score; candId = e.id; }
      }
    }
    grabCandidate.current = candId;
    // 目标高亮:候选(或抓取中的目标)脚下画一个小圈
    if (ringRef.current) {
      const hlId = l.grabbing ?? candId;
      const tgt = hlId != null ? hot.players.get(hlId) : undefined;
      ringRef.current.visible = !!tgt;
      if (tgt) ringRef.current.position.set(tgt.x, tgt.y + 0.03, tgt.z);
    }

    // ── Camera rig(third/first 双模式,0.25s 平滑过渡)──
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
    // 第一人称眼位:团子眼位 l.y+0.36,随被抓/跳跃自然升降;
    // 「减少镜头运动」开着且被抓时,高度 lerp k 减半,进一步钳制升降速率
    const reduceMotion = useSettings.getState().reduceMotion;
    const eyeK = Math.min(1, dt * (reduceMotion && l.grabbedBy != null ? 6 : 12));
    eyeY.current += (l.y + 0.36 - eyeY.current) * eyeK;
    // V 切换的 0.25s 平滑过渡:线性推进 blend,位置/注视点线性混合
    const bTgt = cam.mode === 'first' ? 1 : 0;
    const db = bTgt - fpBlend.current;
    if (db !== 0) fpBlend.current += Math.sign(db) * Math.min(Math.abs(db), dt / 0.25);
    const fb = fpBlend.current;
    // 第一人称朝向:yaw/pitch 仍由现有「按住拖动」的鼠标控制(契约允许保持
    // 拖动;指针直控需 pointer lock,本轮不改交互方式,注释说明)。
    // roll 恒 0:lookAt 使用默认 up=+Y。
    const lfx = -Math.sin(cam.yaw) * Math.cos(cam.pitch);
    const lfy = -Math.sin(cam.pitch);
    const lfz = -Math.cos(cam.yaw) * Math.cos(cam.pitch);
    const px = cx * (1 - fb) + l.x * fb;
    const py = clampedCy * (1 - fb) + eyeY.current * fb;
    const pz = cz * (1 - fb) + l.z * fb;
    const kPos = 1 - Math.exp(-dt * 14);
    camera.position.x += (px - camera.position.x) * kPos;
    camera.position.y += (py - camera.position.y) * kPos;
    camera.position.z += (pz - camera.position.z) * kPos;
    camera.lookAt(
      l.x * (1 - fb) + (l.x + lfx) * fb,
      (headY - 0.22) * (1 - fb) + (eyeY.current + lfy) * fb,
      l.z * (1 - fb) + (l.z + lfz) * fb
    );

    // ── Avatar visuals ──
    if (groupRef.current) {
      const g = groupRef.current;
      g.position.set(l.x, l.y, l.z);
      g.rotation.y = l.ry;
      // 被抓表现:按抓取点侧倾(叠加在 animator 的 bodyRx/Rz 之上,走外层
      // group 通道互不干扰);悬空(高于地面 0.25)时轻微竖向拉伸 1.05
      let tRx = 0, tRz = 0, tSy = 1;
      if (l.grabbedBy != null && l.grabPointLocal) {
        tRz = THREE.MathUtils.clamp(l.grabPointLocal[0] * 1.15, -0.5, 0.5);
        tRx = THREE.MathUtils.clamp(-l.grabPointLocal[2] * 1.15, -0.5, 0.5);
        if (l.y > floorHeightAt(layout, l.x, l.z) + 0.25) tSy = 1.05;
      }
      const kt = Math.min(1, dt * 8);
      g.rotation.x += (tRx - g.rotation.x) * kt;
      g.rotation.z += (tRz - g.rotation.z) * kt;
      const sy = g.scale.y + (tSy - g.scale.y) * kt;
      g.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      const camDist = camera.position.distanceTo(g.position);
      // 第一人称隐藏自身模型(过渡近半即隐,避免穿模)
      g.visible = fb < 0.5 && camDist > 1.1;
    }
    avatarRef.current?.setPose(l.anim, Math.hypot(vel.current.x, vel.current.z), dt, state.clock.elapsedTime);
    avatarRef.current?.setHeld(l.held);
    avatarRef.current?.setSpeaking(l.speaking);

    // ── Network ──
    connection.sendInput();
    // 抓取中:随 input 同节流(15Hz)发 grab move,把持点由视角自然带出:
    // target = 自身位置 + 前向*1.6 + up*(pitch<0 ? -pitch*1.8 : -pitch*0.6),
    // 再夹水平距 [HOLD_MIN, HOLD_MAX]、高度 [0.2, y+LIFT_MAX]
    if (l.grabbing != null && connection.connected) {
      const nowMs = performance.now();
      if (nowMs - lastGrabMove.current >= 1000 / INPUT_RATE) {
        lastGrabMove.current = nowMs;
        const ffx = -Math.sin(cam.yaw), ffz = -Math.cos(cam.yaw);
        const hd = Math.min(HOLD_MAX, Math.max(HOLD_MIN, 1.6));
        const rawY = l.y + (cam.pitch < 0 ? -cam.pitch * 1.8 : -cam.pitch * 0.6);
        const ty = Math.min(l.y + LIFT_MAX, Math.max(0.2, rawY));
        connection.send('grab', {
          op: 'move',
          target: [r3(l.x + ffx * hd), r3(ty), r3(l.z + ffz * hd)],
        });
      }
    }

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
    if (best) {
      ui.setPrompt({ label: labelFor(best), key: 'E' });
    } else if (grabCandidate.current != null) {
      // 没有 E 互动目标时,提示行显示抓取候选(准星高亮的那只团子)
      const ge = hot.players.get(grabCandidate.current);
      ui.setPrompt(ge ? { label: `长按抓住 ${ge.profile.username}(松手即放)`, key: 'G' } : null);
    } else {
      ui.setPrompt(null);
    }
  };

  if (!self) return null;
  return (
    <>
      <group ref={groupRef}>
        <Avatar ref={avatarRef} config={self.avatar} name={self.username} />
        {screenOn && <ScreenBillboard sessionId={hot.selfId} isLocal />}
      </group>
      {/* 抓取目标准星高亮:候选/抓取中团子脚下的小圈 */}
      <group ref={ringRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.58, 32]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.8} depthWrite={false} />
        </mesh>
      </group>
    </>
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
