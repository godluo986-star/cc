/**
 * 全屏观影覆盖层(设计文档 §9.2):固定定位 DOM(非 CSS3D),按视口原生
 * 分辨率重建同源播放器 —— 播放器与同步纠偏逻辑与 3D 大屏共用
 * world3d/media/players 里的同一套组件,因此进度始终一致;打开期间
 * MediaScreen 会熄掉自己的 CSS3D 播放器,本机只保留这一个。
 * Esc 或右上角 ✕ 退出;打开时通过 hot.uiOpen 暂停 3D 输入。
 */
import { useEffect, useState } from 'react';
import { useUI, useWorld } from '../state/stores';
import { hot } from '../state/hot';
import { useFullscreenMedia } from '../world3d/media/fullscreen';
import { SiteFrame, SyncedVideo, YouTubeFrame, ShareFrame } from '../world3d/media/players';

export default function FullscreenViewer() {
  const open = useFullscreenMedia((s) => s.open);
  const media = useWorld((s) => s.media);
  const active = !!media && (!!media.url || media.kind === 'share');
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });

  // 屏幕被清空/换空间后媒体没了 → 自动退出全屏
  useEffect(() => {
    if (open && !active) useFullscreenMedia.getState().setOpen(false);
  }, [open, active]);

  // 打开期间:跟踪视口尺寸、Esc 退出、占住 hot.uiOpen 暂停 3D 输入
  useEffect(() => {
    if (!open) return;
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // 别让 HUD 的全局 Esc 处理再跑一遍
        useFullscreenMedia.getState().setOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
    // 全屏不是面板系统的一员:WorldApp 在 useUI 变化时会重算 hot.uiOpen,
    // 这里在其后再断言一次(zustand 订阅按注册顺序执行,本订阅注册在后)。
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

  if (!open || !media || !active) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#000' }}>
      {media.kind === 'site' && <SiteFrame media={media} px={vp.w} py={vp.h} />}
      {media.kind === 'video' && <SyncedVideo media={media} px={vp.w} py={vp.h} />}
      {media.kind === 'youtube' && <YouTubeFrame media={media} px={vp.w} py={vp.h} />}
      {media.kind === 'share' && <ShareFrame media={media} px={vp.w} py={vp.h} />}
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
    </div>
  );
}
