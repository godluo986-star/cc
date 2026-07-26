/**
 * 加载界面(P4,总纲 §10「加载」):深色黄昏街区配色 + 阶段进度。
 *
 * 诚实说明:城市分帧构建的 BuildQueue 实例是 City.tsx 的模块级私有变量
 * (City.tsx / progressive.ts 归其他工单,不可改),外部无法订阅其
 * onProgress。因此这里显示的是「阶段式」进度 —— 前两个阶段来自真实状态
 * (useSession.phase 连接 → useWorld.spaceKey 世界数据就位),第三阶段
 * 「构建街区」用短暂的时间缓动收尾(掩盖首屏分帧生成的 pop-in),
 * 并非逐任务的真实构建百分比。后续若 BuildQueue 暴露全局进度源,
 * 只需把 pct 换成真实 done/total。
 */
import { useEffect, useState } from 'react';
import { useSession, useWorld } from '../state/stores';

const STAGES = ['连接服务器', '同步世界数据', '构建街区'] as const;
/** 阶段 2(构建街区)的时间缓冲时长(ms):盖住首屏出生点 80m 半径的分帧生成。 */
const BUILD_SETTLE_MS = 1600;
/** 淡出动画时长(ms),与下方 transition 保持一致。 */
const FADE_MS = 550;

const S = {
  wrap: {
    position: 'absolute', inset: 0, zIndex: 32,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 18, background: 'radial-gradient(120% 90% at 50% 18%, #232a3d 0%, #151a2b 52%, #0e1220 100%)',
    color: '#c9cede', transition: `opacity ${FADE_MS}ms ease`, fontFamily: 'inherit',
  } as const,
  title: { fontSize: 30, letterSpacing: 12, textIndent: 12, color: '#d8dcea', textShadow: '0 0 18px rgba(93,143,201,0.35)' } as const,
  sub: { fontSize: 12, letterSpacing: 5, color: '#6b7288', marginTop: -8 } as const,
  barTrack: { width: 300, maxWidth: '72vw', height: 4, borderRadius: 2, background: '#232a3d', overflow: 'hidden', marginTop: 10 } as const,
  barFill: { height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #5d8fc9, #7fd1c0)', transition: 'width 480ms ease' } as const,
  stages: { display: 'flex', gap: 18, fontSize: 12, marginTop: 2 } as const,
} as const;

export default function LoadingScreen() {
  const phase = useSession((s) => s.phase);
  const reconnecting = useSession((s) => s.reconnecting);
  const spaceKey = useWorld((s) => s.spaceKey);

  // 0 连接服务器 / 1 同步世界数据 / 2 构建街区(时间缓动收尾)
  const stage = phase !== 'inworld' ? 0 : !spaceKey ? 1 : 2;
  const [settled, setSettled] = useState(false); // 构建缓冲已结束(进度打满,开始淡出)
  const [gone, setGone] = useState(false);       // 淡出完成,卸载覆盖层

  useEffect(() => {
    if (stage === 2) {
      const t = setTimeout(() => setSettled(true), BUILD_SETTLE_MS);
      return () => clearTimeout(t);
    }
    // 掉线重连等回退:重新显示
    setSettled(false);
    setGone(false);
    return undefined;
  }, [stage]);

  useEffect(() => {
    if (!settled) return undefined;
    const t = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [settled]);

  if (gone) return null;
  const pct = stage === 0 ? 24 : stage === 1 ? 58 : settled ? 100 : 88;
  return (
    <div style={{ ...S.wrap, opacity: settled ? 0 : 1, pointerEvents: settled ? 'none' : 'auto' }}>
      <div style={S.title}>黄昏街区</div>
      <div style={S.sub}>NEXUS PARK · DUSK WARD</div>
      <div style={S.barTrack}>
        <div style={{ ...S.barFill, width: `${pct}%` }} />
      </div>
      <div style={S.stages}>
        {STAGES.map((label, i) => (
          <span key={label} style={{ color: i < stage ? '#7fd1c0' : i === stage ? '#c9cede' : '#4a5065' }}>
            {i < stage ? '✓ ' : ''}{label}{i === stage ? '…' : ''}
          </span>
        ))}
      </div>
      {reconnecting && <div style={{ fontSize: 12, color: '#c9873f' }}>正在重连…</div>}
    </div>
  );
}
