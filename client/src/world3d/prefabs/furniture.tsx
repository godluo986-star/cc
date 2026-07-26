/** Furniture prefabs for every catalog type. Each takes a tint color and an
 *  optional per-object state (lamps on/off etc.). Real modeled geometry. */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import { useSettings } from '../../state/stores';

export interface FurnProps {
  color: string;
  state?: Record<string, unknown>;
  /** Light preset context for lamps in party mode etc. */
  accent?: string;
}

const useTint = (color: string, rough = 0.8, metal = 0) =>
  useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), [color, rough, metal]);
const DARK = '#2b2f36';
const isOn = (state?: Record<string, unknown>) => (state?.on ?? true) as boolean;

/* ─── Seating ────────────────────────────────────────────────────────────── */
export function Sofa({ color }: FurnProps) {
  const fabric = useTint(color, 0.9);
  const base = useTint('#3a3f47', 0.7);
  return (
    <group>
      <mesh position={[0, 0.28, 0.05]} castShadow material={fabric}><boxGeometry args={[1.9, 0.3, 0.85]} /></mesh>
      <mesh position={[0, 0.55, -0.32]} rotation={[-0.16, 0, 0]} castShadow material={fabric}><boxGeometry args={[1.9, 0.6, 0.22]} /></mesh>
      {[-0.87, 0.87].map((x, i) => (
        <mesh key={i} position={[x, 0.5, 0.05]} castShadow material={fabric}><boxGeometry args={[0.18, 0.42, 0.8]} /></mesh>
      ))}
      {[-0.45, 0.45].map((x, i) => (
        <mesh key={i} position={[x, 0.47, 0.1]} rotation={[0.1, 0, 0]} castShadow material={fabric}><boxGeometry args={[0.8, 0.12, 0.7]} /></mesh>
      ))}
      <mesh position={[0, 0.09, 0]} material={base}><boxGeometry args={[1.85, 0.14, 0.8]} /></mesh>
    </group>
  );
}
export function SofaLux({ color }: FurnProps) {
  const velvet = useTint(color, 0.55);
  const gold = useTint('#c9a227', 0.3, 0.8);
  return (
    <group>
      <Sofa color={color} />
      <mesh position={[0, 0.12, 0.48]} material={gold}><boxGeometry args={[2.0, 0.04, 0.04]} /></mesh>
      {[-0.95, 0.95].map((x, i) => (
        <mesh key={i} position={[x, 0.75, -0.35]} castShadow material={velvet}><sphereGeometry args={[0.09, 10, 8]} /></mesh>
      ))}
    </group>
  );
}
export function Armchair({ color }: FurnProps) {
  const fabric = useTint(color, 0.9);
  return (
    <group>
      <mesh position={[0, 0.28, 0.05]} castShadow material={fabric}><boxGeometry args={[0.9, 0.3, 0.8]} /></mesh>
      <mesh position={[0, 0.55, -0.3]} rotation={[-0.14, 0, 0]} castShadow material={fabric}><boxGeometry args={[0.9, 0.6, 0.2]} /></mesh>
      {[-0.42, 0.42].map((x, i) => (
        <mesh key={i} position={[x, 0.48, 0.05]} castShadow material={fabric}><boxGeometry args={[0.16, 0.4, 0.75]} /></mesh>
      ))}
      <mesh position={[0, 0.45, 0.1]} rotation={[0.1, 0, 0]} castShadow material={fabric}><boxGeometry args={[0.68, 0.12, 0.65]} /></mesh>
    </group>
  );
}
export function Chair({ color }: FurnProps) {
  const wood = useTint(color, 0.75);
  return (
    <group>
      <mesh position={[0, 0.45, 0]} castShadow material={wood}><boxGeometry args={[0.44, 0.04, 0.44]} /></mesh>
      <mesh position={[0, 0.78, -0.2]} rotation={[-0.1, 0, 0]} castShadow material={wood}><boxGeometry args={[0.44, 0.62, 0.04]} /></mesh>
      {[[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.22, z]} material={wood}><cylinderGeometry args={[0.022, 0.028, 0.44, 6]} /></mesh>
      ))}
    </group>
  );
}
export function Stool({ color }: FurnProps) {
  const wood = useTint(color, 0.75);
  return (
    <group>
      <mesh position={[0, 0.6, 0]} castShadow material={wood}><cylinderGeometry args={[0.2, 0.2, 0.05, 12]} /></mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.13, 0.3, Math.sin(a) * 0.13]} rotation={[Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16]} material={wood}>
            <cylinderGeometry args={[0.02, 0.026, 0.6, 6]} />
          </mesh>
        );
      })}
    </group>
  );
}
export function Bed({ color }: FurnProps) {
  const blanket = useTint(color, 0.9);
  const frame = useTint('#6e5136', 0.8);
  const sheet = useTint('#f2efe8', 0.95);
  return (
    <group>
      <mesh position={[0, 0.25, 0]} castShadow material={frame}><boxGeometry args={[1.55, 0.22, 2.1]} /></mesh>
      <mesh position={[0, 0.42, 0.1]} castShadow material={sheet}><boxGeometry args={[1.45, 0.16, 1.85]} /></mesh>
      <mesh position={[0, 0.47, 0.35]} castShadow material={blanket}><boxGeometry args={[1.47, 0.1, 1.25]} /></mesh>
      <mesh position={[0, 0.68, -0.98]} castShadow material={frame}><boxGeometry args={[1.55, 0.7, 0.08]} /></mesh>
      {[-0.4, 0.4].map((x, i) => (
        <mesh key={i} position={[x, 0.53, -0.75]} rotation={[0.25, 0, 0]} castShadow material={sheet}><boxGeometry args={[0.5, 0.12, 0.32]} /></mesh>
      ))}
    </group>
  );
}

