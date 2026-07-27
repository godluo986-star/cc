/**
 * 手机触控层(阶段一):左下虚拟摇杆 + 右下动作键。
 *  - 摇杆写 hot.touchVec(推满自动跑);视角旋转复用画布上的 Pointer 拖动
 *    (触屏单指拖动画布 = 原有鼠标拖动同一条代码路径),无需额外手势层。
 *  - 动作键走合成键盘事件(与桌面同一条处理链):E 互动、跳(按住)、
 *    G 抓取(按住即抓松手即放)、V 视角。
 *  - 仅在触屏设备渲染;捏合缩放等进阶手势记入日志待后续轮次。
 */
import { useEffect, useRef, useState } from 'react';
import { hot } from '../state/hot';

const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

const key = (type: 'keydown' | 'keyup', code: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

export default function TouchControls() {
  const [enabled] = useState(isTouchDevice);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    return () => { hot.touchVec.x = 0; hot.touchVec.z = 0; };
  }, [enabled]);

  if (!enabled) return null;

  const R = 56; // 摇杆半径(CSS px)

  const setFromEvent = (e: React.PointerEvent) => {
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!base || !knob) return;
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    hot.touchVec.x = dx / R;        // 屏幕右 = +x
    hot.touchVec.z = -dy / R;       // 屏幕上 = 前进(+z 语义与 W 一致)
  };
  const releaseStick = () => {
    activePointer.current = null;
    hot.touchVec.x = 0;
    hot.touchVec.z = 0;
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  };

  const HoldBtn = ({ label, code, title }: { label: string; code: string; title: string }) => (
    <button
      className="btn touch-btn"
      title={title}
      onPointerDown={(e) => { e.preventDefault(); key('keydown', code); }}
      onPointerUp={() => key('keyup', code)}
      onPointerCancel={() => key('keyup', code)}
      onPointerLeave={() => key('keyup', code)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
  const TapBtn = ({ label, code, title }: { label: string; code: string; title: string }) => (
    <button
      className="btn touch-btn"
      title={title}
      onPointerDown={(e) => { e.preventDefault(); key('keydown', code); key('keyup', code); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );

  return (
    <>
      {/* 左下:虚拟摇杆 */}
      <div
        ref={baseRef}
        style={{
          position: 'fixed', left: 18, bottom: 86, width: R * 2, height: R * 2, zIndex: 30,
          borderRadius: '50%', background: 'rgba(20,26,40,0.35)', border: '1.5px solid rgba(150,170,210,0.35)',
          touchAction: 'none',
        }}
        onPointerDown={(e) => {
          activePointer.current = e.pointerId;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setFromEvent(e);
        }}
        onPointerMove={(e) => { if (activePointer.current === e.pointerId) setFromEvent(e); }}
        onPointerUp={releaseStick}
        onPointerCancel={releaseStick}
      >
        <div
          ref={knobRef}
          style={{
            position: 'absolute', left: R - 24, top: R - 24, width: 48, height: 48,
            borderRadius: '50%', background: 'rgba(150,180,230,0.55)', pointerEvents: 'none',
          }}
        />
      </div>
      {/* 右下:动作键(位于 dock 上方,避开原有按钮) */}
      <div style={{ position: 'fixed', right: 14, bottom: 148, zIndex: 30, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <TapBtn label="E" code="KeyE" title="互动" />
        <HoldBtn label="跳" code="Space" title="跳跃(按住可蓄)" />
        <HoldBtn label="抓" code="KeyG" title="长按抓住附近团子,松手放下" />
        <TapBtn label="👁" code="KeyV" title="切换第一/第三人称" />
      </div>
    </>
  );
}
