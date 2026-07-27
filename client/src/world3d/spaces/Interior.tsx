/** Generic interior renderer: shell (floor/walls/ceiling with door gaps),
 *  per-space lighting tied to switches, plus all layout props/interactables. */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import { LAYOUTS } from '@nexuspark/shared';
import type { SpaceLayout } from '@nexuspark/shared';
import { useWorld, useSettings } from '../../state/stores';
import { renderProp, renderInteractable } from './registry';
import { NetcafeExtras, GameroomExtras } from '../prefabs/venueInteriors';
import { plankTexture, tileTexture, marbleTexture, carpetTexture, gridGlowTexture } from './textures';

interface Gap { side: 'n' | 's' | 'e' | 'w'; center: number; width: number; }
interface InteriorConfig {
  wallColor: string;
  trimColor: string;
  ceilingColor: string;
  height: number;
  floor: 'planks' | 'tiles' | 'marble' | 'carpet' | 'grid';
  gaps: Gap[];
  lightSwitchId?: string;
  lights: { x: number; z: number; color: string; intensity: number }[];
  windows?: { side: 'n' | 's' | 'e' | 'w'; center: number; w?: number }[];
  neon?: boolean;
}

const CONFIGS: Record<string, InteriorConfig> = {
  cafe: {
    wallColor: '#cfc0a8', trimColor: '#6e5136', ceilingColor: '#e8e0d0', height: 3.4,
    floor: 'planks', gaps: [{ side: 's', center: 0, width: 2.2 }],
    lightSwitchId: 'cafe-lights',
    lights: [
      { x: -4, z: -1, color: '#ffd9a0', intensity: 9 },
      { x: 4, z: -1, color: '#ffd9a0', intensity: 9 },
      { x: 0, z: 3, color: '#ffd9a0', intensity: 8 },
    ],
    windows: [{ side: 's', center: -4.5, w: 2 }, { side: 's', center: 4.5, w: 2 }, { side: 'w', center: 2.5, w: 2 }],
  },
  cinema: {
    // 巨幕厅:30×24×12,红色氛围壁灯沿两侧,后区暖光
    wallColor: '#2b2129', trimColor: '#1a141a', ceilingColor: '#171218', height: 12,
    floor: 'carpet', gaps: [{ side: 's', center: 0, width: 3.4 }],
    lights: [
      { x: -12, z: -4, color: '#c05555', intensity: 3.2 },
      { x: 12, z: -4, color: '#c05555', intensity: 3.2 },
      { x: -12, z: 4, color: '#c05555', intensity: 3.2 },
      { x: 12, z: 4, color: '#c05555', intensity: 3.2 },
      { x: 0, z: 10, color: '#ffb454', intensity: 5 },
      { x: 10.5, z: 9, color: '#ffb454', intensity: 4 },
    ],
  },
  arcade: {
    wallColor: '#1e2230', trimColor: '#12141e', ceilingColor: '#12141e', height: 3.6,
    floor: 'grid', gaps: [{ side: 'w', center: 0, width: 2.2 }],
    lightSwitchId: 'arcade-neon',
    lights: [
      { x: 0, z: 0, color: '#7a5fff', intensity: 7 },
      { x: -4, z: -3, color: '#ff5fd8', intensity: 5 },
      { x: 4, z: 3, color: '#40e8ff', intensity: 5 },
    ],
    neon: true,
  },
  shop: {
    wallColor: '#d8d2c4', trimColor: '#7c9082', ceilingColor: '#eae6dc', height: 3.4,
    floor: 'tiles', gaps: [{ side: 'e', center: 0, width: 2.2 }],
    lightSwitchId: 'shop-lights',
    lights: [
      { x: -3, z: -2, color: '#fff2dc', intensity: 9 },
      { x: 3, z: 2, color: '#fff2dc', intensity: 9 },
    ],
    windows: [{ side: 'e', center: -3.2, w: 2.2 }, { side: 'e', center: 3.2, w: 2.2 }],
  },
  lobby: {
    wallColor: '#c8c0b2', trimColor: '#8a6f52', ceilingColor: '#e8e2d6', height: 4.2,
    floor: 'marble', gaps: [{ side: 's', center: 0, width: 2.4 }],
    lightSwitchId: 'lobby-lights',
    lights: [
      { x: 0, z: 0, color: '#ffe8c0', intensity: 11 },
      { x: -5, z: 3, color: '#ffe8c0', intensity: 6 },
      { x: 5, z: -3, color: '#ffe8c0', intensity: 6 },
    ],
    windows: [{ side: 's', center: -4.5, w: 2.4 }, { side: 's', center: 4.5, w: 2.4 }],
  },
  // ── 网吧 NEXUS(P5,总纲 §4.4):深蓝灰墙 + 发光网格地板 + 蓝青灯,克制 ──
  netcafe: {
    wallColor: '#2a3040', trimColor: '#1b2030', ceilingColor: '#1e2434', height: 4.4,
    floor: 'grid', gaps: [{ side: 's', center: 0, width: 2.2 }],
    lightSwitchId: 'nc-lights',
    lights: [
      { x: 0, z: -3, color: '#7ea6d9', intensity: 7.5 },
      { x: 0, z: 1.2, color: '#7ea6d9', intensity: 7.5 },
      { x: 6, z: 4.4, color: '#e8a84c', intensity: 4 }, // 前台一盏暖灯(§1「近处永远有暖灯」)
    ],
    neon: false,
  },
  // ── 雀庄「东风阁」(P5,总纲 §4.4):暖木 + 木板地 + 暖橙灯笼光 ──────────
  gameroom: {
    wallColor: '#4a3b30', trimColor: '#2c231b', ceilingColor: '#332a22', height: 3.4,
    floor: 'planks', gaps: [{ side: 's', center: 0, width: 2.2 }],
    lightSwitchId: 'gr-lights',
    lights: [
      { x: -3.4, z: -1.6, color: '#ffc98a', intensity: 7 },
      { x: 3.4, z: -1.6, color: '#ffc98a', intensity: 7 },
      { x: 0, z: 3.6, color: '#ffc98a', intensity: 5 },
    ],
  },
};