/* ─── Tables ─────────────────────────────────────────────────────────────── */
export function Table({ color }: FurnProps) {
  const wood = useTint(color, 0.7);
  return (
    <group>
      <mesh position={[0, 0.73, 0]} castShadow material={wood}><boxGeometry args={[1.4, 0.05, 0.8]} /></mesh>
      {[[-0.62, -0.32], [0.62, -0.32], [-0.62, 0.32], [0.62, 0.32]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.36, z]} material={wood}><boxGeometry args={[0.06, 0.72, 0.06]} /></mesh>
      ))}
    </group>
  );
}
export function CoffeeTable({ color }: FurnProps) {
  const wood = useTint(color, 0.65);
  return (
    <group>
      <mesh position={[0, 0.4, 0]} castShadow material={wood}><boxGeometry args={[1.0, 0.045, 0.55]} /></mesh>
      <mesh position={[0, 0.18, 0]} material={wood}><boxGeometry args={[0.85, 0.035, 0.42]} /></mesh>
      {[[-0.44, -0.22], [0.44, -0.22], [-0.44, 0.22], [0.44, 0.22]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.2, z]} material={wood}><boxGeometry args={[0.05, 0.4, 0.05]} /></mesh>
      ))}
    </group>
  );
}
export function Desk({ color }: FurnProps) {
  const top = useTint(color, 0.6);
  const leg = useTint(DARK, 0.5, 0.4);
  return (
    <group>
      <mesh position={[0, 0.74, 0]} castShadow material={top}><boxGeometry args={[1.4, 0.05, 0.65]} /></mesh>
      {[-0.64, 0.64].map((x, i) => (
        <mesh key={i} position={[x, 0.37, 0]} material={leg}><boxGeometry args={[0.05, 0.74, 0.6]} /></mesh>
      ))}
      <mesh position={[0.42, 0.55, 0]} castShadow material={top}><boxGeometry args={[0.5, 0.32, 0.58]} /></mesh>
      {[0.47, 0.63].map((y, i) => (
        <mesh key={i} position={[0.42, y, 0.295]} material={leg}><boxGeometry args={[0.4, 0.02, 0.015]} /></mesh>
      ))}
    </group>
  );
}

