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

/**
 * 分层漂移纠偏(任务书 §八):阈值集中一处,严禁散落。
 *  |drift| < DEAD          → 不动(防抖)
 *  DEAD..RATE_ZONE         → playbackRate 微调 ±RATE_ADJ 追齐(不变调)
 *  RATE_ZONE..SEEK_ZONE    → 一次受控 seek(带冷却,防连环跳)
 *  > SEEK_ZONE / 换源      → 强制重同步
 */
export const SYNC = {
  DEAD: 0.18,
  RATE_ZONE: 0.8,
  SEEK_ZONE: 2.0,
  RATE_ADJ: 0.06,
  SEEK_COOLDOWN_MS: 1800,
  TICK_MS: 500,
  /** YouTube 只支持档位倍速,微调走 seek:更宽的死区 + 更长冷却。 */
  YT_DEAD: 0.3,
  YT_SEEK: 1.2,
  YT_COOLDOWN_MS: 2600,
} as const;

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
  // 浏览器要求用户手势才能出声播放时:显示「点击继续一起观看」,
  // 点击后立即追到权威进度(任务书 §十二),不从旧进度续播。
  const [needGesture, setNeedGesture] = useState(false);
  const mediaVolume = useSettings((s) => s.mediaVolume);
  useEffect(() => { setErr(false); setNeedGesture(false); }, [media.url]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 不变调微调(各浏览器字段名不同,全部尝试)
    try {
      (el as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = true;
      (el as HTMLVideoElement & { mozPreservesPitch?: boolean }).mozPreservesPitch = true;
      (el as HTMLVideoElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    } catch { /* fine */ }
    let lastSeekAt = 0;
    const sync = () => {
      const targetRaw = mediaTargetPosition(media);
      const target = media.loop && el.duration > 0 ? targetRaw % el.duration : targetRaw;
      if (!Number.isFinite(target)) return;

      // 本地缓冲:不 seek 轰炸,等 canplay 再一次性追齐
      if (media.playing && el.readyState < 3 && el.currentTime > 0) {
        mediaRuntime.reportSync({ drift: 0, mode: 'buffer', rate: el.playbackRate, expected: target, local: el.currentTime });
        return;
      }

      const drift = el.currentTime - target; // >0 超前, <0 落后
      const ad = Math.abs(drift);
      const now = performance.now();
      if (ad < SYNC.DEAD) {
        el.playbackRate = media.rate;
        mediaRuntime.reportSync({ drift, mode: 'idle', rate: el.playbackRate, expected: target, local: el.currentTime });
      } else if (ad < SYNC.RATE_ZONE && media.playing) {
        // 轻微变速追齐:落后加速、超前减速(preservesPitch 已开,不变调)
        el.playbackRate = media.rate * (1 - Math.sign(drift) * SYNC.RATE_ADJ);
        mediaRuntime.reportSync({ drift, mode: 'rate', rate: el.playbackRate, expected: target, local: el.currentTime });
      } else if (now - lastSeekAt > SYNC.SEEK_COOLDOWN_MS) {
        // 一次受控 seek(冷却期内绝不连跳)
        lastSeekAt = now;
        el.currentTime = target;
        el.playbackRate = media.rate;
        mediaRuntime.reportSync({ drift, mode: 'seek', rate: el.playbackRate, expected: target, local: el.currentTime });
      }

      if (media.playing && el.paused) {
        el.play().then(() => setNeedGesture(false)).catch(() => {
          el.muted = true;
          el.play().then(() => setNeedGesture(false)).catch(() => setNeedGesture(true));
        });
      } else if (!media.playing && !el.paused) { el.pause(); el.currentTime = target; }
      mediaRuntime.report(el.currentTime, el.duration);
    };
    sync();
    const onCanPlay = () => sync();
    el.addEventListener('canplay', onCanPlay);
    // 后台标签页恢复:定时器曾被浏览器降频,回前台立即做一次追齐
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    const iv = setInterval(sync, SYNC.TICK_MS);
    return () => {
      clearInterval(iv);
      el.removeEventListener('canplay', onCanPlay);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
    <div style={{ width: px, height: py, position: 'relative', background: '#000' }}>
      <video
        ref={ref}
        src={media.url!}
        loop={media.loop}
        playsInline
        onError={() => setErr(true)}
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
      />
      {needGesture && media.playing && (
        <button
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            el.muted = false;
            el.currentTime = mediaTargetPosition(media); // 追到当前权威进度,不续旧进度
            el.play().then(() => setNeedGesture(false)).catch(() => undefined);
          }}
          style={{
            position: 'absolute', inset: 0, margin: 'auto', width: 260, height: 56, cursor: 'pointer',
            background: 'rgba(10,14,22,0.88)', color: '#e8ecf4', border: '1px solid #5b8cff',
            borderRadius: 12, fontSize: 16,
          }}
        >
          ▶ 点击继续一起观看
        </button>
      )}
    </div>
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
    let lastSeekAt = 0;
    const tick = () => {
      const p = playerRef.current;
      if (!p || status !== 'ok' || typeof p.getCurrentTime !== 'function') return;
      try {
        const target = mediaTargetPosition(media);
        const cur = p.getCurrentTime() as number;
        const state = p.getPlayerState();
        const drift = cur - target;
        // YT 缓冲(3)时不校正,等它自己恢复
        if (state !== 3 && Math.abs(drift) > SYNC.YT_SEEK && performance.now() - lastSeekAt > SYNC.YT_COOLDOWN_MS) {
          lastSeekAt = performance.now();
          p.seekTo(target, true);
          mediaRuntime.reportSync({ drift, mode: 'seek', rate: media.rate, expected: target, local: cur });
        } else {
          mediaRuntime.reportSync({ drift, mode: state === 3 ? 'buffer' : 'idle', rate: media.rate, expected: target, local: cur });
        }
        if (typeof p.getPlaybackRate === 'function' && p.getPlaybackRate() !== media.rate) p.setPlaybackRate(media.rate);
        if (media.playing && state !== 1 && state !== 3) p.playVideo();
        if (!media.playing && state === 1) p.pauseVideo();
        p.setVolume(Math.round(mediaVolume * 100));
        if (typeof p.getDuration === 'function') mediaRuntime.report(cur, p.getDuration() || 0);
      } catch { /* player mid-transition */ }
    };
    const iv = setInterval(tick, 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