function floorTex(kind: InteriorConfig['floor']) {
  switch (kind) {
    case 'planks': return plankTexture();
    case 'tiles': return tileTexture();
    case 'marble': return marbleTexture();
    case 'carpet': return carpetTexture();
    case 'grid': return gridGlowTexture();
  }
}

export function Walls({ layout, cfg }: { layout: SpaceLayout; cfg: InteriorConfig }) {
  const { bounds } = layout;
  const t = 0.25;
  const h = cfg.height;
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ color: cfg.wallColor, roughness: 0.9 }), [cfg.wallColor]);
  const trimMat = useMemo(() => new THREE.MeshStandardMaterial({ color: cfg.trimColor, roughness: 0.8 }), [cfg.trimColor]);

  const { regular, lintels } = useMemo(() => {
    const regular: { x: number; z: number; w: number; d: number }[] = [];
    const lintels: { x: number; z: number; w: number; d: number }[] = [];
    const addWall = (side: Gap['side']) => {
      const gaps = cfg.gaps.filter((g) => g.side === side).sort((a, b) => a.center - b.center);
      const horizontal = side === 'n' || side === 's';
      const lo = horizontal ? bounds.minX : bounds.minZ;
      const hi = horizontal ? bounds.maxX : bounds.maxZ;
      let cursor = lo;
      const pieces: [number, number][] = [];
      for (const g of gaps) {
        const gLo = g.center - g.width / 2;
        const gHi = g.center + g.width / 2;
        if (gLo > cursor) pieces.push([cursor, gLo]);
        cursor = Math.max(cursor, gHi);
      }
      if (cursor < hi) pieces.push([cursor, hi]);
      for (const [a, b] of pieces) {
        const len = b - a;
        const mid = (a + b) / 2;
        if (horizontal) {
          regular.push({ x: mid, z: side === 'n' ? bounds.minZ - t / 2 : bounds.maxZ + t / 2, w: len, d: t });
        } else {
          regular.push({ x: side === 'w' ? bounds.minX - t / 2 : bounds.maxX + t / 2, z: mid, w: t, d: len });
        }
      }
      for (const g of gaps) {
        if (horizontal) {
          lintels.push({ x: g.center, z: side === 'n' ? bounds.minZ - t / 2 : bounds.maxZ + t / 2, w: g.width, d: t });
        } else {
          lintels.push({ x: side === 'w' ? bounds.minX - t / 2 : bounds.maxX + t / 2, z: g.center, w: t, d: g.width });
        }
      }
    };
    (['n', 's', 'e', 'w'] as const).forEach(addWall);
    return { regular, lintels };
  }, [bounds, cfg.gaps]);

  return (
    <group>
      {regular.map((s, i) => (
        <group key={i}>
          <mesh position={[s.x, h / 2, s.z]} material={wallMat} castShadow receiveShadow>
            <boxGeometry args={[s.w, h, s.d]} />
          </mesh>
          <mesh position={[s.x, 0.09, s.z]} material={trimMat}>
            <boxGeometry args={[s.w + 0.02, 0.18, s.d + 0.04]} />
          </mesh>
        </group>
      ))}
      {lintels.map((s, i) => (
        <mesh key={`l${i}`} position={[s.x, h - (h - 2.6) / 2, s.z]} material={wallMat} castShadow>
          <boxGeometry args={[s.w, h - 2.6, s.d]} />
        </mesh>
      ))}
    </group>
  );
}

/** 放映时平滑变暗的顶灯(影院观影氛围;暂停/清屏时缓慢恢复)。 */
function DimmableCeilingLight({ color, intensity, dimTarget, reach }: { color: string; intensity: number; dimTarget: number; reach: number }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame((_, dt) => {
    const l = ref.current;
    if (!l) return;
    const target = intensity * dimTarget;
    l.intensity += (target - l.intensity) * Math.min(1, dt * 1.6); // ~0.6s 半衰,平滑不跳变
  });
  return <pointLight ref={ref} position={[0, -0.5, 0]} color={color} intensity={intensity} distance={reach} decay={1.7} />;
}