/* ─── Lights ─────────────────────────────────────────────────────────────── */
export function FloorLamp({ color, state }: FurnProps) {
  const on = isOn(state);
  const shade = useMemo(() => new THREE.MeshStandardMaterial({
    color, roughness: 0.7, emissive: color, emissiveIntensity: on ? 0.85 : 0,
    side: THREE.DoubleSide,
  }), [color, on]);
  const pole = useTint('#3a3f47', 0.5, 0.5);
  return (
    <group>
      <mesh position={[0, 0.03, 0]} material={pole}><cylinderGeometry args={[0.14, 0.16, 0.05, 12]} /></mesh>
      <mesh position={[0, 0.75, 0]} material={pole}><cylinderGeometry args={[0.02, 0.02, 1.45, 8]} /></mesh>
      <mesh position={[0, 1.55, 0]} castShadow material={shade}><cylinderGeometry args={[0.16, 0.24, 0.32, 14, 1, true]} /></mesh>
      {on && <pointLight position={[0, 1.5, 0]} color={color} intensity={5.5} distance={6.5} decay={1.9} />}
    </group>
  );
}
export function TableLamp({ color, state }: FurnProps) {
  const on = isOn(state);
  const shade = useMemo(() => new THREE.MeshStandardMaterial({
    color, roughness: 0.7, emissive: color, emissiveIntensity: on ? 0.9 : 0, side: THREE.DoubleSide,
  }), [color, on]);
  const base = useTint('#4a4038', 0.6);
  return (
    <group>
      <mesh position={[0, 0.03, 0]} material={base}><cylinderGeometry args={[0.09, 0.11, 0.05, 10]} /></mesh>
      <mesh position={[0, 0.16, 0]} material={base}><cylinderGeometry args={[0.015, 0.015, 0.24, 6]} /></mesh>
      <mesh position={[0, 0.33, 0]} castShadow material={shade}><cylinderGeometry args={[0.09, 0.14, 0.18, 12, 1, true]} /></mesh>
      {on && <pointLight position={[0, 0.34, 0]} color={color} intensity={2.2} distance={4} decay={1.9} />}
    </group>
  );
}
export function NeonSign({ color, state }: FurnProps) {
  const on = isOn(state);
  const neon = useMemo(() => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: on ? 2.2 : 0.1, roughness: 0.4,
  }), [color, on]);
  return (
    <group position={[0, 1.6, 0]}>
      <mesh material={neon}><torusGeometry args={[0.28, 0.02, 8, 24, Math.PI * 1.6]} /></mesh>
      <mesh material={neon} position={[0.34, -0.05, 0]} rotation={[0, 0, -0.6]}><boxGeometry args={[0.02, 0.35, 0.02]} /></mesh>
      <mesh material={neon} position={[-0.4, 0.1, 0]}><boxGeometry args={[0.24, 0.02, 0.02]} /></mesh>
      {on && <pointLight color={color} intensity={2.4} distance={4.5} decay={2} />}
    </group>
  );
}
export function PartyLight({ color, state }: FurnProps) {
  const on = isOn(state);
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current && on) ref.current.rotation.y = clock.elapsedTime * 2.2;
  });
  const body = useTint('#2b2b31', 0.4, 0.6);
  return (
    <group>
      <mesh position={[0, 0.5, 0]} material={body}><cylinderGeometry args={[0.05, 0.09, 1.0, 8]} /></mesh>
      <mesh position={[0, 1.05, 0]} castShadow material={body}><sphereGeometry args={[0.12, 12, 10]} /></mesh>
      <group ref={ref} position={[0, 1.05, 0]}>
        {on && [0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2;
          const cols = [color, '#38d9c3', '#ffd166'];
          return (
            <spotLight
              key={i}
              color={cols[i]}
              intensity={14}
              angle={0.32}
              penumbra={0.5}
              distance={9}
              position={[0, 0, 0]}
              target-position={[Math.cos(a) * 4, -1.2, Math.sin(a) * 4]}
            />
          );
        })}
        {on && <pointLight color={color} intensity={1.6} distance={3} />}
      </group>
    </group>
  );
}
export function Fireplace({ color, state }: FurnProps) {
  const on = isOn(state);
  const brick = useTint(color, 0.9);
  const inner = useTint('#1a1512', 0.95);
  const flameRef = useRef<THREE.PointLight>(null);
  const fireMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ff8c3a', emissive: '#ff6a1a', emissiveIntensity: on ? 1.8 : 0, transparent: true, opacity: on ? 0.92 : 0,
  }), [on]);
  useFrame(({ clock }) => {
    if (flameRef.current && on) {
      flameRef.current.intensity = 5.5 + Math.sin(clock.elapsedTime * 9) * 1.1 + Math.sin(clock.elapsedTime * 23) * 0.7;
    }
  });
  return (
    <group>
      <mesh position={[0, 0.55, 0]} castShadow material={brick}><boxGeometry args={[1.4, 1.1, 0.45]} /></mesh>
      <mesh position={[0, 1.14, 0]} castShadow material={brick}><boxGeometry args={[1.55, 0.1, 0.55]} /></mesh>
      <mesh position={[0, 0.42, 0.05]} material={inner}><boxGeometry args={[0.8, 0.62, 0.4]} /></mesh>
      {/* logs */}
      <mesh position={[-0.1, 0.18, 0.12]} rotation={[0, 0.4, 0]} material={useTint('#5e4632', 0.9)}>
        <cylinderGeometry args={[0.05, 0.05, 0.5, 7]} />
      </mesh>
      <mesh position={[0.1, 0.18, 0.1]} rotation={[0, -0.5, 0]} material={useTint('#5e4632', 0.9)}>
        <cylinderGeometry args={[0.05, 0.05, 0.5, 7]} />
      </mesh>
      {/* stylized flames */}
      {on && (
        <group position={[0, 0.32, 0.1]}>
          <mesh material={fireMat}><coneGeometry args={[0.14, 0.34, 7]} /></mesh>
          <mesh material={fireMat} position={[0.12, -0.04, 0.02]} scale={0.65}><coneGeometry args={[0.14, 0.3, 7]} /></mesh>
          <mesh material={fireMat} position={[-0.12, -0.05, 0.02]} scale={0.55}><coneGeometry args={[0.14, 0.3, 7]} /></mesh>
        </group>
      )}
      {on && <pointLight ref={flameRef} position={[0, 0.5, 0.4]} color="#ff9a4a" intensity={5.5} distance={6} decay={2} />}
    </group>
  );
}

