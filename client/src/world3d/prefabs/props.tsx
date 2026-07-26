/**
 * Outdoor & public-space props. Everything is real modeled geometry composed
 * from primitives — no image textures standing in for shape.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useWorld, useSettings } from '../../state/stores';
import { currentTod, sampleEnv } from '../env/daynight';
import { MeshReflectorMaterial } from '@react-three/drei';
import { hot } from '../../state/hot';

export const M = {
  wood: '#8b6c4f', woodDark: '#5e4632', metal: '#6b7280', metalDark: '#3a4048',
  stone: '#9aa0a8', stoneDark: '#767c85', leaf: '#3f7d44', leafDark: '#2f5f36',
  trunk: '#6e5136',
};

/* ─── Street lamp (auto-on at night) ─────────────────────────────────────── */
export function StreetLamp({ position }: { position: [number, number, number] }) {
  const bulbRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const env = useWorld((s) => s.env);
  useFrame(() => {
    const s = sampleEnv(currentTod(env), env.weather);
    if (bulbRef.current) bulbRef.current.emissiveIntensity = s.lampsOn ? 2.4 : 0.0;
    if (lightRef.current) lightRef.current.intensity = s.lampsOn ? 14 : 0;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.24, 0.16, 10]} />
        <meshStandardMaterial color={M.metalDark} roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh position={[0, 1.9, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, 3.7, 8]} />
        <meshStandardMaterial color={M.metalDark} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, 3.8, 0]}>
        <cylinderGeometry args={[0.16, 0.05, 0.24, 8]} />
        <meshStandardMaterial color={M.metalDark} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, 3.68, 0]}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial ref={bulbRef} color="#fff2cc" emissive="#ffd98a" emissiveIntensity={0} roughness={0.3} />
      </mesh>
      <pointLight ref={lightRef} position={[0, 3.55, 0]} distance={13} decay={1.8} color="#ffd9a0" intensity={0} />
    </group>
  );
}

/* ─── Park bench ─────────────────────────────────────────────────────────── */
export function Bench({ position, rotation }: { position: [number, number, number]; rotation: number }) {
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a5c3f', roughness: 0.8 }), []);
  const iron = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2f333a', roughness: 0.5, metalness: 0.6 }), []);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-0.15, 0, 0.15].map((z, i) => (
        <mesh key={i} position={[0, 0.44, z * -1 + 0.05]} castShadow material={wood}>
          <boxGeometry args={[1.8, 0.045, 0.13]} />
        </mesh>
      ))}
      {[0.28, 0.45].map((y, i) => (
        <mesh key={i} position={[0, y + 0.28, -0.26]} rotation={[-0.22, 0, 0]} castShadow material={wood}>
          <boxGeometry args={[1.8, 0.05, 0.12]} />
        </mesh>
      ))}
      {[-0.78, 0.78].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0.22, 0.12]} material={iron} castShadow>
            <boxGeometry args={[0.06, 0.44, 0.08]} />
          </mesh>
          <mesh position={[0, 0.5, -0.2]} rotation={[-0.24, 0, 0]} material={iron} castShadow>
            <boxGeometry args={[0.06, 0.62, 0.08]} />
          </mesh>
          <mesh position={[0, 0.44, -0.03]} material={iron}>
            <boxGeometry args={[0.06, 0.05, 0.42]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ─── Trees (3 species) ──────────────────────────────────────────────────── */
export function Tree({ position, variant = 0, scale = 1 }: { position: [number, number, number]; variant?: number; scale?: number }) {
  const trunk = useMemo(() => new THREE.MeshStandardMaterial({ color: M.trunk, roughness: 0.9 }), []);
  const leafColor = variant === 2 ? '#4a8a3f' : variant === 1 ? '#37734a' : M.leaf;
  const leaf = useMemo(() => new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.85 }), [leafColor]);
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.1, 0]} castShadow material={trunk}>
        <cylinderGeometry args={[0.16, 0.24, 2.2, 8]} />
      </mesh>
      {variant === 0 && (
        <group>
          <mesh position={[0, 2.7, 0]} castShadow material={leaf}><sphereGeometry args={[1.15, 12, 9]} /></mesh>
          <mesh position={[0.7, 2.25, 0.25]} castShadow material={leaf}><sphereGeometry args={[0.72, 10, 8]} /></mesh>
          <mesh position={[-0.6, 2.4, -0.3]} castShadow material={leaf}><sphereGeometry args={[0.8, 10, 8]} /></mesh>
          <mesh position={[0.1, 3.4, -0.2]} castShadow material={leaf}><sphereGeometry args={[0.62, 10, 8]} /></mesh>
        </group>
      )}
      {variant === 1 && (
        <group>
          <mesh position={[0, 2.5, 0]} castShadow material={leaf}><coneGeometry args={[1.15, 1.7, 9]} /></mesh>
          <mesh position={[0, 3.35, 0]} castShadow material={leaf}><coneGeometry args={[0.85, 1.4, 9]} /></mesh>
          <mesh position={[0, 4.05, 0]} castShadow material={leaf}><coneGeometry args={[0.55, 1.1, 9]} /></mesh>
        </group>
      )}
      {variant === 2 && (
        <group>
          <mesh position={[0.5, 2.9, 0]} rotation={[0, 0, -0.5]} castShadow material={trunk}>
            <cylinderGeometry args={[0.08, 0.12, 1.1, 6]} />
          </mesh>
          <mesh position={[0, 3.1, 0]} castShadow material={leaf}><sphereGeometry args={[1.0, 11, 8]} /></mesh>
          <mesh position={[0.95, 3.35, 0.1]} castShadow material={leaf}><sphereGeometry args={[0.55, 9, 7]} /></mesh>
        </group>
      )}
    </group>
  );
}

