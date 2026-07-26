/** Personal room: shell styled by the owner, furniture from RoomData, and an
 *  in-world placement editor (ghost preview, wall snapping, live sync). */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  ROOM_BOUNDS, ROOM_DOOR, ROOM_SWITCH, FURNITURE_BY_TYPE,
} from '@nexuspark/shared';
import type { RoomData, RoomObject as RoomObjectData } from '@nexuspark/shared';
import { useWorld, useUI, useSession } from '../../state/stores';
import { connection } from '../../net/connection';
import { audio } from '../../audio/engine';
import {
  Sofa, SofaLux, Armchair, Chair, Stool, Bed, Table, CoffeeTable, Desk,
  FloorLamp, TableLamp, TvFrame, Computer, Speaker, Bookshelf, Wardrobe,
  Plant, Rug, Mirror, NeonSign, PartyLight, Fireplace, Aquarium, Kitchen,
} from '../prefabs/furniture';
import { Door, SwitchPlate, WhiteboardSurface } from '../prefabs/interactive';
import { WindowFrame } from '../prefabs/interiors';
import MediaScreen from '../media/MediaScreen';
import { plankTexture } from './textures';

const W = ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX;
const D = ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ;
const H = 3.0;

function RoomShell({ room }: { room: RoomData }) {
  const s = room.style;
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ color: s.wallColor, roughness: 0.92 }), [s.wallColor]);
  const trimMat = useMemo(() => new THREE.MeshStandardMaterial({ color: s.trimColor, roughness: 0.8 }), [s.trimColor]);
  const floorTex = useMemo(() => plankTexture('#a08a70'), []);
  const t = 0.22;

  const lightColor = s.lightPreset === 'warm' ? '#ffd9a0' : s.lightPreset === 'cool' ? '#cfe0ff' : '#ff9af0';
  const partyRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (partyRef.current && s.lightPreset === 'party' && s.lightsOn) {
      partyRef.current.rotation.y = clock.elapsedTime * 1.6;
    }
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floorTex} color={s.floorColor} roughness={0.7} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, 0]}>
        <planeGeometry args={[W + 0.5, D + 0.5]} />
        <meshStandardMaterial color={s.ceilingColor} roughness={0.95} />
      </mesh>
      {/* walls: north solid w/ window cut visual, south with door gap */}
      <mesh position={[0, H / 2, ROOM_BOUNDS.minZ - t / 2]} material={wallMat} receiveShadow>
        <boxGeometry args={[W + t * 2, H, t]} />
      </mesh>
      <mesh position={[ROOM_BOUNDS.minX - t / 2, H / 2, 0]} material={wallMat} receiveShadow>
        <boxGeometry args={[t, H, D]} />
      </mesh>
      <mesh position={[ROOM_BOUNDS.maxX + t / 2, H / 2, 0]} material={wallMat} receiveShadow>
        <boxGeometry args={[t, H, D]} />
      </mesh>
      {/* south wall pieces around the door (door at x=1.9, width 1.2) */}
      <mesh position={[(ROOM_BOUNDS.minX + 1.3) / 2, H / 2, ROOM_BOUNDS.maxZ + t / 2]} material={wallMat} receiveShadow>
        <boxGeometry args={[1.3 - ROOM_BOUNDS.minX, H, t]} />
      </mesh>
      <mesh position={[(2.5 + ROOM_BOUNDS.maxX) / 2, H / 2, ROOM_BOUNDS.maxZ + t / 2]} material={wallMat} receiveShadow>
        <boxGeometry args={[ROOM_BOUNDS.maxX - 2.5, H, t]} />
      </mesh>
      <mesh position={[1.9, 2.6 + (H - 2.6) / 2, ROOM_BOUNDS.maxZ + t / 2]} material={wallMat}>
        <boxGeometry args={[1.2, H - 2.6, t]} />
      </mesh>
      {/* trim */}
      {[
        { x: 0, z: ROOM_BOUNDS.minZ - 0.02, w: W, d: 0.06 },
        { x: ROOM_BOUNDS.minX + 0.02, z: 0, w: 0.06, d: D },
        { x: ROOM_BOUNDS.maxX - 0.02, z: 0, w: 0.06, d: D },
      ].map((seg, i) => (
        <mesh key={i} position={[seg.x, 0.08, seg.z]} material={trimMat}>
          <boxGeometry args={[seg.w, 0.16, seg.d]} />
        </mesh>
      ))}
      {/* big north window with sky view */}
      <WindowFrame position={[-1.5, 1.55, ROOM_BOUNDS.minZ + 0.02]} rotation={0} w={2.6} h={1.6} />
      <WindowFrame position={[2.6, 1.55, ROOM_BOUNDS.minZ + 0.02]} rotation={0} w={1.8} h={1.6} />

      {/* ceiling lamp */}
      <group position={[0, H, 0.4]}>
        <mesh position={[0, -0.12, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.24, 6]} />
          <meshStandardMaterial color="#3a3f47" />
        </mesh>
        <mesh position={[0, -0.3, 0]}>
          <sphereGeometry args={[0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
          <meshStandardMaterial
            color="#e8e4dc" roughness={0.5}
            emissive={lightColor} emissiveIntensity={room.style.lightsOn ? 1.2 : 0.02}
            side={THREE.DoubleSide}
          />
        </mesh>
        {room.style.lightsOn && s.lightPreset !== 'party' && (
          <pointLight position={[0, -0.6, 0]} color={lightColor} intensity={13} distance={13} decay={1.8} />
        )}
        {room.style.lightsOn && s.lightPreset === 'party' && (
          <group ref={partyRef}>
            {['#ff5fd8', '#40e8ff', '#ffd166'].map((c, i) => {
              const a = (i / 3) * Math.PI * 2;
              return (
                <spotLight
                  key={i} color={c} intensity={26} angle={0.5} penumbra={0.6} distance={13}
                  position={[0, -0.3, 0]}
                  target-position={[Math.cos(a) * 4.5, -H, Math.sin(a) * 4.5]}
                />
              );
            })}
            <pointLight position={[0, -0.6, 0]} color="#8a5fff" intensity={4} distance={12} />
          </group>
        )}
        {!room.style.lightsOn && <pointLight position={[0, -0.8, 0]} color="#33415f" intensity={1.5} distance={12} />}
      </group>
    </group>
  );
}