/* ─── Tech ───────────────────────────────────────────────────────────────── */
export function TvFrame({ color, big = false, children }: FurnProps & { big?: boolean; children?: React.ReactNode }) {
  const body = useTint(color, 0.4, 0.3);
  const w = big ? 2.0 : 1.35;
  const h = big ? 1.15 : 0.78;
  return (
    <group>
      <mesh position={[0, 0.25, 0]} material={body}><boxGeometry args={[0.5, 0.06, 0.28]} /></mesh>
      <mesh position={[0, 0.45, 0]} material={body}><boxGeometry args={[0.08, 0.4, 0.06]} /></mesh>
      <group position={[0, 0.55 + h / 2, 0]}>
        <mesh castShadow material={body}><boxGeometry args={[w + 0.06, h + 0.06, 0.07]} /></mesh>
        {/* screen surface: children = live media plane, else dark idle screen */}
        {children ?? (
          <mesh position={[0, 0, 0.04]}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial color="#0c0f14" roughness={0.25} metalness={0.4} emissive="#101820" emissiveIntensity={0.25} />
          </mesh>
        )}
      </group>
    </group>
  );
}
export function Computer({ color, state }: FurnProps) {
  const body = useTint(color, 0.5, 0.3);
  const notes = typeof state?.notesPreview === 'string' ? (state.notesPreview as string) : '';
  const screenTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0d1522';
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#38d9c3';
    ctx.font = '600 13px monospace';
    ctx.fillText('nexus-os — notes', 10, 20);
    ctx.strokeStyle = '#233246';
    ctx.strokeRect(6, 8, 244, 144);
    ctx.fillStyle = '#9fd8cf';
    ctx.font = '11px monospace';
    const lines = (notes || 'The owner can leave notes here…').split('\n').slice(0, 8);
    lines.forEach((l, i) => ctx.fillText(l.slice(0, 34), 10, 40 + i * 14));
    const t = new THREE.CanvasTexture(c);
    return t;
  }, [notes]);
  return (
    <group>
      <mesh position={[0, 0.02, 0.08]} material={body}><boxGeometry args={[0.42, 0.02, 0.16]} /></mesh>
      <mesh position={[0, 0.03, 0.28]} material={body}><boxGeometry args={[0.16, 0.02, 0.1]} /></mesh>
      <mesh position={[0, 0.1, -0.06]} material={body}><boxGeometry args={[0.06, 0.16, 0.05]} /></mesh>
      <group position={[0, 0.3, -0.06]}>
        <mesh castShadow material={body}><boxGeometry args={[0.62, 0.4, 0.04]} /></mesh>
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[0.56, 0.34]} />
          <meshStandardMaterial map={screenTex} emissive="#ffffff" emissiveMap={screenTex} emissiveIntensity={0.7} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}
