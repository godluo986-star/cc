/** Interactive prefabs: doors (proximity-animated), switches, message boards,
 *  whiteboards (live stroke canvas), arcade cabinets with live game screens,
 *  vending machines, jukebox, kiosk, elevator doors. */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useWorld } from '../../state/stores';
import { hot } from '../../state/hot';
import type { Stroke, TicTacToeState, LightsOutState } from '@nexuspark/shared';

const mat = (color: string, rough = 0.7, metal = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

/* ─── Door: slides open when a player is near ────────────────────────────── */
export function Door({ position, rotation, wide = false, label }: {
  position: [number, number, number]; rotation: number; wide?: boolean; label?: string;
}) {
  const leafL = useRef<THREE.Mesh>(null);
  const leafR = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const w = wide ? 1.3 : 0.85;
  const frame = useMemo(() => mat('#3f4650', 0.6, 0.3), []);
  const glassDoor = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#2e4356', roughness: 0.15, metalness: 0.5, transparent: true, opacity: 0.75,
  }), []);
  useFrame((_, dt) => {
    const d = Math.hypot(hot.local.x - position[0], hot.local.z - position[2]);
    let near = d < 2.6 ? 1 : 0;
    for (const e of hot.players.values()) {
      if (near) break;
      if (!e.profile.isNpc && Math.hypot(e.x - position[0], e.z - position[2]) < 2.6) near = 1;
    }
    open.current += (near - open.current) * Math.min(1, dt * 5);
    const slide = open.current * (w - 0.08);
    if (leafL.current) leafL.current.position.x = -w / 2 - slide;
    if (leafR.current) leafR.current.position.x = w / 2 + slide;
  });
  void label;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* frame */}
      <mesh position={[-w - 0.08, 1.3, 0]} material={frame} castShadow><boxGeometry args={[0.16, 2.6, 0.24]} /></mesh>
      <mesh position={[w + 0.08, 1.3, 0]} material={frame} castShadow><boxGeometry args={[0.16, 2.6, 0.24]} /></mesh>
      <mesh position={[0, 2.62, 0]} material={frame} castShadow><boxGeometry args={[2 * w + 0.32, 0.18, 0.24]} /></mesh>
      {/* sliding leaves */}
      <mesh ref={leafL} position={[-w / 2, 1.25, 0]} material={glassDoor}><boxGeometry args={[w, 2.5, 0.06]} /></mesh>
      <mesh ref={leafR} position={[w / 2, 1.25, 0]} material={glassDoor}><boxGeometry args={[w, 2.5, 0.06]} /></mesh>
    </group>
  );
}

/* ─── Light switch plate ─────────────────────────────────────────────────── */
export function SwitchPlate({ position, rotation, on }: {
  position: [number, number, number]; rotation: number; on: boolean;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.12, 0.18, 0.03]} />
        <meshStandardMaterial color="#d8dce2" roughness={0.5} />
      </mesh>
      <mesh position={[0, on ? 0.03 : -0.03, 0.02]} rotation={[on ? -0.25 : 0.25, 0, 0]}>
        <boxGeometry args={[0.05, 0.07, 0.025]} />
        <meshStandardMaterial color={on ? '#38d9c3' : '#7a8290'} roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ─── Message board ──────────────────────────────────────────────────────── */
