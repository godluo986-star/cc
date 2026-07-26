/** Floating display above a dango that is sharing their screen. Y-axis
 *  billboard showing the live WebRTC video track as a real texture. */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { voice } from '../voice/voice';
import { useVoice } from '../state/stores';
import { hot } from '../state/hot';

const VIEW_RANGE = 24;

export default function ScreenBillboard({ sessionId, isLocal = false }: { sessionId: number; isLocal?: boolean }) {
  const screenVersion = useVoice((s) => s.screenVersion);
  const groupRef = useRef<THREE.Group>(null);
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stream = useMemo(
    () => (isLocal ? voice.localScreenStream : voice.screenStreams.get(sessionId) ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, isLocal, screenVersion]
  );

  useEffect(() => {
    if (!stream) {
      setTexture(null);
      return;
    }
    const el = document.createElement('video');
    el.srcObject = stream;
    el.muted = true;
    el.playsInline = true;
    void el.play().catch(() => undefined);
    videoRef.current = el;
    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    setTexture(tex);
    return () => {
      tex.dispose();
      el.srcObject = null;
      videoRef.current = null;
    };
  }, [stream]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    // Y-axis billboard toward the camera + distance culling
    const wp = new THREE.Vector3();
    g.getWorldPosition(wp);
    const d = Math.hypot(wp.x - hot.local.x, wp.z - hot.local.z);
    g.visible = !!texture && (isLocal || d < VIEW_RANGE);
    if (!g.visible) return;
    g.rotation.y = hot.camera.yaw - (g.parent?.rotation.y ?? 0);
  });

  if (!texture) return null;
  return (
    <group ref={groupRef} position={[0, 2.05, 0]}>
      {/* frame */}
      <mesh>
        <boxGeometry args={[1.38, 0.82, 0.035]} />
        <meshStandardMaterial color="#14171d" roughness={0.4} metalness={0.4} />
      </mesh>
      {/* live screen */}
      <mesh position={[0, 0, 0.022]}>
        <planeGeometry args={[1.3, 0.74]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {/* little stand tail down to the dango */}
      <mesh position={[0, -0.5, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.24, 6]} />
        <meshStandardMaterial color="#3a3f47" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.47, 0]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#38d9c3" emissive="#38d9c3" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}