/* ─── Fountain with animated water ───────────────────────────────────────── */
export function Fountain() {
  const waterRef = useRef<THREE.MeshStandardMaterial>(null);
  const sprayRef = useRef<THREE.Points>(null);
  const particles = useMemo(() => {
    const n = 130;
    const arr = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) seeds[i] = Math.random();
    return { arr, seeds, n };
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (waterRef.current) {
      waterRef.current.opacity = 0.82 + Math.sin(t * 2.2) * 0.05;
    }
    const pts = sprayRef.current;
    if (pts) {
      const pos = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < particles.n; i++) {
        const phase = ((t * 0.9 + particles.seeds[i]) % 1);
        const ang = particles.seeds[i] * Math.PI * 2;
        const r = 0.25 + phase * 1.1;
        pos.setXYZ(i, Math.cos(ang) * r, 2.35 + Math.sin(phase * Math.PI) * 1.15 - phase * 0.4, Math.sin(ang) * r);
      }
      pos.needsUpdate = true;
    }
  });
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ color: '#aab0b8', roughness: 0.75 }), []);
  return (
    <group>
      <mesh position={[0, 0.35, 0]} receiveShadow castShadow material={stone}>
        <cylinderGeometry args={[4.5, 4.7, 0.7, 28]} />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[4.15, 4.15, 0.06, 28]} />
        <meshStandardMaterial ref={waterRef} color="#3a7ca8" transparent opacity={0.85} roughness={0.15} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.9, 0]} castShadow material={stone}>
        <cylinderGeometry args={[0.55, 0.8, 1.3, 14]} />
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow material={stone}>
        <cylinderGeometry args={[1.5, 1.65, 0.28, 20]} />
      </mesh>
      <mesh position={[0, 1.78, 0]}>
        <cylinderGeometry args={[1.35, 1.35, 0.05, 20]} />
        <meshStandardMaterial color="#4a8cb8" transparent opacity={0.85} roughness={0.15} />
      </mesh>
      <mesh position={[0, 2.05, 0]} castShadow material={stone}>
        <cylinderGeometry args={[0.28, 0.42, 0.7, 12]} />
      </mesh>
      <points ref={sprayRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles.arr, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#cfe8ff" size={0.09} transparent opacity={0.8} depthWrite={false} />
      </points>
    </group>
  );
}

