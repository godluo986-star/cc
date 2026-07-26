import { describe, it, expect } from 'vitest';
import { testRig, lastOf } from './helpers';
import type { FakeWs } from './helpers';
import { handlers } from '../src/game/handlers';
import { SPACE, LIFT_MAX, BREAK_DIST, ESCAPE_BREAK, HOLD_MAX } from '@nexuspark/shared';
import type { World } from '../src/game/world';
import type { Session } from '../src/game/session';

/** 双人就位:a、b 同在广场出生点附近(相距 1.2m,处于 GRAB_RANGE 内)。 */
function pairInPlaza() {
  const rig = testRig();
  const a = rig.mkSession('alice');
  const b = rig.mkSession('bob');
  rig.world.join(a.session, SPACE.PLAZA);
  rig.world.join(b.session, SPACE.PLAZA);
  b.session.x = a.session.x + 1.2;
  b.session.y = a.session.y;
  b.session.z = a.session.z;
  return { ...rig, a, b };
}

function startGrab(world: World, grabber: Session, target: Session) {
  handlers.grab(world, grabber, { op: 'start', targetId: target.id, point: [0, 0.4, 0] });
}

function tickN(world: World, spaceKey: string, steps: number, dt: number) {
  const sp = world.spaces.get(spaceKey)!;
  for (let i = 0; i < steps; i++) world.tickGrabs(sp, dt);
}

function grabStates(ws: FakeWs): Array<{ grabberId: number; targetId: number; phase: string }> {
  return ws.sent.filter((m) => m.t === 'grab_state').map((m) => m.d as any);
}

describe('grab: start validation', () => {
  it('rejects when target is out of GRAB_RANGE', () => {
    const { world, a, b } = pairInPlaza();
    b.session.x = a.session.x + 5; // 5m away > 2.2
    startGrab(world, a.session, b.session);
    expect(a.session.grabbing).toBe(null);
    expect(b.session.grabbedBy).toBe(null);
    expect(lastOf(a.ws, 'toast')?.d.level).toBe('warn');
    expect(grabStates(b.ws).length).toBe(0);
  });

  it('rejects grabbing across spaces (no 隔墙抓/跨空间吸人)', () => {
    const rig = testRig();
    const a = rig.mkSession('alice');
    const b = rig.mkSession('bob');
    rig.world.join(a.session, SPACE.PLAZA);
    rig.world.join(b.session, SPACE.CAFE);
    // 即使坐标凑巧接近也不行:不同空间直接拒绝
    b.session.x = a.session.x; b.session.z = a.session.z;
    startGrab(rig.world, a.session, b.session);
    expect(a.session.grabbing).toBe(null);
    expect(b.session.grabbedBy).toBe(null);
  });

  it('rejects a target that is already grabbed by someone else', () => {
    const { world, a, b, mkSession } = pairInPlaza();
    const c = mkSession('carol');
    world.join(c.session, SPACE.PLAZA);
    c.session.x = b.session.x + 0.8; c.session.z = b.session.z;
    startGrab(world, a.session, b.session);
    expect(b.session.grabbedBy).toBe(a.session.id);
    startGrab(world, c.session, b.session);
    expect(c.session.grabbing).toBe(null);
    expect(b.session.grabbedBy).toBe(a.session.id); // 归属不变
    expect(lastOf(c.ws, 'toast')?.d.level).toBe('warn');
  });
});

