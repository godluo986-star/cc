/**
 * MediaLayer —— 全客户端唯一的持久媒体播放层(任务书 §十五/§十六)。
 *
 * 同一批 React 播放器节点(video / iframe / YouTube / 共享流)常驻在这里,
 * 只切换外层样式:
 *  - 世界模式:三层 CSS3D 包装(perspective → 相机矩阵 → 物体矩阵),矩阵由
 *    MediaScreen 每帧经 mediaRuntime 推入,直接写 DOM,不经 React;
 *  - 全屏模式:同一棵树切成 fixed inset:0,黑底 contain 布局。
 * 因此进出全屏:不重建 video、不重载 iframe、不产生双音轨、进度不丢。
 * 附带:黑边感知的坐标映射(点击黑边不算内容点击)与 np_watch_debug=1 调试角标。
 */
import { useEffect, useRef, useState } from 'react';
import { useUI, useWorld } from '../state/stores';
import { hot } from '../state/hot';
import { useFullscreenMedia } from '../world3d/media/fullscreen';
import { mediaRuntime, type LayerFrame } from '../world3d/media/runtime';
import { SiteFrame, SyncedVideo, YouTubeFrame, ShareFrame } from '../world3d/media/players';
import { PX } from '../world3d/media/MediaScreen';

/** contain 布局下的实际内容区(黑边感知;任务书 §十八)。 */
export function contentRectOf(containerW: number, containerH: number, mediaW: number, mediaH: number) {
  if (mediaW <= 0 || mediaH <= 0) return { x: 0, y: 0, w: containerW, h: containerH };
  const s = Math.min(containerW / mediaW, containerH / mediaH);
  const w = mediaW * s;
  const h = mediaH * s;
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h };
}

