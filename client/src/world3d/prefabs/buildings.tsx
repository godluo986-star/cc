/** Plaza building exteriors: real walls, inset windows, doors, awnings and
 *  emissive signage that lights up at night. */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useWorld } from '../../state/stores';
import { currentTod, sampleEnv } from '../env/daynight';

function signTexture(text: string, color: string, bg = '#101318'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.font = '700 64px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68, 470);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function useNightGlow(mats: THREE.MeshStandardMaterial[], base = 1.6) {
  const env = useWorld((s) => s.env);
  useFrame(() => {
    const s = sampleEnv(currentTod(env), env.weather);
    const on = s.lampsOn;
    for (const m of mats) m.emissiveIntensity = on ? base : base * 0.25;
  });
}

/** Windows: dark glass inset with frame; glows warm at night. */
function WindowInset({ position, rotation = 0, w = 1.1, h = 1.3, lit = true }: {
  position: [number, number, number]; rotation?: number; w?: number; h?: number; lit?: boolean;
}) {
  const glassRef = useRef<THREE.MeshStandardMaterial>(null);
  const env = useWorld((s) => s.env);
  useFrame(() => {
    if (!glassRef.current) return;
    const s = sampleEnv(currentTod(env), env.weather);
    glassRef.current.emissiveIntensity = s.lampsOn && lit ? 0.9 : 0.02;
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow>
        <boxGeometry args={[w + 0.14, h + 0.14, 0.1]} />
        <meshStandardMaterial color="#3c4048" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[w, h, 0.08]} />
        <meshStandardMaterial ref={glassRef} color="#1c2733" roughness={0.15} metalness={0.6} emissive="#ffca7a" emissiveIntensity={0.02} />
      </mesh>
      <mesh position={[0, 0, 0.055]}>
        <boxGeometry args={[0.04, h, 0.015]} />
        <meshStandardMaterial color="#3c4048" />
      </mesh>
      <mesh position={[0, 0, 0.055]}>
        <boxGeometry args={[w, 0.04, 0.015]} />
        <meshStandardMaterial color="#3c4048" />
      </mesh>
    </group>
  );
}

/** Wall segments around a door opening on the +Z face. */
function ShellWithDoorway({ w, d, h, color, doorW = 1.7, doorH = 2.3 }: {
  w: number; d: number; h: number; color: string; doorW?: number; doorH?: number;
}) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }), [color]);
  const t = 0.3; // wall thickness
  const sideW = (w - doorW) / 2;
  return (
    <group>
      {/* back wall */}
      <mesh position={[0, h / 2, -d / 2 + t / 2]} castShadow receiveShadow material={mat}>
        <boxGeometry args={[w, h, t]} />
      </mesh>
      {/* side walls */}
      <mesh position={[-w / 2 + t / 2, h / 2, 0]} castShadow receiveShadow material={mat}>
        <boxGeometry args={[t, h, d]} />
      </mesh>
      <mesh position={[w / 2 - t / 2, h / 2, 0]} castShadow receiveShadow material={mat}>
        <boxGeometry args={[t, h, d]} />
      </mesh>
      {/* front wall pieces around the doorway */}
      <mesh position={[-(doorW / 2 + sideW / 2), h / 2, d / 2 - t / 2]} castShadow receiveShadow material={mat}>
        <boxGeometry args={[sideW, h, t]} />
      </mesh>
      <mesh position={[doorW / 2 + sideW / 2, h / 2, d / 2 - t / 2]} castShadow receiveShadow material={mat}>
        <boxGeometry args={[sideW, h, t]} />
      </mesh>
      <mesh position={[0, doorH + (h - doorH) / 2, d / 2 - t / 2]} castShadow receiveShadow material={mat}>
        <boxGeometry args={[doorW, h - doorH, t]} />
      </mesh>
      {/* roof slab */}
      <mesh position={[0, h + 0.12, 0]} castShadow material={mat}>
        <boxGeometry args={[w + 0.5, 0.24, d + 0.5]} />
      </mesh>
    </group>
  );
}