describe('grab: server-authoritative simulation', () => {
  it('converges the target toward grabTargetWorld over ticks', () => {
    const { world, a, b } = pairInPlaza();
    startGrab(world, a.session, b.session);
    expect(lastOf(b.ws, 'grab_state')?.d.phase).toBe('held');
    const gx = a.session.x + 1.5, gz = a.session.z;
    handlers.grab(world, a.session, { op: 'move', target: [gx, 0.5, gz] });
    tickN(world, 'plaza', 180, 1 / 60); // 3s
    expect(Math.abs(b.session.x - gx)).toBeLessThan(0.15);
    expect(Math.abs(b.session.z - gz)).toBeLessThan(0.15);
    expect(b.session.grabbedBy).toBe(a.session.id); // 依然被抓着
  });

  it('lifts monotonically and never exceeds grabber.y + LIFT_MAX', () => {
    const { world, a, b } = pairInPlaza();
    startGrab(world, a.session, b.session);
    // 请求举到 y=10:handler 需把 y 硬夹到 抓取者y+LIFT_MAX
    handlers.grab(world, a.session, { op: 'move', target: [a.session.x + 1.0, 10, a.session.z] });
    expect(a.session.grabTargetWorld![1]).toBeLessThanOrEqual(a.session.y + LIFT_MAX + 1e-9);
    const cap = a.session.y + LIFT_MAX + 0.05;
    const ys: number[] = [];
    let maxY = -Infinity;
    for (let i = 0; i < 180; i++) {
      world.tickGrabs(world.spaces.get('plaza')!, 1 / 60);
      if (i < 36) ys.push(b.session.y); // 上升段(首个峰值前)采样
      maxY = Math.max(maxY, b.session.y);
    }
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9); // y 单调升
    expect(maxY).toBeLessThanOrEqual(cap);
    expect(b.session.y).toBeGreaterThan(1.0); // 确实被举起来了
  });

  it('clamps the simulated target inside space bounds', () => {
    const rig = testRig();
    const a = rig.mkSession('alice');
    const b = rig.mkSession('bob');
    rig.world.join(a.session, SPACE.CAFE); // cafe bounds: z ∈ [-6, 6]
    rig.world.join(b.session, SPACE.CAFE);
    b.session.x = a.session.x + 1.2; b.session.z = a.session.z;
    startGrab(rig.world, a.session, b.session);
    // 直接把弹簧目标塞到界外(绕过 move 的 HOLD_MAX 夹取,单测 tick 层防线)
    a.session.grabTargetWorld = [a.session.x + 1.2, 0.5, 20];
    tickN(rig.world, SPACE.CAFE, 120, 1 / 60);
    const bounds = rig.world.spaces.get(SPACE.CAFE)!.layout.bounds;
    expect(b.session.z).toBeLessThanOrEqual(bounds.maxZ - 0.29); // clampToBounds pad 0.3
    expect(b.session.grabbedBy).toBe(a.session.id); // 没有因出界拉断(被 clamp 住)
  });

  it('breaks the grab when the pair is pulled beyond BREAK_DIST', () => {
    const { world, a, b } = pairInPlaza();
    startGrab(world, a.session, b.session);
    a.session.x += BREAK_DIST + 6; // 抓取者被瞬移拉远(测试直接改坐标)
    tickN(world, 'plaza', 1, 1 / 60);
    expect(a.session.grabbing).toBe(null);
    expect(b.session.grabbedBy).toBe(null);
    const st = grabStates(b.ws);
    expect(st[st.length - 1].phase).toBe('broken');
    expect(lastOf(a.ws, 'toast')?.d.text).toContain('溜了');
    expect(lastOf(b.ws, 'toast')?.d.text).toContain('挣脱');
  });

  it('escape struggle: input no longer moves the body, and ESCAPE_BREAK seconds of struggling breaks free', () => {
    const { world, a, b } = pairInPlaza();
    startGrab(world, a.session, b.session);
    const [bx, bz] = [b.session.x, b.session.z];
    b.session.lastInputAt = Date.now() - 100;
    handlers.input(world, b.session, { p: [bx + 3, 0, bz], ry: 0, st: 0, seq: 1 });
    expect(b.session.x).toBe(bx); // 被抓中输入不驱动位移
    expect(b.session.z).toBe(bz);
    expect(b.session.escapeDir[0]).toBeCloseTo(1, 5); // 只留下挣扎方向
    // 挣扎不足 ESCAPE_BREAK 秒:仍被抓着
    tickN(world, 'plaza', 40, 0.05); // 2.0s < 2.2s
    expect(b.session.grabbedBy).toBe(a.session.id);
    // 继续挣扎越过阈值:挣脱
    tickN(world, 'plaza', 10, 0.05); // 累计 2.5s ≥ ESCAPE_BREAK(2.2)
    expect(b.session.grabbedBy).toBe(null);
    expect(a.session.grabbing).toBe(null);
    const st = grabStates(a.ws);
    expect(st[st.length - 1].phase).toBe('broken');
    expect(ESCAPE_BREAK).toBe(2.2);
  });

  it('after end, the target free-falls under gravity back to the floor', () => {
    const { world, a, b } = pairInPlaza();
    startGrab(world, a.session, b.session);
    handlers.grab(world, a.session, { op: 'move', target: [a.session.x + 1.0, 1.8, a.session.z] });
    tickN(world, 'plaza', 120, 1 / 60); // 悬空稳定
    expect(b.session.y).toBeGreaterThan(1.0);
    handlers.grab(world, a.session, { op: 'end' });
    expect(a.session.grabbing).toBe(null);
    expect(lastOf(b.ws, 'grab_state')?.d.phase).toBe('released');
    expect(b.session.grabAirborne).toBe(true); // 保留速度/高度,自然抛落
    tickN(world, 'plaza', 120, 1 / 60); // 2s 自由落体
    expect(b.session.y).toBeCloseTo(0, 3); // 落回地面,不穿地
    expect(b.session.grabAirborne).toBe(false);
  });

  it('move clamps the hold point within HOLD_MAX of the grabber', () => {
    const { world, a, b } = pairInPlaza();
    startGrab(world, a.session, b.session);
    handlers.grab(world, a.session, { op: 'move', target: [a.session.x + 50, 0.5, a.session.z] });
    const t = a.session.grabTargetWorld!;
    // 距离先夹到 [HOLD_MIN,HOLD_MAX],y 随后再夹到 [地面+0.2, 抓取者y+LIFT_MAX](契约顺序)
    const dh = Math.hypot(t[0] - a.session.x, t[2] - a.session.z);
    expect(dh).toBeLessThanOrEqual(HOLD_MAX + 1e-9);
    expect(t[1]).toBeGreaterThanOrEqual(0.2 - 1e-9); // 地面为 0
    expect(t[1]).toBeLessThanOrEqual(a.session.y + LIFT_MAX + 1e-9);
  });
});