export default function FullscreenViewer() {
  const open = useFullscreenMedia((s) => s.open);
  const media = useWorld((s) => s.media);
  const active = !!media && (!!media.url || media.kind === 'share');
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [debugOn] = useState(() => localStorage.getItem('np_watch_debug') === '1');
  const [dbg, setDbg] = useState(mediaRuntime.debug);
  const [norm, setNorm] = useState<{ u: number; v: number } | null>(null);

  const outerRef = useRef<HTMLDivElement>(null);   // perspective 容器 / 全屏容器
  const camRef = useRef<HTMLDivElement>(null);     // 相机矩阵层
  const objRef = useRef<HTMLDivElement>(null);     // 物体矩阵层(含播放器)
  const frameRef = useRef<LayerFrame | null>(null);
  // 世界模式下播放器的 CSS 高度(跟随持有屏的宽高比;仅比例变化时才重渲染)
  const [worldPy, setWorldPy] = useState(Math.round(PX * 9 / 16));

  // 世界模式:MediaScreen 每帧推矩阵,直接写 DOM(不触发 React)
  useEffect(() => {
    mediaRuntime.onLayerFrame((f) => {
      frameRef.current = f;
      if (f) setWorldPy((prev) => (prev === f.py ? prev : f.py));
      const outer = outerRef.current;
      const cam = camRef.current;
      const obj = objRef.current;
      if (!outer || !cam || !obj) return;
      if (useFullscreenMedia.getState().open) return; // 全屏样式由 React 侧管理
      if (!f || !f.visible) { outer.style.display = 'none'; return; }
      outer.style.display = 'block';
      outer.style.perspective = `${f.fovPx}px`;
      outer.style.width = `${f.w}px`;
      outer.style.height = `${f.h}px`;
      cam.style.transform = f.cameraCss;
      cam.style.width = `${f.w}px`;
      cam.style.height = `${f.h}px`;
      obj.style.transform = f.objectCss;
      obj.style.width = `${f.px}px`;
      obj.style.height = `${f.py}px`;
    });
    return () => mediaRuntime.onLayerFrame(null);
  }, []);

  // 屏幕被清空/换空间后媒体没了 → 自动退出全屏
  useEffect(() => {
    if (open && !active) useFullscreenMedia.getState().setOpen(false);
  }, [open, active]);

  // 全屏期间:视口尺寸、Esc 退出、占住 hot.uiOpen 暂停 3D 输入
  useEffect(() => {
    if (!open) return;
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        useFullscreenMedia.getState().setOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
    hot.uiOpen = true;
    const unsub = useUI.subscribe(() => { hot.uiOpen = true; });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey, true);
      unsub();
      const s = useUI.getState();
      hot.uiOpen = s.panel.kind !== 'none' || s.dialogue !== null;
    };
  }, [open]);

  // 调试角标刷新
  useEffect(() => {
    if (!debugOn) return;
    const iv = setInterval(() => setDbg({ ...mediaRuntime.debug }), 600);
    return () => clearInterval(iv);
  }, [debugOn]);

  if (!media || !active) return null;

  const playerPx = open ? vp.w : PX;
  const playerPy = open ? vp.h : worldPy;

  // 黑边感知点击(全屏 + video/share):黑边不算内容点击(任务书 §十八)
  const onFsPointer = (e: React.PointerEvent) => {
    if (!open) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const vid = el.querySelector('video');
    const mw = vid?.videoWidth ?? 16;
    const mh = vid?.videoHeight ?? 9;
    const cr = contentRectOf(r.width, r.height, mw, mh);
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < cr.x || y < cr.y || x > cr.x + cr.w || y > cr.y + cr.h) { setNorm(null); return; }
    setNorm({ u: (x - cr.x) / cr.w, v: (y - cr.y) / cr.h });
  };

  return (
    <div
      ref={outerRef}
      onPointerDown={onFsPointer}
      style={open ? {
        position: 'fixed', inset: 0, zIndex: 60, background: '#000', display: 'block',
      } : {
        position: 'fixed', inset: 0, zIndex: 5, overflow: 'hidden', pointerEvents: 'none', display: 'none',
      }}
    >
      <div
        ref={camRef}
        style={open ? { position: 'absolute', inset: 0, transform: 'none' } : {
          position: 'absolute', top: 0, left: 0, transformStyle: 'preserve-3d', pointerEvents: 'none',
        }}
      >
        <div
          ref={objRef}
          style={open ? {
            position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'none', pointerEvents: 'auto',
          } : {
            position: 'absolute', pointerEvents: 'auto',
          }}
        >
          {/* 唯一的播放器实例组(进出全屏只换 px/py 与外层样式,节点不重建) */}
          {media.kind === 'site' && <SiteFrame media={media} px={playerPx} py={playerPy} />}
          {media.kind === 'video' && <SyncedVideo media={media} px={playerPx} py={playerPy} />}
          {media.kind === 'youtube' && <YouTubeFrame media={media} px={playerPx} py={playerPy} />}
          {media.kind === 'share' && <ShareFrame media={media} px={playerPx} py={playerPy} />}
          {!open && (
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
          )}
        </div>
      </div>
      {open && (
        <button
          onClick={() => useFullscreenMedia.getState().setOpen(false)}
          style={{
            position: 'absolute', top: 12, right: 14, zIndex: 2, cursor: 'pointer',
            background: 'rgba(10,14,22,0.82)', color: '#e8ecf4', border: '1px solid #445',
            borderRadius: 10, fontSize: 14, padding: '8px 14px',
          }}
        >
          ✕ 退出全屏(Esc)
        </button>
      )}
      {debugOn && (
        <div style={{
          position: 'fixed', left: 10, bottom: 10, zIndex: 70, pointerEvents: 'none',
          background: 'rgba(8,10,16,0.85)', color: '#8fe3c9', font: '11px/1.5 monospace',
          padding: '6px 9px', borderRadius: 8, whiteSpace: 'pre',
        }}>
          {`watch ${open ? 'FULLSCREEN' : 'WORLD'}  drift ${dbg.drift.toFixed(3)}s (${dbg.mode})\n`
            + `rate ${dbg.rate.toFixed(3)}  exp ${dbg.expected.toFixed(2)}  loc ${dbg.local.toFixed(2)}\n`
            + `offset ${Math.round(hot.serverTimeOffset)}ms  norm ${norm ? `${norm.u.toFixed(3)},${norm.v.toFixed(3)}` : '—'}`}
        </div>
      )}
    </div>
  );
}