export function Speaker({ color }: FurnProps) {
  const body = useTint(color, 0.6);
  const cone = useTint('#15181d', 0.8);
  return (
    <group>
      <mesh position={[0, 0.45, 0]} castShadow material={body}><boxGeometry args={[0.34, 0.9, 0.3]} /></mesh>
      <mesh position={[0, 0.62, 0.16]} rotation={[Math.PI / 2, 0, 0]} material={cone}><cylinderGeometry args={[0.1, 0.1, 0.02, 14]} /></mesh>
      <mesh position={[0, 0.28, 0.16]} rotation={[Math.PI / 2, 0, 0]} material={cone}><cylinderGeometry args={[0.06, 0.06, 0.02, 12]} /></mesh>
    </group>
  );
}

/* ─── Storage / decor ────────────────────────────────────────────────────── */
export function Bookshelf({ color }: FurnProps) {
  const wood = useTint(color, 0.75);
  const bookColors = ['#7d3b5e', '#2e5f80', '#3f7d44', '#c9a227', '#a04030', '#5a5a8a'];
  const books = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    shelf: Math.floor(i / 6), slot: i % 6, c: bookColors[(i * 7) % 6], h: 0.2 + ((i * 3) % 3) * 0.03,
  })), []);
  return (
    <group>
      <mesh position={[0, 0.9, 0]} castShadow material={wood}><boxGeometry args={[1.1, 1.8, 0.06]} /></mesh>
      {[-0.53, 0.53].map((x, i) => (
        <mesh key={i} position={[x, 0.9, 0.12]} material={wood}><boxGeometry args={[0.04, 1.8, 0.36]} /></mesh>
      ))}
      {[0.32, 0.88, 1.44, 1.76].map((y, i) => (
        <mesh key={i} position={[0, y, 0.12]} material={wood}><boxGeometry args={[1.1, 0.04, 0.36]} /></mesh>
      ))}
      {books.map((b, i) => (
        <mesh key={i} position={[-0.42 + b.slot * 0.17, 0.34 + b.shelf * 0.56 + b.h / 2 + 0.02, 0.12]} castShadow>
          <boxGeometry args={[0.12, b.h, 0.2]} />
          <meshStandardMaterial color={b.c} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}
export function Wardrobe({ color }: FurnProps) {
  const wood = useTint(color, 0.75);
  const dark = useTint('#4a3a28', 0.7);
  return (
    <group>
      <mesh position={[0, 0.95, 0]} castShadow material={wood}><boxGeometry args={[1.2, 1.9, 0.55]} /></mesh>
      <mesh position={[0, 0.95, 0.281]} material={dark}><boxGeometry args={[0.02, 1.8, 0.01]} /></mesh>
      {[-0.28, 0.28].map((x, i) => (
        <mesh key={i} position={[x * 0.3, 0.95, 0.29]} material={dark}><sphereGeometry args={[0.03, 8, 6]} /></mesh>
      ))}
      <mesh position={[0, 1.92, 0]} material={wood}><boxGeometry args={[1.26, 0.06, 0.6]} /></mesh>
    </group>
  );
}
export function Plant({ color }: FurnProps) {
  const leaf = useTint(color, 0.85);
  const pot = useTint('#a05238', 0.85);
  return (
    <group>
      <mesh position={[0, 0.15, 0]} castShadow material={pot}><cylinderGeometry args={[0.16, 0.12, 0.3, 10]} /></mesh>
      <mesh position={[0, 0.32, 0]} material={useTint('#3d2f22', 1)}><cylinderGeometry args={[0.14, 0.14, 0.04, 10]} /></mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.08, 0.62, Math.sin(a) * 0.08]} rotation={[Math.cos(a) * 0.55, 0, Math.sin(a) * -0.55]} castShadow material={leaf}>
            <coneGeometry args={[0.07, 0.55, 5]} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.75, 0]} castShadow material={leaf}><sphereGeometry args={[0.14, 8, 6]} /></mesh>
    </group>
  );
}
export function Rug({ color }: FurnProps) {
  const mat = useTint(color, 0.98);
  const border = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), roughness: 0.98 }), [color]);
  return (
    <group>
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={border}>
        <planeGeometry args={[2.3, 1.6]} />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mat}>
        <planeGeometry args={[2.05, 1.35]} />
      </mesh>
    </group>
  );
}
export function Mirror({ color }: FurnProps) {
  const frame = useTint(color, 0.5, 0.3);
  const reflections = useSettings((s) => s.reflections);
  return (
    <group position={[0, 1.5, 0]}>
      <mesh castShadow material={frame}><boxGeometry args={[1.0, 1.5, 0.05]} /></mesh>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[0.88, 1.38]} />
        {reflections ? (
          <MeshReflectorMaterial mirror={0.92} resolution={512} blur={[80, 30]} mixBlur={0.25} mixStrength={1.4} color="#c8ccd4" metalness={0.5} roughness={0.08} />
        ) : (
          <meshStandardMaterial color="#9aa5b5" roughness={0.08} metalness={0.9} />
        )}
      </mesh>
    </group>
  );
}
export function MirrorStanding({ color = '#c8ccd4' }: Partial<FurnProps>) {
  return (
    <group rotation={[0, 0, -0.04]}>
      <group position={[0, 0.15, 0]}>
        <Mirror color={color ?? '#c8ccd4'} />
      </group>
      <mesh position={[0, 0.06, 0.12]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.5, 0.04, 0.4]} />
        <meshStandardMaterial color="#4a4038" roughness={0.7} />
      </mesh>
    </group>
  );
}
export function Aquarium({ color }: FurnProps) {
  const glassMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#7fc4e8', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
  }), []);
  const waterMat = useMemo(() => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.4, roughness: 0.2 }), [color]);
  const stand = useTint('#3a3f47', 0.7);
  const fishRefs = useRef<THREE.Group[]>([]);
  const fishes = useMemo(() => [
    { c: '#ff8c3a', r: 0.42, speed: 0.9, y: 0.85, phase: 0 },
    { c: '#ffd166', r: 0.3, speed: 1.4, y: 0.95, phase: 2.1 },
    { c: '#5b8cff', r: 0.5, speed: 0.7, y: 0.78, phase: 4.2 },
  ], []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    fishes.forEach((f, i) => {
      const g = fishRefs.current[i];
      if (!g) return;
      const a = t * f.speed + f.phase;
      g.position.set(Math.cos(a) * f.r, f.y + Math.sin(t * 2 + f.phase) * 0.04, Math.sin(a) * f.r * 0.45);
      g.rotation.y = -a + Math.PI / 2;
    });
  });
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow material={stand}><boxGeometry args={[1.4, 0.6, 0.55]} /></mesh>
      <mesh position={[0, 0.9, 0]} material={waterMat}><boxGeometry args={[1.28, 0.52, 0.44]} /></mesh>
      <mesh position={[0, 0.92, 0]} material={glassMat}><boxGeometry args={[1.36, 0.62, 0.5]} /></mesh>
      {/* gravel + plant */}
      <mesh position={[0, 0.66, 0]} material={useTint('#c9b18a', 0.95)}><boxGeometry args={[1.26, 0.05, 0.42]} /></mesh>
      <mesh position={[-0.4, 0.8, 0]} material={useTint('#3f7d44', 0.8)}><coneGeometry args={[0.05, 0.25, 5]} /></mesh>
      <mesh position={[0.45, 0.78, 0.1]} material={useTint('#2f5f36', 0.8)}><coneGeometry args={[0.04, 0.2, 5]} /></mesh>
      {fishes.map((f, i) => (
        <group key={i} ref={(el) => { if (el) fishRefs.current[i] = el; }}>
          <mesh castShadow>
            <sphereGeometry args={[0.05, 8, 6]} />
            <meshStandardMaterial color={f.c} roughness={0.5} />
          </mesh>
          <mesh position={[-0.055, 0, 0]} rotation={[0, 0, 0.6]}>
            <coneGeometry args={[0.03, 0.06, 4]} />
            <meshStandardMaterial color={f.c} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <pointLight position={[0, 1.15, 0]} color="#7fc4e8" intensity={1.4} distance={2.5} />
    </group>
  );
}
export function Kitchen({ color }: FurnProps) {
  const counter = useTint(color, 0.5);
  const cabinet = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.75), roughness: 0.7 }), [color]);
  const steel = useTint('#9aa5ad', 0.25, 0.85);
  return (
    <group>
      <mesh position={[0, 0.45, 0]} castShadow material={cabinet}><boxGeometry args={[2.3, 0.9, 0.62]} /></mesh>
      <mesh position={[0, 0.92, 0]} castShadow material={counter}><boxGeometry args={[2.36, 0.05, 0.68]} /></mesh>
      <mesh position={[-0.7, 0.95, 0]} material={steel}><boxGeometry args={[0.5, 0.04, 0.4]} /></mesh>
      <mesh position={[-0.7, 1.06, -0.18]} material={steel}><cylinderGeometry args={[0.02, 0.02, 0.24, 8]} /></mesh>
      <mesh position={[-0.7, 1.18, -0.1]} rotation={[1.2, 0, 0]} material={steel}><cylinderGeometry args={[0.015, 0.015, 0.18, 8]} /></mesh>
      {/* stove */}
      <mesh position={[0.65, 0.95, 0]} material={useTint('#1c1f24', 0.4)}><boxGeometry args={[0.6, 0.03, 0.5]} /></mesh>
      {[[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]].map(([x, z], i) => (
        <mesh key={i} position={[0.65 + x, 0.97, z]} material={steel}><cylinderGeometry args={[0.07, 0.07, 0.01, 12]} /></mesh>
      ))}
      {/* upper cabinets */}
      <mesh position={[0, 1.9, -0.15]} castShadow material={cabinet}><boxGeometry args={[2.3, 0.6, 0.35]} /></mesh>
    </group>
  );
}
export function WhiteboardSmall({ color }: FurnProps) {
  // surface drawing handled by WhiteboardSurface overlay in the room renderer
  const frame = useTint('#9aa5ad', 0.4, 0.5);
  void color;
  return (
    <group position={[0, 1.45, 0]}>
      <mesh castShadow material={frame}><boxGeometry args={[1.5, 1.0, 0.05]} /></mesh>
    </group>
  );
}