describe('grab: lifecycle teardown', () => {
  it('leaveCurrent releases an active grab and broadcasts released', () => {
    const { world, a, b } = pairInPlaza();
    startGrab(world, a.session, b.session);
    world.leaveCurrent(a.session); // 抓取者离开空间
    expect(a.session.grabbing).toBe(null);
    expect(b.session.grabbedBy).toBe(null);
    const st = grabStates(b.ws);
    expect(st[st.length - 1].phase).toBe('released');
  });

  it('leaveCurrent of the grabbed target also releases', () => {
    const { world, a, b } = pairInPlaza();
    startGrab(world, a.session, b.session);
    world.leaveCurrent(b.session); // 被抓者离开
    expect(a.session.grabbing).toBe(null);
    expect(b.session.grabbedBy).toBe(null);
    const st = grabStates(a.ws);
    expect(st[st.length - 1].phase).toBe('released');
  });
});

describe('personal boundaries (prefs)', () => {
  it('noGrab pref rejects grab attempts', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    world.join(a.session, SPACE.PLAZA);
    world.join(b.session, SPACE.PLAZA);
    b.session.x = a.session.x + 1; b.session.z = a.session.z;
    handlers.prefs(world, b.session, { noGrab: true });
    handlers.grab(world, a.session, { op: 'start', targetId: b.session.id, point: [0.4, 0, 0] });
    expect(a.session.grabbing).toBe(null);
    expect(b.session.grabbedBy).toBe(null);
    // 关掉后可以抓
    handlers.prefs(world, b.session, { noGrab: false });
    handlers.grab(world, a.session, { op: 'start', targetId: b.session.id, point: [0.4, 0, 0] });
    expect(a.session.grabbing).toBe(b.session.id);
  });

  it('blocked users cannot grab you and rtc relay is dropped both ways', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice');
    const b = mkSession('bob');
    world.join(a.session, SPACE.PLAZA);
    world.join(b.session, SPACE.PLAZA);
    b.session.x = a.session.x + 1; b.session.z = a.session.z;
    // b 屏蔽 a
    handlers.prefs(world, b.session, { blocked: [a.session.user.id] });
    handlers.grab(world, a.session, { op: 'start', targetId: b.session.id, point: [0.4, 0, 0] });
    expect(a.session.grabbing).toBe(null);
    // 语音信令双向都不中继
    handlers.voice_state(world, a.session, { on: true });
    handlers.voice_state(world, b.session, { on: true });
    const bBefore = b.ws.sent.filter((m) => m.t === 'rtc').length;
    handlers.rtc(world, a.session, { to: b.session.id, kind: 'offer', payload: '{}' });
    expect(b.ws.sent.filter((m) => m.t === 'rtc').length).toBe(bBefore);
    const aBefore = a.ws.sent.filter((m) => m.t === 'rtc').length;
    handlers.rtc(world, b.session, { to: a.session.id, kind: 'offer', payload: '{}' });
    expect(a.ws.sent.filter((m) => m.t === 'rtc').length).toBe(aBefore);
    // 解除屏蔽后恢复
    handlers.prefs(world, b.session, { blocked: [] });
    handlers.rtc(world, a.session, { to: b.session.id, kind: 'offer', payload: '{}' });
    expect(b.ws.sent.filter((m) => m.t === 'rtc').length).toBe(bBefore + 1);
  });
});
