import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  EffectComposer, Bloom, Vignette, SMAA, HueSaturation, Noise, ChromaticAberration,
} from '@react-three/postprocessing';
import { isRoomSpace, LAYOUTS, SPACE } from '@nexuspark/shared';
import { useWorld, useSettings } from '../state/stores';
import { hot } from '../state/hot';
import SkySystem from './env/SkySystem';
import { sampleEnv, currentTod, createEnvSample } from './env/daynight';
import LocalPlayer from './LocalPlayer';
import RemotePlayers from './RemotePlayers';
import City from './city/City';
import { CityAnomalies } from './city/anomalies';
import { ENV, ACCENT } from './city/palette';
import Interior from './spaces/Interior';
import PersonalRoom from './spaces/PersonalRoom';
import { music } from '../audio/music';

/** Drives remote interpolation + music state once per frame, before renders. */
function Drivers() {
  const musicState = useWorld((s) => s.music);
  const spaceKey = useWorld((s) => s.spaceKey);
  useFrame(() => {
    hot.interpolate(Date.now());
    // jukebox: distance-based gain from the jukebox/speaker position
    if (musicState?.trackId) {
      music.play(musicState.trackId, musicState.startedAt);
      let src: [number, number] | null = null;
      if (isRoomSpace(spaceKey)) {
        src = [0, 0];
      } else {
        const layout = LAYOUTS[spaceKey];
        const jb = layout?.interactables.find((i) => i.kind === 'jukebox');
        if (jb) src = [jb.pos[0], jb.pos[2]];
      }
      if (src) {
        const d = Math.hypot(hot.local.x - src[0], hot.local.z - src[1]);
        music.setDistanceGain(Math.max(0, Math.min(1, 1 - (d - 3) / 16)));
      }
    } else {
      music.stop();
    }
  }, -50);
  return null;
}

/**
 * 玩家轮廓光(§3.3):0.35 强度冷青 rim,方向与主光相对、跟随玩家,
 * 让团子从大暗部里"浮"出来。仅户外挂载(室内有自己的灯)。
 */
function PlayerRimLight() {
  const env = useWorld((s) => s.env);
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const sample = useMemo(createEnvSample, []);
  useFrame(() => {
    const l = lightRef.current;
    if (!l) return;
    const s = sampleEnv(currentTod(env), env.weather, sample);
    // 与主光相对的方位,略微抬高 —— 逆光勾边
    l.position.set(hot.local.x - s.sunDir.x * 22, hot.local.y + 10, hot.local.z - s.sunDir.z * 22);
    target.position.set(hot.local.x, hot.local.y + 0.5, hot.local.z);
    target.updateMatrixWorld();
  });
  return (
    <>
      <directionalLight ref={lightRef} color={ACCENT.konbiniSign} intensity={0.35} target={target} />
      <primitive object={target} />
    </>
  );
}

function SpaceRenderer({ spaceKey }: { spaceKey: string }) {
  if (isRoomSpace(spaceKey)) return <PersonalRoom />;
  switch (spaceKey) {
    case SPACE.PLAZA: return <City />;
    case SPACE.CAFE:
    case SPACE.CINEMA:
    case SPACE.ARCADE:
    case SPACE.SHOP:
    case SPACE.LOBBY:
    case SPACE.NETCAFE:
    case SPACE.GAMEROOM:
      return <Interior spaceKey={spaceKey} />;
    default:
      return null;
  }
}

/** 后期栈(§7):SMAA → Bloom(0.82/0.28)→ 去饱和分级 → 暗角 0.4 → 颗粒 → 色差。 */
function PostFX() {
  const quality = useSettings((s) => s.quality);
  const grain = useSettings((s) => s.grain);
  const caOffset = useMemo(() => new THREE.Vector2(0.0008, 0.0008), []);
  const highTier = quality === 'high' || quality === 'ultra';
  const children = [
    <SMAA key="smaa" />,
    // 只让招牌/灯芯起光晕,禁止大范围糊屏(§7)
    <Bloom key="bloom" intensity={0.28} luminanceThreshold={0.82} luminanceSmoothing={0.18} mipmapBlur />,
    // 整体去饱和 -8%(强调色靠自发光/Bloom 拉回存在感)
    <HueSaturation key="grade" saturation={-0.08} />,
    <Vignette key="vig" eskil={false} offset={0.28} darkness={0.4} />,
  ];
  // 胶片颗粒 0.035(settings.grain 开关,§10 Medium 档起默认关)
  if (grain) children.push(<Noise key="noise" premultiply opacity={0.035} />);
  // 色差 0.0008 极轻,高档才开(§7/§10)
  if (highTier) children.push(<ChromaticAberration key="ca" offset={caOffset} />);
  return <EffectComposer multisampling={0}>{children}</EffectComposer>;
}

export default function Scene() {
  const spaceKey = useWorld((s) => s.spaceKey);
  const postfx = useSettings((s) => s.postfx);
  const indoor = useMemo(() => spaceKey !== SPACE.PLAZA, [spaceKey]);

  if (!spaceKey) return null;
  return (
    <>
      <Drivers />
      <SkySystem indoor={indoor} />
      <Suspense fallback={null}>
        <SpaceRenderer spaceKey={spaceKey} />
      </Suspense>
      {!indoor && (
        <>
          {/* 极弱冷环境 fill(§3:夜间下限保险,暗部不发黑死;室内不挂) */}
          <ambientLight color={ENV.fogNear} intensity={0.14} />
          <PlayerRimLight />
          {/* 超自然异常(§6,四项;City.tsx 归 P3,故在此挂) */}
          <CityAnomalies />
        </>
      )}
      <LocalPlayer />
      <RemotePlayers />
      {postfx && <PostFX />}
    </>
  );
}