export function MessageBoard({ position, rotation, boardId }: {
  position: [number, number, number]; rotation: number; boardId: string;
}) {
  const posts = useWorld((s) => s.boards[boardId]);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 384;
    const t = new THREE.CanvasTexture(c);
    return { c, t };
  }, []);
  useEffect(() => {
    const ctx = tex.c.getContext('2d')!;
    ctx.fillStyle = '#8a6f52';
    ctx.fillRect(0, 0, 512, 384);
    ctx.fillStyle = '#a8895f';
    ctx.fillRect(14, 14, 484, 356);
    const notes = (posts ?? []).slice(0, 8);
    const noteColors = ['#fdf6b2', '#c8e6f5', '#f5c8d8', '#d8f5c8'];
    notes.forEach((p, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = 28 + col * 118, y = 30 + row * 168;
      ctx.save();
      ctx.translate(x + 52, y + 75);
      ctx.rotate(((i * 37) % 10 - 5) * 0.012);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-52, -71, 104, 146);
      ctx.fillStyle = noteColors[(i * 5) % 4];
      ctx.fillRect(-55, -75, 104, 146);
      ctx.fillStyle = '#3a3428';
      ctx.font = '600 13px "Segoe UI", sans-serif';
      ctx.fillText(p.username.slice(0, 12), -47, -55);
      ctx.font = '12px "Segoe UI", sans-serif';
      const words = p.text.split(' ');
      let line = '', ly = -36;
      for (const wd of words) {
        if (ctx.measureText(line + wd).width > 92) {
          ctx.fillText(line, -47, ly); line = wd + ' '; ly += 15;
          if (ly > 60) break;
        } else line += wd + ' ';
      }
      if (ly <= 60) ctx.fillText(line, -47, ly);
      ctx.restore();
    });
    tex.t.needsUpdate = true;
  }, [posts, tex]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-0.75, 0.75].map((x, i) => (
        <mesh key={i} position={[x, 0.9, 0]} castShadow material={useMemo(() => mat('#5e4632', 0.85), [])}>
          <boxGeometry args={[0.08, 1.8, 0.08]} />
        </mesh>
      ))}
      <mesh position={[0, 1.55, 0]} castShadow>
        <boxGeometry args={[1.7, 1.3, 0.06]} />
        <meshStandardMaterial map={tex.t} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.28, 0]} castShadow material={useMemo(() => mat('#5e4632', 0.85), [])}>
        <boxGeometry args={[1.85, 0.12, 0.14]} />
      </mesh>
    </group>
  );
}

/* ─── Whiteboard with live synced strokes ────────────────────────────────── */
export function WhiteboardSurface({ position, rotation, boardId, w = 1.6, h = 1.0 }: {
  position: [number, number, number]; rotation: number; boardId: string; w?: number; h?: number;
}) {
  const strokes = useWorld((s) => s.whiteboards[boardId]);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 640;
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return { c, t, drawn: 0 };
  }, []);
  useEffect(() => {
    const ctx = tex.c.getContext('2d')!;
    const list = strokes ?? [];
    if (tex.drawn > list.length) tex.drawn = 0;
    if (tex.drawn === 0) {
      ctx.fillStyle = '#f6f8fa';
      ctx.fillRect(0, 0, 1024, 640);
    }
    const drawStroke = (s: Stroke) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1.5, s.width * 1024);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i + 1 < s.pts.length; i += 2) {
        const x = s.pts[i] * 1024;
        const y = s.pts[i + 1] * 640;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    for (let i = tex.drawn; i < list.length; i++) drawStroke(list[i]);
    tex.drawn = list.length;
    tex.t.needsUpdate = true;
  }, [strokes, tex]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow>
        <boxGeometry args={[w + 0.1, h + 0.1, 0.05]} />
        <meshStandardMaterial color="#9aa5ad" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex.t} roughness={0.35} />
      </mesh>
      <mesh position={[0, -h / 2 - 0.08, 0.06]}>
        <boxGeometry args={[w * 0.7, 0.05, 0.08]} />
        <meshStandardMaterial color="#7a828c" roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ─── Arcade machines with live screens ──────────────────────────────────── */
function cabinetBody(color: string) {
  return (
    <>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.75, 1.5, 0.65]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.62, -0.05]} rotation={[-0.2, 0, 0]} castShadow>
        <boxGeometry args={[0.75, 0.45, 0.55]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.02, 0.3]} rotation={[-0.45, 0, 0]}>
        <boxGeometry args={[0.7, 0.28, 0.1]} />
        <meshStandardMaterial color="#22262c" roughness={0.6} />
      </mesh>
      {/* joystick + buttons */}
      <mesh position={[-0.18, 1.12, 0.32]} rotation={[-0.45, 0, 0]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial color="#e63946" roughness={0.4} />
      </mesh>
      {[0.06, 0.18].map((x, i) => (
        <mesh key={i} position={[x, 1.1 + 0.02 * i, 0.33]} rotation={[-0.45, 0, 0]}>
          <cylinderGeometry args={[0.028, 0.028, 0.02, 10]} />
          <meshStandardMaterial color={i ? '#ffd166' : '#4895ef'} roughness={0.4} />
        </mesh>
      ))}
    </>
  );
}