export function BldCafe({ position }: { position: [number, number, number] }) {
  const sign = useMemo(() => signTexture('☕ 研磨咖啡馆', '#ffc46b'), []);
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({ map: sign, emissive: '#ffffff', emissiveMap: sign, emissiveIntensity: 1.2 }), [sign]);
  useNightGlow([signMat], 1.4);
  const awning = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8f3b46', roughness: 0.8 }), []);
  return (
    <group position={position}>
      <ShellWithDoorway w={14} d={11} h={4.4} color="#a8836a" />
      {/* window band on plaza-facing wall */}
      {[-4.6, -2.6, 2.6, 4.6].map((x, i) => (
        <WindowInset key={i} position={[x, 1.7, 5.53]} w={1.4} h={1.5} />
      ))}
      {[-3.5, 0, 3.5].map((z, i) => (
        <WindowInset key={i} position={[-7.03, 1.7, z]} rotation={Math.PI / 2} w={1.4} h={1.5} />
      ))}
      {/* awning strips */}
      {[-3.6, 3.6].map((x, i) => (
        <mesh key={i} position={[x, 2.75, 5.85]} rotation={[0.5, 0, 0]} castShadow material={awning}>
          <boxGeometry args={[3.6, 0.06, 1.1]} />
        </mesh>
      ))}
      <mesh position={[0, 3.6, 5.7]}>
        <planeGeometry args={[5.4, 1.15]} />
        <primitive object={signMat} attach="material" />
      </mesh>
      {/* outdoor tables */}
      {[-5, 5].map((x, i) => (
        <group key={i} position={[x, 0, 7.3]}>
          <mesh position={[0, 0.72, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.5, 0.04, 14]} />
            <meshStandardMaterial color="#e8e4dc" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.36, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 0.72, 8]} />
            <meshStandardMaterial color="#3a4048" metalness={0.5} />
          </mesh>
          <mesh position={[0, 1.85, 0]} castShadow>
            <coneGeometry args={[1.35, 0.6, 8]} />
            <meshStandardMaterial color={i === 0 ? '#c05555' : '#5580c0'} roughness={0.75} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 1.1, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 1.6, 6]} />
            <meshStandardMaterial color="#3a4048" metalness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function BldCinema({ position }: { position: [number, number, number] }) {
  const sign = useMemo(() => signTexture('🎬 极光影院', '#7ec8ff'), []);
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({ map: sign, emissive: '#ffffff', emissiveMap: sign, emissiveIntensity: 1.6 }), [sign]);
  const bulbs = useMemo(() => new THREE.MeshStandardMaterial({ color: '#fff4d0', emissive: '#ffdf8a', emissiveIntensity: 1.6 }), []);
  useNightGlow([signMat, bulbs], 1.8);
  return (
    <group position={position}>
      <ShellWithDoorway w={18} d={13} h={6} color="#5d6470" doorW={2.6} doorH={2.6} />
      {/* marquee */}
      <mesh position={[0, 3.6, 7.0]} castShadow>
        <boxGeometry args={[9, 1.7, 0.9]} />
        <meshStandardMaterial color="#22262e" roughness={0.5} />
      </mesh>
      <mesh position={[0, 3.6, 7.5]}>
        <planeGeometry args={[8.2, 1.25]} />
        <primitive object={signMat} attach="material" />
      </mesh>
      {Array.from({ length: 12 }).map((_, i) => (
        <mesh key={i} position={[-4.1 + i * 0.75, 4.55, 7.42]} material={bulbs}>
          <sphereGeometry args={[0.07, 8, 6]} />
        </mesh>
      ))}
      {/* poster boxes */}
      {[-5.5, 5.5].map((x, i) => (
        <group key={i} position={[x, 1.7, 6.58]}>
          <mesh castShadow>
            <boxGeometry args={[1.7, 2.3, 0.12]} />
            <meshStandardMaterial color="#2b2f38" />
          </mesh>
          <mesh position={[0, 0, 0.07]}>
            <planeGeometry args={[1.45, 2.05]} />
            <meshStandardMaterial color={i === 0 ? '#7d3b5e' : '#2e5f80'} emissive={i === 0 ? '#7d3b5e' : '#2e5f80'} emissiveIntensity={0.35} roughness={0.6} />
          </mesh>
        </group>
      ))}
      {[-7.4, 7.4].map((x, i) => (
        <WindowInset key={i} position={[x, 4.6, 6.53]} w={1.6} h={1.0} lit={false} />
      ))}
    </group>
  );
}

export function BldArcade({ position }: { position: [number, number, number] }) {
  const sign = useMemo(() => signTexture('🕹 像素宫游戏厅', '#ff5fd8'), []);
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({ map: sign, emissive: '#ffffff', emissiveMap: sign, emissiveIntensity: 1.7 }), [sign]);
  const neon = useMemo(() => new THREE.MeshStandardMaterial({ color: '#40e8ff', emissive: '#40e8ff', emissiveIntensity: 1.6 }), []);
  useNightGlow([signMat, neon], 2);
  return (
    <group position={position} rotation={[0, -Math.PI / 2, 0]}>
      <ShellWithDoorway w={11} d={13} h={4.6} color="#454a58" doorW={1.9} />
      <mesh position={[0, 3.7, 6.85]}>
        <planeGeometry args={[6, 1.15]} />
        <primitive object={signMat} attach="material" />
      </mesh>
      {/* neon tubes */}
      <mesh position={[0, 2.9, 6.62]} material={neon}>
        <boxGeometry args={[8.5, 0.05, 0.05]} />
      </mesh>
      <mesh position={[0, 4.35, 6.62]} material={neon}>
        <boxGeometry args={[8.5, 0.05, 0.05]} />
      </mesh>
      {[-3.4, 3.4].map((x, i) => (
        <WindowInset key={i} position={[x, 1.8, 6.53]} w={1.8} h={1.4} lit={false} />
      ))}
    </group>
  );
}

