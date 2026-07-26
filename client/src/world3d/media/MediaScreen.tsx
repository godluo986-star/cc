/**
 * Synchronized media screen — website-embed approach. The screen surface is
 * a real DOM overlay positioned in 3D (CSS3D via drei <Html transform>):
 *  - 'site':    any website in a sandboxed iframe (shared URL for everyone;
 *               fully interactive — you can scroll/click it in-world)
 *  - 'youtube': official YouTube IFrame embed, playback position synced to
 *               the server clock (play/pause/seek/rate)
 *  - 'video':   direct video file in a <video> element, position synced
 * Legal embedding only — sites that send X-Frame-Options/CSP deny simply
 * refuse to render and the panel explains that.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useWorld, useSettings } from '../../state/stores';
import { hot } from '../../state/hot';
import type { MediaState } from '@nexuspark/shared';
import { mediaRuntime } from './runtime';

const serverNow = () => Date.now() + hot.serverTimeOffset;

export function mediaTargetPosition(m: MediaState): number {
  if (!m.url) return 0;
  return m.playing ? m.position + ((serverNow() - m.updatedAt) / 1000) * m.rate : m.position;
}

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

/* ── Generic website iframe ──────────────────────────────────────────────── */
function SiteFrame({ media, w, h }: { media: MediaState; w: number; h: number }) {
  const px = PX;
  const py = Math.round(PX * (h / w));
  return (
    <div style={{ width: px, height: py, background: '#0a0d14', position: 'relative', overflow: 'hidden' }}>
      <iframe
        src={media.url!}
        title="screen"
        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        referrerPolicy="no-referrer"
        allow="autoplay; encrypted-media; picture-in-picture"
      />
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: '3px 10px', fontSize: 12,
        background: 'rgba(8,10,16,0.8)', color: '#9aa7bd', display: 'flex', gap: 8, pointerEvents: 'none',
      }}>
        <span>🌐 {safeHost(media.url!)}</span>
        <span style={{ marginLeft: 'auto' }}>由 {media.setBy ?? '—'} 放映</span>
      </div>
    </div>
  );
}
function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

/* ── Synced direct-file video ────────────────────────────────────────────── */
function OverlayVideo({ media, w, h }: { media: MediaState; w: number; h: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState(false);
  const mediaVolume = useSettings((s) => s.mediaVolume);
  useEffect(() => setErr(false), [media.url]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const target = mediaTargetPosition(media);
      const cur = media.loop && el.duration > 0 ? target % el.duration : target;
      if (Math.abs(el.currentTime - cur) > 1.25 && Number.isFinite(cur)) el.currentTime = cur;
      el.playbackRate = media.rate;
      if (media.playing && el.paused) el.play().catch(() => { el.muted = true; el.play().catch(() => setErr(true)); });
      else if (!media.playing && !el.paused) el.pause();
      mediaRuntime.report(el.currentTime, el.duration);
    };
    sync();
    const iv = setInterval(sync, 900);
    return () => clearInterval(iv);
  }, [media]);
  useEffect(() => {
    const el = ref.current;
    if (el) el.volume = mediaVolume;
  }, [mediaVolume]);
  const py = Math.round(PX * (h / w));
  if (err) {
    return <div style={{ width: PX, height: py, ...overlayStyle }}>这个视频放不出来(链接失效或被拦截)。</div>;
  }
  return (
    <video
      ref={ref}
      src={media.url!}
      loop={media.loop}
      playsInline
      onError={() => setErr(true)}
      style={{ width: PX, height: py, objectFit: 'contain', background: '#000' }}
    />
  );
}

/* ── YouTube via official IFrame API (synced) ────────────────────────────── */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let ytPromise: Promise<any> | null = null;
function loadYouTubeAPI(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('yt timeout')), 12000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { clearTimeout(timer); reject(new Error('yt load failed')); };
    document.head.appendChild(s);
  });
  return ytPromise;
}

