/**
 * Reusable synced media players, shared by the in-world CSS3D screen
 * (MediaScreen) and the fullscreen DOM overlay (FullscreenViewer):
 *  - SiteFrame:    any website in a sandboxed iframe
 *  - SyncedVideo:  direct video file, playhead steered to the server clock
 *  - YouTubeFrame: official IFrame API player, synced the same way
 *  - ShareFrame:   a player's WebRTC screen-share stream (kind 'share')
 * All timed players correct drift against the same mediaTargetPosition()
 * extrapolation, so every mount (3D screen or fullscreen) stays in step.
 * Components are sized in CSS pixels (px × py) by the caller.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings, useVoice, useWorld } from '../../state/stores';
import { hot } from '../../state/hot';
import { voice } from '../../voice/voice';
import { mediaPositionAt, type MediaState } from '@nexuspark/shared';
import { mediaRuntime } from './runtime';

const serverNow = () => Date.now() + hot.serverTimeOffset;

/** 服务器时钟外推的目标播放位置(全端统一的纠偏基准,公式在 shared)。 */
export function mediaTargetPosition(m: MediaState): number {
  return mediaPositionAt(m, serverNow());
}

export interface PlayerProps {
  media: MediaState;
  /** CSS pixel size of the player surface. */
  px: number;
  py: number;
}

export const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#9aa7bd', fontSize: 22, background: '#05070c', textAlign: 'center', padding: 16,
};

export function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

/* ── Generic website iframe ──────────────────────────────────────────────── */
export function SiteFrame({ media, px, py }: PlayerProps) {
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

/* ── Synced direct-file video ────────────────────────────────────────────── */
export function SyncedVideo({ media, px, py }: PlayerProps) {
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
  if (err) {
    return (
      <div style={{ width: px, height: py, position: 'relative', background: '#05070c' }}>
        <div style={overlayStyle}>这个视频放不出来(链接失效或被拦截)。</div>
      </div>
    );
  }
  return (
    <video
      ref={ref}
      src={media.url!}
      loop={media.loop}
      playsInline
      onError={() => setErr(true)}
      style={{ width: px, height: py, objectFit: 'contain', background: '#000' }}
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
export function loadYouTubeAPI(): Promise<any> {
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

export function YouTubeFrame({ media, px, py }: PlayerProps) {
  const holder = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [muted, setMuted] = useState(true);
  const mediaVolume = useSettings((s) => s.mediaVolume);
  const videoId = useMemo(() => {
    try { return new URL(media.url!).searchParams.get('v'); } catch { return null; }
  }, [media.url]);

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
          width: px, height: py,
          videoId,
          playerVars: {
            autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1,
            modestbranding: 1, disablekb: 1, enablejsapi: 1, origin: location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              // let the iframe follow the holder so viewport resizes just work
              try {
                const f = playerRef.current?.getIframe?.() as HTMLIFrameElement | undefined;
                if (f) { f.style.width = '100%'; f.style.height = '100%'; }
              } catch { /* fine */ }
              setStatus('ok');
            },
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
    <div style={{ width: px, height: py, background: '#000', position: 'relative', overflow: 'hidden' }}>
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

/* ── WebRTC screen-share on the big screen (kind 'share') ────────────────── */
export function ShareFrame({ media, px, py }: PlayerProps) {
  // stream arrivals/departures bump screenVersion → re-render picks them up
  useVoice((s) => s.screenVersion);
  const roster = useWorld((s) => s.roster);
  const ref = useRef<HTMLVideoElement>(null);
  const ownerId = media.ownerId ?? 0;
  const ownerName = roster.find((p) => p.id === ownerId)?.username ?? media.setBy ?? '有人';
  const stream = ownerId === hot.selfId
    ? voice.localScreenStream
    : voice.screenStreams.get(ownerId) ?? null;

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    return () => { el.srcObject = null; };
  }, [stream]);

  return (
    <div style={{ width: px, height: py, background: '#000', position: 'relative', overflow: 'hidden' }}>
      {stream ? (
        <video
          ref={ref}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
        />
      ) : (
        <div style={overlayStyle}>等待 {ownerName} 的共享画面…(需要靠近共享者建立连接)</div>
      )}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, padding: '3px 10px', fontSize: 12,
        background: 'rgba(8,10,16,0.7)', color: '#9aa7bd', textAlign: 'right', pointerEvents: 'none',
      }}>
        由 {ownerName} 投屏
      </div>
    </div>
  );
}