export function TttMachine({ position, rotation, machineId }: {
  position: [number, number, number]; rotation: number; machineId: string;
}) {
  const game = useWorld((s) => s.ttt[machineId]);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    return { c, t: new THREE.CanvasTexture(c) };
  }, []);
  useEffect(() => {
    drawTtt(tex.c, game);
    tex.t.needsUpdate = true;
  }, [game, tex]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {cabinetBody('#7d3b5e')}
      <mesh position={[0, 1.45, 0.19]} rotation={[-0.2, 0, 0]}>
        <planeGeometry args={[0.58, 0.5]} />
        <meshStandardMaterial map={tex.t} emissive="#ffffff" emissiveMap={tex.t} emissiveIntensity={0.85} roughness={0.4} />
      </mesh>
    </group>
  );
}

function drawTtt(c: HTMLCanvasElement, game?: TicTacToeState) {
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0d1030';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#ff5fd8';
  ctx.font = '700 24px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('VERSUS', 128, 34);
  ctx.strokeStyle = '#38d9c3';
  ctx.lineWidth = 4;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(58 + i * 47, 60); ctx.lineTo(58 + i * 47, 200); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(58, 60 + i * 47); ctx.lineTo(200, 60 + i * 47); ctx.stroke();
  }
  const board = game?.board ?? [];
  ctx.font = '700 36px monospace';
  for (let i = 0; i < 9; i++) {
    const x = 81 + (i % 3) * 47;
    const y = 96 + Math.floor(i / 3) * 47;
    if (board[i] === 1) { ctx.fillStyle = '#ffd166'; ctx.fillText('X', x, y); }
    if (board[i] === 2) { ctx.fillStyle = '#4895ef'; ctx.fillText('O', x, y); }
  }
  ctx.fillStyle = '#9aa7bd';
  ctx.font = '13px monospace';
  const p1 = game?.players[0]?.username ?? '—';
  const p2 = game?.players[1]?.username ?? '—';
  ctx.fillText(`${p1} vs ${p2}`, 128, 226);
  if (game?.winner) {
    ctx.fillStyle = 'rgba(10, 12, 40, 0.75)';
    ctx.fillRect(30, 100, 196, 60);
    ctx.fillStyle = '#ffd166';
    ctx.font = '700 22px monospace';
    ctx.fillText(game.winner === 3 ? 'DRAW!' : `${game.winner === 1 ? p1 : p2} WINS!`, 128, 137);
  }
}

export function LightsOutMachine({ position, rotation, machineId }: {
  position: [number, number, number]; rotation: number; machineId: string;
}) {
  const game = useWorld((s) => s.lo[machineId]);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    return { c, t: new THREE.CanvasTexture(c) };
  }, []);
  useEffect(() => {
    const ctx = tex.c.getContext('2d')!;
    ctx.fillStyle = '#101408';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#ffd454';
    ctx.font = '700 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LIGHTS OUT', 128, 30);
    const grid = game?.grid ?? Array(25).fill(false);
    for (let i = 0; i < 25; i++) {
      const x = 48 + (i % 5) * 34;
      const y = 52 + Math.floor(i / 5) * 34;
      ctx.fillStyle = grid[i] ? '#ffd454' : '#2a2f1a';
      ctx.fillRect(x, y, 28, 28);
    }
    ctx.fillStyle = '#9aa7bd';
    ctx.font = '13px monospace';
    ctx.fillText(game?.playerName ? `${game.playerName} · ${game.moves} moves` : 'press E to play', 128, 242);
    tex.t.needsUpdate = true;
  }, [game, tex]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {cabinetBody('#3a5f2f')}
      <mesh position={[0, 1.45, 0.19]} rotation={[-0.2, 0, 0]}>
        <planeGeometry args={[0.58, 0.5]} />
        <meshStandardMaterial map={tex.t} emissive="#ffffff" emissiveMap={tex.t} emissiveIntensity={0.85} roughness={0.4} />
      </mesh>
    </group>
  );
}

