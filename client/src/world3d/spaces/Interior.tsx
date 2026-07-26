/** Generic interior renderer: shell (floor/walls/ceiling with door gaps),
 *  per-space lighting tied to switches, plus all layout props/interactables. */
import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial } from '@react-three/drei';
import { LAYOUTS } from '@nexuspark/shared';
import type { SpaceLayout } from '@nexuspark/shared';
import { useWorld, useSettings } from '../../state/stores';
import { renderProp, renderInteractable } from './registry';
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
    wallColor: '#2b2129', trimColor: '#1a141a', ceilingColor: '#171218', height: 5.2,
    floor: 'carpet', gaps: [{ side: 's', center: 0, width: 3 }],
    lights: [
      { x: -8, z: 0, color: '#c05555', intensity: 3.2 },
      { x: 8, z: 0, color: '#c05555', intensity: 3.2 },
      { x: 0, z: 7, color: '#ffb454', intensity: 4.5 },
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

export default function Interior({ spaceKey }: { spaceKey: string }) {
  const layout = LAYOUTS[spaceKey];
  const cfg = CONFIGS[spaceKey];
  const switches = useWorld((s) => s.switches);
  const reflections = useSettings((s) => s.reflections);
  const lightsOn = cfg.lightSwitchId ? (switches[cfg.lightSwitchId] ?? true) : true;
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
              emissiveIntensity={lightsOn ? 1.4 : 0.02}
              roughness={0.5}
            />
          </mesh>
          {lightsOn && (
            <pointLight position={[0, -0.5, 0]} color={l.color} intensity={l.intensity} distance={11} decay={1.8} />
          )}
        </group>
      ))}
      {!lightsOn && <pointLight position={[cx, 1.6, cz]} color="#3a4a6f" intensity={1.6} distance={16} />}

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

      {layout.props.map((p, i) => renderProp(p, i))}
      {layout.interactables.map((it) => renderInteractable(it, it.id))}
    </group>
  );
}
