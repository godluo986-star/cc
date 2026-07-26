import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { useSession, useSettings, useUI, useWorld } from './state/stores';
import { hot } from './state/hot';
import Scene from './world3d/Scene';
import HUD from './ui/HUD';
import LoadingScreen from './ui/LoadingScreen';
import { voice } from './voice/voice';
import { connection } from './net/connection';

// Debug/automation handle (used by the headless smoke test).
declare global {
  interface Window {
    __nx?: { hot: typeof hot; connection: typeof connection; world: typeof useWorld; ui: typeof useUI; voice: typeof voice };
  }
}
if (typeof window !== 'undefined') window.__nx = { hot, connection, world: useWorld, ui: useUI, voice };

export default function WorldApp() {
  const phase = useSession((s) => s.phase);
  const reconnecting = useSession((s) => s.reconnecting);
  const quality = useSettings((s) => s.quality);
  const shadows = useSettings((s) => s.shadows);
  const fade = useUI((s) => s.fade);
  const spaceKey = useWorld((s) => s.spaceKey);

  // panel-open flag mirrors into hot state so the 3D loop can pause input
  useEffect(() => {
    const unsub = useUI.subscribe((s) => {
      hot.uiOpen = s.panel.kind !== 'none' || s.dialogue !== null;
    });
    return unsub;
  }, []);

  // voice runtime lifecycle
  useEffect(() => {
    voice.attach();
    return () => voice.detach();
  }, []);

  const dpr: [number, number] = quality === 'low' ? [0.75, 1] : quality === 'medium' ? [1, 1.25] : quality === 'high' ? [1, 1.75] : [1, 2.2];

  return (
    <>
      <div className="canvas-wrap">
        {phase === 'inworld' && spaceKey && (
          <Canvas
            shadows={shadows}
            dpr={dpr}
            camera={{ fov: 42, near: 0.1, far: 600, position: [0, 3, 8] }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            onCreated={({ scene }) => { (window as unknown as { __nxScene?: unknown }).__nxScene = scene; }}
          >
            <Scene />
          </Canvas>
        )}
      </div>
      {phase !== 'inworld' && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div className="dim">{reconnecting ? '正在重连…' : '正在进入团子广场…'}</div>
        </div>
      )}
      <div className="fade-overlay" style={{ opacity: fade ? 1 : 0 }} />
      {/* P4 加载进度覆盖层(叠在旧 loading-overlay 之上,阶段式进度) */}
      <LoadingScreen />
      <HUD />
    </>
  );
}