/* ─── Decorative attract-mode cabinet ────────────────────────────────────── */
export function ArcadeDeco({ position, rotation, variant = 0 }: {
  position: [number, number, number]; rotation: number; variant?: number;
}) {
  const screenRef = useRef<THREE.MeshStandardMaterial>(null);
  const colors = ['#e63946', '#4895ef', '#f4a261'];
  useFrame(({ clock }) => {
    if (screenRef.current) {
      const t = clock.elapsedTime * (1.5 + variant * 0.4);
      screenRef.current.emissiveIntensity = 0.55 + Math.sin(t) * 0.25 + Math.sin(t * 3.7) * 0.12;
    }
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {cabinetBody(['#2e4a6f', '#6f2e4a', '#4a6f2e'][variant % 3])}
      <mesh position={[0, 1.45, 0.19]} rotation={[-0.2, 0, 0]}>
        <planeGeometry args={[0.58, 0.5]} />
        <meshStandardMaterial ref={screenRef} color={colors[variant % 3]} emissive={colors[variant % 3]} emissiveIntensity={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

/* ─── Vending machine ────────────────────────────────────────────────────── */
export function VendingMachine({ position, rotation, kind = 'drinks' }: {
  position: [number, number, number]; rotation: number; kind?: string;
}) {
  const body = kind === 'coffee' ? '#7a4a2f' : '#b03040';
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = 0.75 + Math.sin(clock.elapsedTime * 2) * 0.12;
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.95, 0]} castShadow>
        <boxGeometry args={[0.75, 1.9, 0.7]} />
        <meshStandardMaterial color={body} roughness={0.45} metalness={0.25} />
      </mesh>
      <mesh position={[-0.12, 1.15, 0.36]}>
        <planeGeometry args={[0.42, 1.1]} />
        <meshStandardMaterial ref={glow} color="#cfe4f5" emissive="#bcd8f0" emissiveIntensity={0.8} roughness={0.2} />
      </mesh>
      {/* product rows */}
      {[0, 1, 2].map((r) => (
        <group key={r}>
          {[0, 1, 2].map((col) => (
            <mesh key={col} position={[-0.24 + col * 0.12, 1.5 - r * 0.28, 0.37]}>
              <boxGeometry args={[0.08, 0.16, 0.02]} />
              <meshStandardMaterial color={['#e63946', '#ffd166', '#4895ef'][(r + col) % 3]} roughness={0.5} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0.22, 1.3, 0.36]}>
        <boxGeometry args={[0.16, 0.5, 0.03]} />
        <meshStandardMaterial color="#22262c" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.32, 0.36]}>
        <boxGeometry args={[0.45, 0.22, 0.04]} />
        <meshStandardMaterial color="#1a1d22" roughness={0.6} />
      </mesh>
    </group>
  );
}

/* ─── Jukebox ────────────────────────────────────────────────────────────── */
export function Jukebox({ position, rotation }: { position: [number, number, number]; rotation: number }) {
  const music = useWorld((s) => s.music);
  const glowRef = useRef<THREE.MeshStandardMaterial>(null);
  const playing = !!music?.trackId;
  useFrame(({ clock }) => {
    if (glowRef.current) {
      glowRef.current.emissiveIntensity = playing ? 1.1 + Math.sin(clock.elapsedTime * 6) * 0.4 : 0.35;
    }
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.6, 0]} castShadow>
        <boxGeometry args={[0.8, 1.2, 0.5]} />
        <meshStandardMaterial color="#6e3a1f" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.28, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.4, 0.5, 16, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#6e3a1f" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.28, 0.13]} rotation={[0.1, 0, 0]}>
        <torusGeometry args={[0.3, 0.045, 8, 18, Math.PI]} />
        <meshStandardMaterial ref={glowRef} color="#ffb454" emissive="#ff9a3a" emissiveIntensity={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.72, 0.26]}>
        <planeGeometry args={[0.55, 0.4]} />
        <meshStandardMaterial color="#f5e6c8" emissive="#ffdf9a" emissiveIntensity={playing ? 0.45 : 0.12} roughness={0.4} />
      </mesh>
      {[-0.28, 0.28].map((x, i) => (
        <mesh key={i} position={[x, 0.35, 0.26]}>
          <circleGeometry args={[0.09, 12]} />
          <meshStandardMaterial color="#3a2a1a" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/* ─── Furniture kiosk ────────────────────────────────────────────────────── */
export function Kiosk({ position, rotation }: { position: [number, number, number]; rotation: number }) {
  const spin = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (spin.current) spin.current.rotation.y = clock.elapsedTime * 0.7;
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.62, 1.1, 8]} />
        <meshStandardMaterial color="#3f6f5f" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.13, 0]}>
        <cylinderGeometry args={[0.58, 0.55, 0.06, 8]} />
        <meshStandardMaterial color="#c9a227" roughness={0.35} metalness={0.6} />
      </mesh>
      <group ref={spin} position={[0, 1.45, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.3, 0.18, 0.3]} />
          <meshStandardMaterial color="#5b8cff" emissive="#5b8cff" emissiveIntensity={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.16, 0]} castShadow>
          <coneGeometry args={[0.12, 0.18, 4]} />
          <meshStandardMaterial color="#ffd166" emissive="#ffd166" emissiveIntensity={0.4} roughness={0.4} />
        </mesh>
      </group>
      <pointLight position={[0, 1.6, 0]} color="#7ea8ff" intensity={1.6} distance={3.5} />
    </group>
  );
}