export function BldShop({ position }: { position: [number, number, number] }) {
  const sign = useMemo(() => signTexture('🏪 团子百货', '#9dff8a'), []);
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({ map: sign, emissive: '#ffffff', emissiveMap: sign, emissiveIntensity: 1.3 }), [sign]);
  useNightGlow([signMat], 1.4);
  return (
    <group position={position} rotation={[0, Math.PI / 2, 0]}>
      <ShellWithDoorway w={11} d={13} h={4.2} color="#7c9082" doorW={1.9} />
      <mesh position={[0, 3.4, 6.85]}>
        <planeGeometry args={[5.6, 1.1]} />
        <primitive object={signMat} attach="material" />
      </mesh>
      {[-3.2, 3.2].map((x, i) => (
        <WindowInset key={i} position={[x, 1.65, 6.53]} w={2.2} h={1.7} />
      ))}
      <mesh position={[0, 2.6, 6.7]} rotation={[0.45, 0, 0]} castShadow>
        <boxGeometry args={[8.8, 0.05, 1.3]} />
        <meshStandardMaterial color="#3f6f4f" roughness={0.8} />
      </mesh>
    </group>
  );
}

export function BldTower({ position }: { position: [number, number, number] }) {
  const env = useWorld((s) => s.env);
  const glassMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#22303f', roughness: 0.2, metalness: 0.55, emissive: '#ffca7a', emissiveIntensity: 0.02,
  }), []);
  useFrame(() => {
    const s = sampleEnv(currentTod(env), env.weather);
    glassMat.emissiveIntensity = s.lampsOn ? 0.55 : 0.02;
  });
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8e94a3', roughness: 0.8 }), []);
  const floors = [1, 2, 3, 4, 5, 6];
  const sign = useMemo(() => signTexture('团子塔', '#cfe0ff', '#1a2233'), []);
  return (
    <group position={position}>
      <ShellWithDoorway w={16} d={12} h={4.2} color="#8e94a3" doorW={2.4} doorH={2.6} />
      {/* upper floors */}
      <mesh position={[0, 4.2 + 10.8, 0]} castShadow material={body}>
        <boxGeometry args={[15, 21.6, 11]} />
      </mesh>
      {floors.map((f) => (
        <group key={f}>
          {[-5.4, -2.7, 0, 2.7, 5.4].map((x, i) => (
            <mesh key={i} position={[x, 4.2 + f * 3.1, 5.53]} material={glassMat} castShadow>
              <boxGeometry args={[1.9, 1.6, 0.12]} />
            </mesh>
          ))}
          {[-3.4, 0, 3.4].map((z, i) => (
            <mesh key={`s${i}`} position={[7.53, 4.2 + f * 3.1, z]} material={glassMat} castShadow>
              <boxGeometry args={[0.12, 1.6, 1.9]} />
            </mesh>
          ))}
          {[-3.4, 0, 3.4].map((z, i) => (
            <mesh key={`w${i}`} position={[-7.53, 4.2 + f * 3.1, z]} material={glassMat} castShadow>
              <boxGeometry args={[0.12, 1.6, 1.9]} />
            </mesh>
          ))}
          {/* balconies on the front */}
          {f % 2 === 0 && (
            <mesh position={[0, 4.2 + f * 3.1 - 1.0, 5.9]} castShadow material={body}>
              <boxGeometry args={[7, 0.12, 0.8]} />
            </mesh>
          )}
        </group>
      ))}
      {/* entrance canopy + sign */}
      <mesh position={[0, 3.0, 6.7]} castShadow material={body}>
        <boxGeometry args={[4.6, 0.16, 2.4]} />
      </mesh>
      {[-2.1, 2.1].map((x, i) => (
        <mesh key={i} position={[x, 1.5, 7.7]} material={body}>
          <cylinderGeometry args={[0.07, 0.07, 3, 8]} />
        </mesh>
      ))}
      <mesh position={[0, 3.55, 6.6]}>
        <planeGeometry args={[3.9, 0.8]} />
        <meshStandardMaterial map={sign} emissive="#ffffff" emissiveMap={sign} emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[0, 26.4, 0]} material={body}>
        <boxGeometry args={[4, 1.2, 4]} />
      </mesh>
    </group>
  );
}