function RoomObjectMesh({ obj, room }: { obj: RoomObjectData; room: RoomData }) {
  const editMode = useUI((s) => s.editMode);
  const selected = useUI((s) => s.editSelection) === obj.id;
  const setSelection = useUI((s) => s.setEditSelection);
  const def = FURNITURE_BY_TYPE[obj.type];
  if (!def) return null;

  const inner = (() => {
    const p = { color: obj.color, state: obj.state };
    switch (obj.type) {
      case 'sofa': return <Sofa {...p} />;
      case 'sofa_lux': return <SofaLux {...p} />;
      case 'armchair': return <Armchair {...p} />;
      case 'chair': return <Chair {...p} />;
      case 'stool': return <Stool {...p} />;
      case 'bed': return <Bed {...p} />;
      case 'table': return <Table {...p} />;
      case 'coffee_table': return <CoffeeTable {...p} />;
      case 'desk': return <Desk {...p} />;
      case 'floor_lamp': return <FloorLamp {...p} />;
      case 'table_lamp': return <TableLamp {...p} />;
      case 'tv': return (
        <group>
          <TvFrame {...p}>{null}</TvFrame>
          <group position={[0, 0.94, 0.06]}>
            <MediaScreen position={[0, 0, 0]} rotation={0} width={1.35} height={0.78} frame={false} />
          </group>
        </group>
      );
      case 'tv_big': return (
        <group>
          <TvFrame {...p} big>{null}</TvFrame>
          <group position={[0, 1.125, 0.06]}>
            <MediaScreen position={[0, 0, 0]} rotation={0} width={2.0} height={1.15} frame={false} />
          </group>
        </group>
      );
      case 'computer': return <Computer color={obj.color} state={{ notesPreview: room.notes }} />;
      case 'speaker': return <Speaker {...p} />;
      case 'bookshelf': return <Bookshelf {...p} />;
      case 'wardrobe': return <Wardrobe {...p} />;
      case 'plant': return <Plant {...p} />;
      case 'rug': return <Rug {...p} />;
      case 'mirror': return <Mirror {...p} />;
      case 'whiteboard_s': return (
        <WhiteboardSurface position={[0, 1.45, 0]} rotation={0} boardId={`obj:${obj.id}`} w={1.4} h={0.95} />
      );
      case 'neon_sign': return <NeonSign {...p} />;
      case 'party_light': return <PartyLight {...p} />;
      case 'fireplace': return <Fireplace {...p} />;
      case 'aquarium': return <Aquarium {...p} />;
      case 'kitchen': return <Kitchen {...p} />;
      default: return null;
    }
  })();

  return (
    <group
      position={[obj.x, obj.y, obj.z]}
      rotation={[0, obj.ry, 0]}
      onClick={(e) => {
        if (!editMode) return;
        e.stopPropagation();
        setSelection(obj.id);
        audio.click();
      }}
    >
      {inner}
      {selected && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(def.size[0], def.size[1]) / 2 + 0.12, Math.max(def.size[0], def.size[1]) / 2 + 0.22, 24]} />
          <meshBasicMaterial color="#38d9c3" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** Surface-snap for small tabletop items. */
function surfaceHeightAt(room: RoomData, x: number, z: number): number {
  for (const o of room.objects) {
    const def = FURNITURE_BY_TYPE[o.type];
    if (!def) continue;
    const heights: Record<string, number> = { desk: 0.76, table: 0.755, coffee_table: 0.42, kitchen: 0.95 };
    const h = heights[o.type];
    if (h === undefined) continue;
    const cos = Math.cos(-o.ry), sin = Math.sin(-o.ry);
    const lx = (x - o.x) * cos - (z - o.z) * sin;
    const lz = (x - o.x) * sin + (z - o.z) * cos;
    if (Math.abs(lx) < def.size[0] / 2 && Math.abs(lz) < def.size[1] / 2) return h;
  }
  return 0;
}

function EditorGhost({ room }: { room: RoomData }) {
  const placing = useUI((s) => s.editPlacing);
  const selection = useUI((s) => s.editSelection);
  const [ghost, setGhost] = useState<{ x: number; z: number; valid: boolean } | null>(null);
  const rotRef = useRef(0);
  const type = placing ?? (selection !== null ? room.objects.find((o) => o.id === selection)?.type ?? null : null);
  const def = type ? FURNITURE_BY_TYPE[type] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyR') rotRef.current = (rotRef.current + Math.PI / 4) % (Math.PI * 2);
      if (e.code === 'Escape') {
        useUI.getState().setEditPlacing(null);
        useUI.getState().setEditSelection(null);
      }
      if ((e.code === 'Delete' || e.code === 'KeyX') && selection !== null) {
        connection.send('room_edit', { op: 'remove', id: selection });
        useUI.getState().setEditSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  useEffect(() => {
    if (selection !== null) {
      const o = room.objects.find((v) => v.id === selection);
      if (o) rotRef.current = o.ry;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  if (!def) return null;

  const snap = (v: number) => Math.round(v * 4) / 4;

  const place = (x: number, z: number) => {
    let px = snap(x), pz = snap(z), ry = rotRef.current;
    if (def.wallMounted) {
      // snap to nearest wall, facing inward
      const dW = px - ROOM_BOUNDS.minX, dE = ROOM_BOUNDS.maxX - px;
      const dN = pz - ROOM_BOUNDS.minZ, dS = ROOM_BOUNDS.maxZ - pz;
      const m = Math.min(dW, dE, dN, dS);
      if (m === dW) { px = ROOM_BOUNDS.minX + 0.16; ry = Math.PI / 2; }
      else if (m === dE) { px = ROOM_BOUNDS.maxX - 0.16; ry = -Math.PI / 2; }
      else if (m === dN) { pz = ROOM_BOUNDS.minZ + 0.16; ry = 0; }
      else { pz = ROOM_BOUNDS.maxZ - 0.16; ry = Math.PI; }
    }
    const y = ['table_lamp', 'computer'].includes(def.type) ? surfaceHeightAt(room, px, pz) : 0;
    if (placing) {
      connection.send('room_edit', { op: 'add', type: def.type, x: px, y, z: pz, ry, color: def.defaultColor });
      audio.chime(true);
    } else if (selection !== null) {
      connection.send('room_edit', { op: 'move', id: selection, x: px, y, z: pz, ry });
      useUI.getState().setEditSelection(null);
      audio.click();
    }
  };

  return (
    <group>
      {/* pointer-catch plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        visible={false}
        onPointerMove={(e) => {
          const x = snap(e.point.x), z = snap(e.point.z);
          const inX = x > ROOM_BOUNDS.minX + 0.2 && x < ROOM_BOUNDS.maxX - 0.2;
          const inZ = z > ROOM_BOUNDS.minZ + 0.2 && z < ROOM_BOUNDS.maxZ - 0.2;
          setGhost({ x, z, valid: inX && inZ });
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (ghost?.valid) place(ghost.x, ghost.z);
        }}
      >
        <planeGeometry args={[W, D]} />
      </mesh>
      {ghost && (
        <group position={[ghost.x, 0.03, ghost.z]} rotation={[0, rotRef.current, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[def.size[0], def.size[1]]} />
            <meshBasicMaterial color={ghost.valid ? '#38d9c3' : '#ff6b6b'} transparent opacity={0.4} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0.02, -def.size[1] / 2 + 0.06]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[def.size[0] * 0.5, 0.08]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.7} depthWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

export default function PersonalRoom() {
  const room = useWorld((s) => s.room);
  const editMode = useUI((s) => s.editMode);
  const self = useSession((s) => s.self);
  const switchOn = room?.style.lightsOn ?? true;
  if (!room) return null;
  const isOwner = self?.userId === room.ownerId;
  return (
    <group>
      <RoomShell room={room} />
      {room.objects.map((o) => (
        <RoomObjectMesh key={o.id} obj={o} room={room} />
      ))}
      <Door position={ROOM_DOOR.pos} rotation={ROOM_DOOR.ry} />
      <SwitchPlate position={ROOM_SWITCH.pos} rotation={ROOM_SWITCH.ry} on={switchOn} />
      {editMode && isOwner && <EditorGhost room={room} />}
    </group>
  );
}