/* ─── Elevator doors (lobby) ─────────────────────────────────────────────── */
export function ElevatorDoors({ position, rotation }: { position: [number, number, number]; rotation: number }) {
  const leafL = useRef<THREE.Mesh>(null);
  const leafR = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const steel = useMemo(() => mat('#8a929c', 0.3, 0.8), []);
  useFrame((_, dt) => {
    const d = Math.hypot(hot.local.x - position[0], hot.local.z - position[2]);
    const target = d < 2 ? 0.85 : 0;
    open.current += (target - open.current) * Math.min(1, dt * 3);
    if (leafL.current) leafL.current.position.x = -0.45 - open.current * 0.8;
    if (leafR.current) leafR.current.position.x = 0.45 + open.current * 0.8;
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.35, -0.08]} material={steel} castShadow>
        <boxGeometry args={[2.2, 2.7, 0.12]} />
      </mesh>
      <mesh position={[0, 2.75, 0]} material={steel}>
        <boxGeometry args={[2.3, 0.16, 0.3]} />
      </mesh>
      {/* interior glow visible when open */}
      <mesh position={[0, 1.3, -0.13]}>
        <planeGeometry args={[1.7, 2.5]} />
        <meshStandardMaterial color="#f5e8c8" emissive="#ffe8b0" emissiveIntensity={0.5} />
      </mesh>
      <mesh ref={leafL} position={[-0.45, 1.3, 0]} material={steel} castShadow>
        <boxGeometry args={[0.9, 2.55, 0.06]} />
      </mesh>
      <mesh ref={leafR} position={[0.45, 1.3, 0]} material={steel} castShadow>
        <boxGeometry args={[0.9, 2.55, 0.06]} />
      </mesh>
      {/* floor indicator */}
      <mesh position={[0, 2.9, 0.12]}>
        <planeGeometry args={[0.5, 0.18]} />
        <meshStandardMaterial color="#1a1d24" emissive="#e8734a" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}
