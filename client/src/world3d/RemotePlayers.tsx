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