/* ─── Pond + bridge ──────────────────────────────────────────────────────── */
export function Pond({ position }: { position: [number, number, number] }) {
  const reflections = useSettings((s) => s.reflections);
  const water = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2e5f80', roughness: 0.18, metalness: 0.5, transparent: true, opacity: 0.92 }),
    []
  );
  const rocks = useMemo(() => {
    const arr: { x: number; z: number; s: number; rx: number; rz: number }[] = [];
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      const x = Math.cos(a) * 8.3;
      const z = Math.sin(a) * 4.05;
      // leave the bridge crossing open (bridge runs along Z at local x≈0)
      if (Math.abs(x) < 1.6) continue;
      arr.push({ x, z, s: 0.2 + ((i * 7) % 3) * 0.07, rx: (i * 1.3) % 3, rz: (i * 2.1) % 3 });
    }
    return arr;
  }, []);
  return (
    <group position={position}>
      <group position={[0, 0.02, 0]}>
        {reflections && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
            <planeGeometry args={[8.2, 5]} />
            <MeshReflectorMaterial
              blur={[260, 80]} resolution={512} mixBlur={0.9} mixStrength={0.55}
              roughness={0.35} depthScale={0.35} color="#2e5f80" metalness={0.4} mirror={0.45}
              transparent opacity={0.9}
            />
          </mesh>
        )}
        <mesh position={[-4.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={water}>
          <circleGeometry args={[4.0, 26]} />
        </mesh>
        <mesh position={[4.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={water}>
          <circleGeometry args={[4.0, 26]} />
        </mesh>
        {!reflections && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} material={water}>
            <planeGeometry args={[9, 5]} />
          </mesh>
        )}
      </group>
      {rocks.map((r, i) => (
        <mesh key={i} position={[r.x, 0.1, r.z]} rotation={[r.rx, r.rz, 0]} castShadow>
          <dodecahedronGeometry args={[r.s]} />
          <meshStandardMaterial color="#82888f" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function Bridge({ position }: { position: [number, number, number] }) {
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: 0.85 }), []);
  const planks = useMemo(() => Array.from({ length: 15 }, (_, i) => i), []);
  return (
    <group position={position}>
      {planks.map((i) => {
        const z = -4.4 + i * 0.63;
        const t = z / 4.6;
        const y = Math.max(0, 0.55 * (1 - t * t));
        const tilt = -2 * 0.55 * t / 4.6;
        return (
          <mesh key={i} position={[0, y + 0.03, z]} rotation={[Math.atan(tilt), 0, 0]} castShadow receiveShadow material={wood}>
            <boxGeometry args={[2.1, 0.06, 0.6]} />
          </mesh>
        );
      })}
      {[-0.95, 0.95].map((x, side) => (
        <group key={side}>
          {[-4, -2, 0, 2, 4].map((z, i) => {
            const t = z / 4.6;
            const y = Math.max(0, 0.55 * (1 - t * t));
            return (
              <mesh key={i} position={[x, y + 0.45, z]} castShadow material={wood}>
                <boxGeometry args={[0.07, 0.8, 0.07]} />
              </mesh>
            );
          })}
          <mesh position={[x, 1.05, 0]} rotation={[0, 0, 0]} castShadow material={wood}>
            <boxGeometry args={[0.06, 0.06, 9]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ─── Picnic table ───────────────────────────────────────────────────────── */
export function Picnic({ position }: { position: [number, number, number] }) {
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.85 }), []);
  return (
    <group position={position}>
      <mesh position={[0, 0.72, 0]} castShadow material={wood}><boxGeometry args={[1.4, 0.06, 1.0]} /></mesh>
      {[-0.95, 0.95].map((x, i) => (
        <mesh key={i} position={[x, 0.44, 0]} castShadow material={wood}><boxGeometry args={[0.32, 0.05, 1.0]} /></mesh>
      ))}
      {[-0.5, 0.5].map((x, i) => (
        <mesh key={i} position={[x, 0.36, 0]} rotation={[0, 0, x > 0 ? -0.5 : 0.5]} castShadow material={wood}>
          <boxGeometry args={[0.08, 0.78, 0.8]} />
        </mesh>
      ))}
    </group>
  );
}

/* ─── Flowerbed ──────────────────────────────────────────────────────────── */
export function Flowerbed({ position }: { position: [number, number, number] }) {
  const flowers = useMemo(() => {
    const colors = ['#e85a7a', '#f2c14e', '#9b5de5', '#ff8552', '#f2f2f2'];
    return Array.from({ length: 16 }, (_, i) => ({
      x: (Math.sin(i * 2.4) * 0.8) * 1.1,
      z: (Math.cos(i * 1.7) * 0.8) * 1.1,
      c: colors[i % colors.length],
      h: 0.18 + (i % 4) * 0.05,
    }));
  }, []);
  return (
    <group position={position}>
      <mesh position={[0, 0.09, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.45, 1.55, 0.18, 18]} />
        <meshStandardMaterial color="#5e4632" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.19, 0]}>
        <cylinderGeometry args={[1.35, 1.35, 0.04, 18]} />
        <meshStandardMaterial color="#3d2f22" roughness={1} />
      </mesh>
      {flowers.map((f, i) => (
        <group key={i} position={[f.x, 0.2, f.z]}>
          <mesh position={[0, f.h / 2, 0]}>
            <cylinderGeometry args={[0.012, 0.012, f.h, 5]} />
            <meshStandardMaterial color="#3f7d44" />
          </mesh>
          <mesh position={[0, f.h + 0.03, 0]} castShadow>
            <sphereGeometry args={[0.05, 8, 6]} />
            <meshStandardMaterial color={f.c} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ─── Beach ball (server-simulated) ──────────────────────────────────────── */
export function BeachBall() {
  const ref = useRef<THREE.Group>(null);
  const mats = useMemo(() => ['#e63946', '#f8f9fa', '#4895ef', '#f8f9fa', '#ffd166', '#f8f9fa'], []);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    g.visible = hot.ball.active;
    if (!g.visible) return;
    const k = Math.min(1, dt * 18);
    g.position.x += (hot.ball.x - g.position.x) * k;
    g.position.y += (hot.ball.y - g.position.y) * k;
    g.position.z += (hot.ball.z - g.position.z) * k;
    g.rotation.x += (hot.ball.rz - g.rotation.x) * k;
    g.rotation.z -= (hot.ball.rx - -g.rotation.z) * k;
  });
  return (
    <group ref={ref}>
      {mats.map((c, i) => (
        <mesh key={i} rotation={[0, (i / 6) * Math.PI * 2, 0]} castShadow>
          <sphereGeometry args={[0.36, 10, 12, 0, Math.PI / 3]} />
          <meshStandardMaterial color={c} roughness={0.4} />
        </mesh>
      ))}
      <mesh castShadow>
        <sphereGeometry args={[0.352, 14, 12]} />
        <meshStandardMaterial color="#f2f2f2" roughness={0.45} />
      </mesh>
    </group>
  );
}
