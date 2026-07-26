import { Suspense, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import { isRoomSpace, LAYOUTS, SPACE } from '@nexuspark/shared';
import { useWorld, useSettings } from '../state/stores';
import { hot } from '../state/hot';
import SkySystem from './env/SkySystem';
import LocalPlayer from './LocalPlayer';
import RemotePlayers from './RemotePlayers';
import Plaza from './spaces/Plaza';
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

function SpaceRenderer({ spaceKey }: { spaceKey: string }) {
  if (isRoomSpace(spaceKey)) return <PersonalRoom />;
  switch (spaceKey) {
    case SPACE.PLAZA: return <Plaza />;
    case SPACE.CAFE:
    case SPACE.CINEMA:
    case SPACE.ARCADE:
    case SPACE.SHOP:
    case SPACE.LOBBY:
      return <Interior spaceKey={spaceKey} />;
    default:
      return null;
  }
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
      <LocalPlayer />
      <RemotePlayers />
      {postfx && (
        <EffectComposer multisampling={0}>
          <SMAA />
          <Bloom intensity={0.55} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette eskil={false} offset={0.18} darkness={0.72} />
        </EffectComposer>
      )}
    </>
  );
}