function YouTubeFrame({ media, w, h }: { media: MediaState; w: number; h: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [muted, setMuted] = useState(true);
  const mediaVolume = useSettings((s) => s.mediaVolume);
  const videoId = useMemo(() => {
    try { return new URL(media.url!).searchParams.get('v'); } catch { return null; }
  }, [media.url]);
  const py = Math.round(PX * (h / w));

  useEffect(() => {
    let cancelled = false;
    if (!videoId || !holder.current) return;
    setStatus('loading');
    loadYouTubeAPI()
      .then((YTNS) => {
        if (cancelled || !holder.current) return;
        holder.current.innerHTML = '';
        const div = document.createElement('div');
        holder.current.appendChild(div);
        playerRef.current = new YTNS.Player(div, {
          width: PX, height: py,
          videoId,
          playerVars: {
            autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1,
            modestbranding: 1, disablekb: 1, enablejsapi: 1, origin: location.origin,
          },
          events: {
            onReady: () => { if (!cancelled) setStatus('ok'); },
            onError: () => { if (!cancelled) setStatus('error'); },
          },
        });
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch { /* fine */ }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    const iv = setInterval(() => {
      const p = playerRef.current;
      if (!p || status !== 'ok' || typeof p.getCurrentTime !== 'function') return;
      try {
        const target = mediaTargetPosition(media);
        const cur = p.getCurrentTime() as number;
        if (Math.abs(cur - target) > 1.6) p.seekTo(target, true);
        if (typeof p.getPlaybackRate === 'function' && p.getPlaybackRate() !== media.rate) p.setPlaybackRate(media.rate);
        const state = p.getPlayerState();
        if (media.playing && state !== 1 && state !== 3) p.playVideo();
        if (!media.playing && state === 1) p.pauseVideo();
        p.setVolume(Math.round(mediaVolume * 100));
        if (typeof p.getDuration === 'function') mediaRuntime.report(cur, p.getDuration() || 0);
      } catch { /* player mid-transition */ }
    }, 1000);
    return () => clearInterval(iv);
  }, [media, status, mediaVolume]);

  const unmute = () => {
    try { playerRef.current?.unMute(); setMuted(false); } catch { /* fine */ }
  };

  return (
    <div style={{ width: PX, height: py, background: '#000', position: 'relative', overflow: 'hidden' }}>
      <div ref={holder} style={{ width: '100%', height: '100%' }} />
      {status === 'loading' && <div style={overlayStyle}>YouTube 加载中…</div>}
      {status === 'error' && <div style={overlayStyle}>这个视频不允许嵌入,换一个试试。</div>}
      {status === 'ok' && muted && (
        <button onClick={unmute} style={{
          position: 'absolute', bottom: 10, left: 10, padding: '6px 12px', cursor: 'pointer',
          background: 'rgba(10,14,22,0.85)', color: '#fff', border: '1px solid #445', borderRadius: 8, fontSize: 14,
        }}>
          🔇 点一下取消静音
        </button>
      )}
    </div>
  );
}
const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#9aa7bd', fontSize: 22, background: '#05070c', textAlign: 'center', padding: 16,
};

/* ── The screen assembly ─────────────────────────────────────────────────── */
export default function MediaScreen({ position, rotation, width, height, frame = true }: {
  position: [number, number, number];
  rotation: number;
  width: number;
  height: number;
  frame?: boolean;
}) {
  const media = useWorld((s) => s.media);
  const active = !!media?.url;
  const idle = useMemo(() => idleTexture(), []);
  const glowRef = useRef<THREE.PointLight>(null);
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
      {active && (
        /* distanceFactor=400 抵消 drei transform 模式的 (df||10)/400 内置缩放,
           使 1 个 CSS 缩放单位 = 1 个世界单位:div 宽 PX px × scale = width 米 */
        <Html transform position={[0, 0, 0.03]} scale={width / PX} distanceFactor={400} zIndexRange={[5, 0]}>
          {media!.kind === 'site' && <SiteFrame media={media!} w={width} h={height} />}
          {media!.kind === 'video' && <OverlayVideo media={media!} w={width} h={height} />}
          {media!.kind === 'youtube' && <YouTubeFrame media={media!} w={width} h={height} />}
        </Html>
      )}
      <pointLight ref={glowRef} position={[0, 0, 1.4]} color="#aac4e8" intensity={0.7} distance={7} decay={2} />
    </group>
  );
}
