/** 象棋桌与麻将桌的实体 3D 呈现:围观者能直接在桌面上看到实时棋局/牌局
 *  (弃牌河、副露、金牌、手牌只见牌背)。 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useWorld } from '../../state/stores';
import { XQ_CHAR, xqIsRed, mjTileName, mjSuit } from '@nexuspark/shared';
import type { XqPiece } from '@nexuspark/shared';

const woodMat = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.7 });
const feltMat = new THREE.MeshStandardMaterial({ color: '#2f6f4f', roughness: 0.9 });

/* ─── 贴图缓存(canvas 生成) ─────────────────────────────────────────────── */
const texCache = new Map<string, THREE.CanvasTexture>();

function xqBoardTexture(): THREE.CanvasTexture {
  const hit = texCache.get('xqboard');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 405; c.height = 450;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8d5b0';
  ctx.fillRect(0, 0, 405, 450);
  ctx.strokeStyle = '#5e4632';
  ctx.lineWidth = 2;
  const gx = (x: number) => 22.5 + x * 45;
  const gy = (y: number) => 22.5 + y * 45;
  // 横线
  for (let y = 0; y < 10; y++) {
    ctx.beginPath(); ctx.moveTo(gx(0), gy(y)); ctx.lineTo(gx(8), gy(y)); ctx.stroke();
  }
  // 竖线(过河断开)
  for (let x = 0; x < 9; x++) {
    if (x === 0 || x === 8) {
      ctx.beginPath(); ctx.moveTo(gx(x), gy(0)); ctx.lineTo(gx(x), gy(9)); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(gx(x), gy(0)); ctx.lineTo(gx(x), gy(4)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx(x), gy(5)); ctx.lineTo(gx(x), gy(9)); ctx.stroke();
    }
  }
  // 九宫斜线
  for (const [x0, y0, x1, y1] of [[3, 0, 5, 2], [5, 0, 3, 2], [3, 7, 5, 9], [5, 7, 3, 9]]) {
    ctx.beginPath(); ctx.moveTo(gx(x0), gy(y0)); ctx.lineTo(gx(x1), gy(y1)); ctx.stroke();
  }
  ctx.fillStyle = '#8a6f52';
  ctx.font = '600 22px "Noto Sans SC", "Segoe UI", sans-serif';
  ctx.fillText('楚 河', 90, gy(4.5) + 8);
  ctx.fillText('汉 界', 250, gy(4.5) + 8);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  texCache.set('xqboard', t);
  return t;
}

function xqPieceTexture(piece: string): THREE.CanvasTexture {
  const key = `xqp:${piece}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const red = xqIsRed(piece as XqPiece);
  ctx.fillStyle = red ? '#f5e6d3' : '#3a3f47';
  ctx.beginPath(); ctx.arc(32, 32, 31, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = red ? '#c0392b' : '#181b20';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(32, 32, 27, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = red ? '#c0392b' : '#f2f2f2';
  ctx.font = '700 32px "Noto Sans SC", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(XQ_CHAR[piece], 32, 34);
  const t = new THREE.CanvasTexture(c);
  texCache.set(key, t);
  return t;
}

function mjFaceTexture(face: number): THREE.CanvasTexture {
  const key = `mjf:${face}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 48; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f8f5ee';
  ctx.fillRect(0, 0, 48, 64);
  const suit = mjSuit(face);
  ctx.fillStyle = suit === 'wan' ? '#c0392b' : suit === 'tiao' ? '#2f9e5f' : suit === 'tong' ? '#2f6fdb' : '#3a3f47';
  ctx.font = '700 20px "Noto Sans SC", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  const name = mjTileName(face);
  if (name.length === 1) {
    ctx.font = '700 30px "Noto Sans SC", sans-serif';
    ctx.fillText(name, 24, 42);
  } else {
    ctx.fillText(name[0], 24, 26);
    ctx.fillText(name.slice(1), 24, 52);
  }
  const t = new THREE.CanvasTexture(c);
  texCache.set(key, t);
  return t;
}

const tileBackMat = new THREE.MeshStandardMaterial({ color: '#2e5f80', roughness: 0.5 });
const tileSideMat = new THREE.MeshStandardMaterial({ color: '#f2ead8', roughness: 0.45 });

/** 一张麻将牌(0.05 × 0.066 × 0.03),faceUp 时贴牌面。 */
function MjTile({ position, ry = 0, face = -1, faceUp = false, standing = false, gold = false }: {
  position: [number, number, number]; ry?: number; face?: number; faceUp?: boolean; standing?: boolean; gold?: boolean;
}) {
  const mats = useMemo(() => {
    const faceMat = faceUp && face >= 0
      ? new THREE.MeshStandardMaterial({ map: mjFaceTexture(face), roughness: 0.4, emissive: gold ? '#d4a017' : '#000000', emissiveIntensity: gold ? 0.25 : 0 })
      : tileBackMat;
    // box面顺序: +x -x +y -y +z -z → 面朝上(y+)或立牌朝向(z+)
    return standing
      ? [tileSideMat, tileSideMat, tileSideMat, tileSideMat, tileBackMat, faceMat]
      : [tileSideMat, tileSideMat, faceMat, tileBackMat, tileSideMat, tileSideMat];
  }, [face, faceUp, standing, gold]);
  return (
    <mesh position={position} rotation={[0, ry, 0]} material={mats} castShadow>
      <boxGeometry args={standing ? [0.05, 0.066, 0.03] : [0.05, 0.03, 0.066]} />
    </mesh>
  );
}