export default function Interior({ spaceKey }: { spaceKey: string }) {
  const layout = LAYOUTS[spaceKey];
  const cfg = CONFIGS[spaceKey];
  const switches = useWorld((s) => s.switches);
  const media = useWorld((s) => s.media);
  const reflections = useSettings((s) => s.reflections);
  const lightsOn = cfg.lightSwitchId ? (switches[cfg.lightSwitchId] ?? true) : true;
  // 影院:开播灯光压到 22%,暂停回到 55%,无片全亮(任务书 §二十二 影厅体验)
  const playingNow = !!media && (!!media.url || media.kind === 'share');
  const dimTarget = spaceKey === 'cinema'
    ? (playingNow ? (media!.playing || media!.kind === 'share' ? 0.28 : 0.55) : 1)
    : 1;
  const tex = useMemo(() => floorTex(cfg.floor), [cfg.floor]);
  const w = layout.bounds.maxX - layout.bounds.minX;
  const d = layout.bounds.maxZ - layout.bounds.minZ;
  const cx = (layout.bounds.maxX + layout.bounds.minX) / 2;
  const cz = (layout.bounds.maxZ + layout.bounds.minZ) / 2;

  return (
    <group>
      {/* floor */}
      {cfg.floor === 'marble' && reflections ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <MeshReflectorMaterial
            map={tex} mirror={0.35} resolution={512} blur={[240, 60]} mixBlur={0.8}
            mixStrength={0.7} roughness={0.5} depthScale={0.3} color="#cfcac0" metalness={0.1}
          />
        </mesh>
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial
            map={tex}
            roughness={cfg.floor === 'carpet' ? 0.95 : 0.6}
            emissive={cfg.floor === 'grid' && lightsOn ? '#2a3a8f' : '#000000'}
            emissiveIntensity={cfg.floor === 'grid' && lightsOn ? 0.5 : 0}
            emissiveMap={cfg.floor === 'grid' ? tex : undefined}
          />
        </mesh>
      )}
      {/* ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[cx, cfg.height, cz]}>
        <planeGeometry args={[w + 0.6, d + 0.6]} />
        <meshStandardMaterial color={cfg.ceilingColor} roughness={0.95} />
      </mesh>
      <Walls layout={layout} cfg={cfg} />

      {/* ceiling light fixtures */}
      {cfg.lights.map((l, i) => (
        <group key={i} position={[l.x, cfg.height - 0.02, l.z]}>
          <mesh position={[0, -0.06, 0]}>
            <cylinderGeometry args={[0.24, 0.3, 0.12, 12]} />
            <meshStandardMaterial
              color="#d8d4cc"
              emissive={l.color}
              emissiveIntensity={(lightsOn ? 1.4 : 0.02) * (dimTarget < 1 ? 0.35 : 1)}
              roughness={0.5}
            />
          </mesh>
          {lightsOn && (
            // 高顶棚(巨幕厅 12m)需要更强更远的灯才能照到地面
            <DimmableCeilingLight
              color={l.color}
              intensity={l.intensity * 1.8 * (cfg.height > 6 ? 2.6 : 1)}
              dimTarget={dimTarget}
              reach={Math.max(13, cfg.height * 2.4)}
            />
          )}
        </group>
      ))}
      {/* soft fill so interiors read clearly at any hour */}
      {lightsOn && <ambientLight intensity={0.35} color={cfg.neon ? '#8a90c8' : '#fff2e0'} />}
      {!lightsOn && <pointLight position={[cx, 1.6, cz]} color="#3a4a6f" intensity={2.2} distance={16} />}
      {!lightsOn && <ambientLight intensity={0.08} color="#33415f" />}

      {/* neon wall strips (arcade) */}
      {cfg.neon && (
        <group>
          {[[-6.9, 0, 0, Math.PI / 2] as const, [6.9, 0, 0, -Math.PI / 2] as const].map(([x, , z, ry], i) => (
            <mesh key={i} position={[x, 2.9, z]} rotation={[0, ry, 0]}>
              <boxGeometry args={[11.5, 0.06, 0.06]} />
              <meshStandardMaterial color="#ff5fd8" emissive="#ff5fd8" emissiveIntensity={lightsOn ? 2 : 0.1} />
            </mesh>
          ))}
          <mesh position={[0, 2.9, -5.9]}>
            <boxGeometry args={[13.5, 0.06, 0.06]} />
            <meshStandardMaterial color="#40e8ff" emissive="#40e8ff" emissiveIntensity={lightsOn ? 2 : 0.1} />
          </mesh>
        </group>
      )}

      {/* 场馆专属挂件(P5):网吧墙面灯带 / 雀庄障子窗 + 役种挂轴 */}
      {spaceKey === 'netcafe' && <NetcafeExtras lightsOn={lightsOn} />}
      {spaceKey === 'gameroom' && <GameroomExtras lightsOn={lightsOn} />}

      {layout.props.map((p, i) => renderProp(p, i))}
      {layout.interactables.map((it) => renderInteractable(it, it.id))}
    </group>
  );
}
