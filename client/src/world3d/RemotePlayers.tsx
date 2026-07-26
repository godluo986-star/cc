import { memo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useWorld } from '../state/stores';
import { hot } from '../state/hot';
import { Avatar, type AvatarHandle } from './Avatar';
import ScreenBillboard from './ScreenBillboard';
import type { PublicProfile } from '@nexuspark/shared';

const RemoteAvatar = memo(function RemoteAvatar({ profile, sharing }: { profile: PublicProfile; sharing: boolean }) {
  const group = useRef<THREE.Group>(null);
  const avatar = useRef<AvatarHandle>(null);

  useFrame((state, dt) => {
    const e = hot.players.get(profile.id);
    if (!e || !group.current) return;
    group.current.position.set(e.x, e.y, e.z);
    // shortest-path smooth of rendered yaw
    const cur = group.current.rotation.y;
    let d = e.ry - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    group.current.rotation.y = cur + d * Math.min(1, dt * 14);

    // 被抓表现:按 grabPointLocal 侧倾(叠加在 animator 姿态之上,走外层
    // group 通道);悬空时轻微竖向拉伸 1.05。地面高度无本地 layout 查询,
    // 用 y>0.25 近似(城区地面基本为 0,轻表现可接受)。
    let tRx = 0, tRz = 0, tSy = 1;
    if (e.grabbedBy != null && e.grabPointLocal) {
      tRz = THREE.MathUtils.clamp(e.grabPointLocal[0] * 1.15, -0.5, 0.5);
      tRx = THREE.MathUtils.clamp(-e.grabPointLocal[2] * 1.15, -0.5, 0.5);
      if (e.y > 0.25) tSy = 1.05;
    }
    const kt = Math.min(1, dt * 8);
    group.current.rotation.x += (tRx - group.current.rotation.x) * kt;
    group.current.rotation.z += (tRz - group.current.rotation.z) * kt;
    const sy = group.current.scale.y + (tSy - group.current.scale.y) * kt;
    group.current.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));

    const { anim, speaking, held } = hot.remoteAnim(e);
    // horizontal speed estimate from the interp buffer
    let speed = 0;
    const buf = e.buf;
    if (buf.length >= 2) {
      const a = buf[buf.length - 2], b = buf[buf.length - 1];
      const span = Math.max(0.05, (b.t - a.t) / 1000);
      speed = Math.hypot(b.x - a.x, b.z - a.z) / span;
    }
    avatar.current?.setPose(anim, speed, dt, state.clock.elapsedTime);
    avatar.current?.setHeld(held);
    avatar.current?.setSpeaking(speaking || e.voiceLevel > 0.12);
  });

  return (
    <group ref={group}>
      <Avatar ref={avatar} config={profile.avatar} name={profile.username} isNpc={profile.isNpc} />
      {sharing && <ScreenBillboard sessionId={profile.id} />}
    </group>
  );
});

export default function RemotePlayers() {
  const roster = useWorld((s) => s.roster);
  const screenRoster = useWorld((s) => s.screenRoster);
  const selfEntries = roster.filter((p) => p.id !== hot.selfId);
  return (
    <>
      {selfEntries.map((p) => (
        <RemoteAvatar key={p.id} profile={p} sharing={screenRoster.includes(p.id)} />
      ))}
    </>
  );
}