/* ─── 象棋桌 ─────────────────────────────────────────────────────────────── */
export function XiangqiTablePrefab({ position, rotation, tableId }: {
  position: [number, number, number]; rotation: number; tableId: string;
}) {
  const game = useWorld((s) => s.xq[tableId]);
  const boardTex = useMemo(() => xqBoardTexture(), []);
  const pieces = useMemo(() => {
    const out: { idx: number; piece: string }[] = [];
    game?.board.forEach((p, idx) => { if (p) out.push({ idx, piece: p }); });
    return out;
  }, [game?.board]);
  // 棋盘 0.72 × 0.8,红方朝南(+z)
  const cellW = 0.72 / 8, cellH = 0.8 / 9;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.72, 0]} material={woodMat} castShadow>
        <boxGeometry args={[1.0, 0.05, 1.05]} />
      </mesh>
      <mesh position={[0, 0.38, 0]} material={woodMat}>
        <boxGeometry args={[0.12, 0.68, 0.12]} />
      </mesh>
      <mesh position={[0, 0.05, 0]} material={woodMat}>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
      </mesh>
      <mesh position={[0, 0.748, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.82, 0.9]} />
        <meshStandardMaterial map={boardTex} roughness={0.6} />
      </mesh>
      {pieces.map(({ idx, piece }) => {
        const x = idx % 9, y = Math.floor(idx / 9);
        const isLast = game?.lastMove?.[1] === idx;
        return (
          <group key={idx} position={[(x - 4) * cellW, 0.762, (4.5 - y) * cellH]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.036, 0.038, 0.02, 18]} />
              <meshStandardMaterial color={xqIsRed(piece as XqPiece) ? '#f5e6d3' : '#3a3f47'} roughness={0.45} />
            </mesh>
            <mesh position={[0, 0.011, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.034, 18]} />
              <meshStandardMaterial map={xqPieceTexture(piece)} roughness={0.4} />
            </mesh>
            {isLast && (
              <mesh position={[0, -0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.04, 0.048, 18]} />
                <meshBasicMaterial color="#38d9c3" transparent opacity={0.85} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* ─── 麻将桌 ─────────────────────────────────────────────────────────────── */
export function MahjongTablePrefab({ position, rotation, tableId }: {
  position: [number, number, number]; rotation: number; tableId: string;
}) {
  const view = useWorld((s) => s.mj[tableId]);
  const pub = view?.pub;
  const goldRef = useRef<THREE.Group>(null);
  useEffect(() => { /* re-render on state change */ }, [pub]);

  // 每个座位的朝向:0南(+z) 1东 2北 3西 → 出牌河朝桌心
  const seatAngle = (i: number) => [(0), (-Math.PI / 2), (Math.PI), (Math.PI / 2)][i];

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* 桌体 */}
      <mesh position={[0, 0.7, 0]} material={woodMat} castShadow>
        <boxGeometry args={[1.15, 0.06, 1.15]} />
      </mesh>
      <mesh position={[0, 0.732, 0]} material={feltMat}>
        <boxGeometry args={[1.02, 0.012, 1.02]} />
      </mesh>
      {[[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.35, z]} material={woodMat}>
          <boxGeometry args={[0.07, 0.7, 0.07]} />
        </mesh>
      ))}

      {pub && pub.phase !== 'waiting' && (
        <group position={[0, 0.74, 0]}>
          {/* 开金指示(桌心立牌) */}
          {pub.goldFace >= 0 && (
            <group ref={goldRef} position={[0, 0.045, 0]}>
              <MjTile position={[0, 0, 0]} face={pub.goldFace} faceUp standing gold />
            </group>
          )}
          {/* 每个座位:手牌(牌背立着)+ 弃牌河(面朝上)+ 副露 */}
          {pub.seats.map((seat, i) => (
            <group key={i} rotation={[0, seatAngle(i), 0]}>
              {/* 手牌牌背,靠桌边一排 */}
              {Array.from({ length: Math.min(seat.handCount, 14) }).map((_, j) => (
                <MjTile
                  key={`h${j}`}
                  position={[(j - Math.min(seat.handCount, 14) / 2 + 0.5) * 0.054, 0.035, 0.44]}
                  standing
                />
              ))}
              {/* 弃牌河:两排 */}
              {seat.discards.slice(0, 16).map((t, j) => (
                <MjTile
                  key={`d${j}`}
                  position={[((j % 8) - 3.5) * 0.056, 0.006, 0.14 + Math.floor(j / 8) * 0.07]}
                  face={t} faceUp gold={t === pub.goldFace}
                />
              ))}
              {/* 副露(桌角,面朝上) */}
              {seat.melds.map((m, mi) => (
                <group key={`m${mi}`} position={[0.34, 0.006, 0.33 + mi * 0.075]}>
                  {Array.from({ length: m.kind === 'kong' ? 4 : 3 }).map((_, k) => (
                    <MjTile key={k} position={[k * 0.054, 0, 0]} face={m.tile} faceUp />
                  ))}
                </group>
              ))}
              {/* 行动指示灯 */}
              {pub.phase === 'playing' && pub.turn === i && (
                <mesh position={[0, 0.004, 0.52]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.02, 10]} />
                  <meshStandardMaterial color="#38d9c3" emissive="#38d9c3" emissiveIntensity={1.4} />
                </mesh>
              )}
            </group>
          ))}
        </group>
      )}
      {/* 待机时的整齐牌墙装饰 */}
      {(!pub || pub.phase === 'waiting') && (
        <group position={[0, 0.74, 0]}>
          {[0, 1, 2, 3].map((side) => (
            <group key={side} rotation={[0, (side * Math.PI) / 2, 0]}>
              {Array.from({ length: 9 }).map((_, j) => (
                <MjTile key={j} position={[(j - 4) * 0.054, 0.02, 0.34]} />
              ))}
            </group>
          ))}
        </group>
      )}
    </group>
  );
}
