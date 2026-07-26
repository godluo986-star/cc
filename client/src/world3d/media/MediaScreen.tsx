/**
 * Synchronized media screen — website-embed approach. The screen surface is
 * a real DOM overlay positioned in 3D (CSS3D via drei <Html transform>):
 *  - 'site':    any website in a sandboxed iframe (shared URL for everyone;
 *               fully interactive — you can scroll/click it in-world)
 *  - 'youtube': official YouTube IFrame embed, playback position synced to
 *               the server clock (play/pause/seek/rate)
 *  - 'video':   direct video file in a <video> element, position synced
 *  - 'share':   a present player's WebRTC screen-share stream (投屏)
 * Player implementations live in ./players and are shared with the fullscreen
 * DOM overlay (FullscreenViewer), so drift correction is one code path.
 * Legal embedding only — sites that send X-Frame-Options/CSP deny simply
 * refuse to render and the panel explains that.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useWorld } from '../../state/stores';
import { mediaRuntime } from './runtime';
import { SiteFrame, SyncedVideo, YouTubeFrame, ShareFrame } from './players';
import { useFullscreenMedia } from './fullscreen';

export { mediaTargetPosition } from './players';

const PX = 720; // CSS pixel width of every screen overlay

function idleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 512, 288);
  grad.addColorStop(0, '#101828');
  grad.addColorStop(1, '#1a1030');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 288);
  ctx.fillStyle = '#5b8cff';
  ctx.font = '700 34px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('团子影像', 256, 130);
  ctx.fillStyle = '#9aa7bd';
  ctx.font = '18px "Segoe UI", sans-serif';
  ctx.fillText('走近按 E,把网页或视频放上屏幕', 256, 172);
  return new THREE.CanvasTexture(c);
}

/* ── The screen assembly ─────────────────────────────────────────────────── */
export default function MediaScreen({ position, rotation, width, height, frame = true }: {
  position: [number, number, number];
  rotation: number;
  width: number;
  height: number;
  frame?: boolean;
}) {
  const media = useWorld((s) => s.media);
  const fsOpen = useFullscreenMedia((s) => s.open);
  const active = !!media && (!!media.url || media.kind === 'share');
  const idle = useMemo(() => idleTexture(), []);
  const glowRef = useRef<THREE.PointLight>(null);
  const py = Math.round(PX * (height / width));
  useEffect(() => { if (!active) mediaRuntime.reset(); }, [active]);
  useFrame(({ clock }) => {
    if (glowRef.current) {
      glowRef.current.intensity = active ? 3.0 + Math.sin(clock.elapsedTime * 1.7) * 0.5 : 0.7;
    }
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {frame && (
        <mesh castShadow>
          <boxGeometry args={[width + 0.22, height + 0.22, 0.09]} />
          <meshStandardMaterial color="#14171d" roughness={0.4} metalness={0.4} />
        </mesh>
      )}
      {!active && (
        <mesh position={[0, 0, 0.012]}>
          <planeGeometry args={[width, height]} />
          <meshStandardMaterial map={idle} emissive="#ffffff" emissiveMap={idle} emissiveIntensity={0.5} roughness={0.4} />
        </mesh>
      )}
      {active && fsOpen && (
        /* 全屏观影时本机只保留 DOM 覆盖层这一个播放器,3D 屏幕熄成暗面
           (避免双播放器双音轨/双倍带宽) */
        <mesh position={[0, 0, 0.012]}>
          <planeGeometry args={[width, height]} />
          <meshStandardMaterial color="#05070c" roughness={0.6} />
        </mesh>
      )}
      {active && !fsOpen && (
        /* distanceFactor=400 抵消 drei transform 模式的 (df||10)/400 内置缩放,
           使 1 个 CSS 缩放单位 = 1 个世界单位:div 宽 PX px × scale = width 米 */
        <Html transform position={[0, 0, 0.03]} scale={width / PX} distanceFactor={400} zIndexRange={[5, 0]}>
          <div style={{ position: 'relative', width: PX, height: py }}>
            {media!.kind === 'site' && <SiteFrame media={media!} px={PX} py={py} />}
            {media!.kind === 'video' && <SyncedVideo media={media!} px={PX} py={py} />}
            {media!.kind === 'youtube' && <YouTubeFrame media={media!} px={PX} py={py} />}
            {media!.kind === 'share' && <ShareFrame media={media!} px={PX} py={py} />}
            <button
              title="全屏观看(原生分辨率)"
              onClick={() => useFullscreenMedia.getState().setOpen(true)}
              style={{
                position: 'absolute', top: 6, right: 6, zIndex: 2, cursor: 'pointer',
                background: 'rgba(10,14,22,0.72)', color: '#e8ecf4', border: '1px solid #445',
                borderRadius: 8, fontSize: 16, lineHeight: 1, padding: '5px 9px',
              }}
            >
              ⛶
            </button>
          </div>
        </Html>
      )}
      <pointLight ref={glowRef} position={[0, 0, 1.4]} color="#aac4e8" intensity={0.7} distance={7} decay={2} />
    </group>
  );
}
