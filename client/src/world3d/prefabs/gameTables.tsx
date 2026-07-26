/** 象棋桌与麻将桌的实体 3D 呈现:围观者能直接在桌面上看到实时棋局/牌局
 *  (弃牌河、副露、金牌、手牌只见牌背)。 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useWorld } from '../../state/stores';
import { XQ_CHAR, xqIsRed, mjTileName, mjSuit } from '@nexuspark/shared';
import type { XqPiece, RcMeld, RjRiverTile } from '@nexuspark/shared';

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

/* ═══ 立直麻将 · 全自动麻将桌(工单 P5,总纲 §8「3D 桌面」) ═══════════════
 * 旁观真实视角:牌河按 6 列摆放、副露在右手边、立直棒横置、宝牌指示牌
 * 面朝上、各座手牌只见牌背立着(handCount 张);点数屏发光。
 * 手牌内容永不到达旁观客户端(服务器 viewFor 脱敏),这里天然只画牌背。 */

const rjBodyMat = new THREE.MeshStandardMaterial({ color: '#262a33', roughness: 0.6 });
const rjRailMat = new THREE.MeshStandardMaterial({ color: '#31353f', roughness: 0.55 });
const rjFeltMat = new THREE.MeshStandardMaterial({ color: '#2b6b4d', roughness: 0.95 });
const rjBackMat = new THREE.MeshStandardMaterial({ color: '#c9873f', roughness: 0.5 });
const rjStickMat = new THREE.MeshStandardMaterial({ color: '#ede6d6', roughness: 0.5 });
const rjStickDotMat = new THREE.MeshStandardMaterial({ color: '#c0392b', emissive: '#c0392b', emissiveIntensity: 0.4 });
const rjTurnMat = new THREE.MeshStandardMaterial({ color: '#38d9c3', emissive: '#38d9c3', emissiveIntensity: 1.4 });
const rjDiceMat = new THREE.MeshStandardMaterial({ color: '#f2f2ea', roughness: 0.4 });

const RJ_TILE_W = 0.038;
const RJ_TILE_H = 0.052;
const RJ_TILE_T = 0.016;
const RJ_GAP = 0.042;

const RJ_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const RJ_WINDS = ['東', '南', '西', '北'];

/** 筒子 1-9 的圆点布局(64×88 canvas 像素坐标 + 半径)。 */
const RJ_PIN_DOTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[32, 44]],
  [[32, 26], [32, 62]],
  [[18, 22], [32, 44], [46, 66]],
  [[20, 26], [44, 26], [20, 62], [44, 62]],
  [[20, 24], [44, 24], [32, 44], [20, 64], [44, 64]],
  [[20, 22], [44, 22], [20, 44], [44, 44], [20, 66], [44, 66]],
  [[16, 18], [30, 24], [44, 30], [20, 52], [44, 52], [20, 70], [44, 70]],
  [[20, 17], [44, 17], [20, 35], [44, 35], [20, 53], [44, 53], [20, 71], [44, 71]],
  [[18, 22], [32, 22], [46, 22], [18, 44], [32, 44], [46, 44], [18, 66], [32, 66], [46, 66]],
];

/** 索子 1-9 的竹棒布局([x, y, 高度])。 */
const RJ_SOU_STICKS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[32, 44, 52]],
  [[32, 24, 30], [32, 64, 30]],
  [[32, 20, 26], [20, 60, 30], [44, 60, 30]],
  [[20, 24, 30], [44, 24, 30], [20, 64, 30], [44, 64, 30]],
  [[20, 22, 28], [44, 22, 28], [32, 44, 24], [20, 66, 28], [44, 66, 28]],
  [[18, 24, 30], [32, 24, 30], [46, 24, 30], [18, 64, 30], [32, 64, 30], [46, 64, 30]],
  [[32, 17, 22], [18, 46, 24], [32, 46, 24], [46, 46, 24], [18, 72, 24], [32, 72, 24], [46, 72, 24]],
  [[14, 24, 30], [26, 24, 30], [38, 24, 30], [50, 24, 30], [14, 64, 30], [26, 64, 30], [38, 64, 30], [50, 64, 30]],
  [[18, 20, 22], [32, 20, 22], [46, 20, 22], [18, 44, 22], [32, 44, 22], [46, 44, 22], [18, 68, 22], [32, 68, 22], [46, 68, 22]],
];

/** 日麻牌面 canvas 精绘:万(数字+萬)/ 筒(圆点)/ 索(竹棒)/ 字牌,红 5 全红。 */
function rjFaceTexture(face: number, red = false): THREE.CanvasTexture {
  const key = `rjf:${face}:${red ? 1 : 0}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 88;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f8f4e8';
  ctx.fillRect(0, 0, 64, 88);
  ctx.strokeStyle = 'rgba(90,80,60,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 60, 84);
  if (face < 9) {
    // 万子:数字(蓝)+ 萬(红);红 5 数字也红
    ctx.textAlign = 'center';
    ctx.fillStyle = red ? '#c0392b' : '#1f3a93';
    ctx.font = '700 32px "Noto Serif SC", "Noto Sans SC", serif';
    ctx.fillText(RJ_NUMS[face], 32, 38);
    ctx.fillStyle = '#c0392b';
    ctx.font = '700 30px "Noto Serif SC", "Noto Sans SC", serif';
    ctx.fillText('萬', 32, 74);
  } else if (face < 18) {
    // 筒子:圆点;1 筒大饼红蓝双环
    const n = face - 9;
    const dots = RJ_PIN_DOTS[n];
    const r = n === 0 ? 22 : n < 3 ? 10 : n < 6 ? 8.6 : 7;
    for (let i = 0; i < dots.length; i++) {
      const [x, y] = dots[i];
      const isRedDot = (red && n === 4 && i === 2) || n === 0;
      ctx.fillStyle = isRedDot ? '#c0392b' : '#2f6fdb';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = isRedDot ? '#7a2318' : '#1d478f';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r - 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#f8f4e8';
      ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }
  } else if (face < 27) {
    // 索子:竹棒;红 5 中间棒变红
    const n = face - 18;
    const sticks = RJ_SOU_STICKS[n];
    for (let i = 0; i < sticks.length; i++) {
      const [x, y, h] = sticks[i];
      const isRedStick = (red && n === 4 && i === 2) || (n === 0);
      ctx.fillStyle = isRedStick ? (n === 0 ? '#2f9e5f' : '#c0392b') : '#2f9e5f';
      if (n === 0 && red) ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.roundRect(x - 4, y - h / 2, 8, h, 3);
      ctx.fill();
      // 竹节:上下端头 + 中带
      ctx.fillStyle = 'rgba(20,60,36,0.5)';
      ctx.fillRect(x - 4, y - 1.2, 8, 2.4);
      ctx.fillStyle = 'rgba(255,250,238,0.5)';
      ctx.fillRect(x - 4, y - h / 2 + 1.5, 8, 1.6);
      ctx.fillRect(x - 4, y + h / 2 - 3.1, 8, 1.6);
    }
  } else {
    // 字牌:東南西北(墨)、白(蓝框)、發(绿)、中(红)
    ctx.textAlign = 'center';
    if (face === 31) {
      ctx.strokeStyle = '#2f6fdb';
      ctx.lineWidth = 4;
      ctx.strokeRect(12, 16, 40, 56);
    } else {
      ctx.fillStyle = face < 31 ? '#2b2b33' : face === 32 ? '#2f9e5f' : '#c0392b';
      ctx.font = '700 44px "Noto Serif SC", "Noto Sans SC", serif';
      ctx.fillText(face < 31 ? RJ_WINDS[face - 27] : face === 32 ? '發' : '中', 32, 60);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

const rjFaceMatCache = new Map<string, THREE.MeshStandardMaterial>();
function rjFaceMat(face: number, red: boolean): THREE.MeshStandardMaterial {
  const key = `${face}:${red ? 1 : 0}`;
  let m = rjFaceMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: rjFaceTexture(face, red), roughness: 0.4 });
    rjFaceMatCache.set(key, m);
  }
  return m;
}

/** 一张日麻牌。standing=牌背立着(手牌,旁观不可见内容);faceUp=平放亮面。 */
function RjTile({ position, ry = 0, face = -1, red = false, faceUp = false, standing = false }: {
  position: [number, number, number]; ry?: number; face?: number; red?: boolean;
  faceUp?: boolean; standing?: boolean;
}) {
  const mats = useMemo(() => {
    if (standing) {
      // 立着的手牌:两大面都是牌背(内容对旁观者不存在)
      return [tileSideMat, tileSideMat, tileSideMat, tileSideMat, rjBackMat, rjBackMat];
    }
    const faceMat = faceUp && face >= 0 ? rjFaceMat(face, red) : rjBackMat;
    // box 面序 +x -x +y -y +z -z:平放 → 顶面亮面、底面牌背
    return [tileSideMat, tileSideMat, faceMat, rjBackMat, tileSideMat, tileSideMat];
  }, [face, red, faceUp, standing]);
  return (
    <mesh position={position} rotation={[0, ry, 0]} material={mats} castShadow>
      <boxGeometry args={standing ? [RJ_TILE_W, RJ_TILE_H, RJ_TILE_T] : [RJ_TILE_W, RJ_TILE_T, RJ_TILE_H]} />
    </mesh>
  );
}

/** 点数屏贴图(发光琥珀数字)。 */
function rjPointsTexture(points: number): THREE.CanvasTexture {
  const key = `rjp:${points}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = '#ffd27a';
  ctx.font = '700 24px "Segoe UI", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(points), 64, 25);
  const t = new THREE.CanvasTexture(c);
  texCache.set(key, t);
  return t;
}

function RjPointDisplay({ points }: { points: number }) {
  const tex = useMemo(() => rjPointsTexture(points), [points]);
  return (
    <mesh position={[0, 0.037, 0.545]} rotation={[-Math.PI / 2, 0, Math.PI]}>
      <planeGeometry args={[0.2, 0.05]} />
      <meshStandardMaterial color="#101319" emissive="#ffffff" emissiveMap={tex} map={tex} emissiveIntensity={0.9} roughness={0.4} />
    </mesh>
  );
}

/** 一家的桌面内容(在已按座位旋转的局部系里;+z 指向该家桌沿)。 */
function RjSeatContent({ seat, isTurn }: {
  seat: { handCount: number; river: RjRiverTile[]; melds: RcMeld[]; riichi: boolean };
  isTurn: boolean;
}) {
  const handN = Math.min(seat.handCount, 14);
  return (
    <group>
      {/* 手牌:牌背立着一排 */}
      {Array.from({ length: handN }).map((_, j) => (
        <RjTile key={`h${j}`} position={[(j - (handN - 1) / 2) * (RJ_TILE_W + 0.003), RJ_TILE_H / 2, 0.43]} standing />
      ))}
      {/* 牌河:6 列一排,立直宣言牌横置 */}
      {seat.river.map((rt, j) => (
        <RjTile
          key={`r${j}`}
          position={[((j % 6) - 2.5) * RJ_GAP, RJ_TILE_T / 2, 0.135 + Math.floor(j / 6) * 0.058]}
          ry={rt.riichi ? Math.PI / 2 : 0}
          face={rt.tile.face} red={rt.tile.red} faceUp
        />
      ))}
      {/* 副露:右手边(+x),一组一行,被叫牌横置 */}
      {seat.melds.map((m, mi) => (
        <group key={`m${mi}`} position={[0.36, 0, 0.45 - mi * 0.062]}>
          {m.tiles.map((t, k) => (
            <RjTile
              key={k}
              position={[k * RJ_GAP, RJ_TILE_T / 2, 0]}
              ry={m.called && t.id === m.called.id ? Math.PI / 2 : 0}
              face={t.face} red={t.red}
              faceUp={m.kind !== 'ankan' || k === 1 || k === 2}
            />
          ))}
        </group>
      ))}
      {/* 立直棒:横置千点棒 */}
      {seat.riichi && (
        <group position={[0, 0.006, 0.082]}>
          <mesh material={rjStickMat}>
            <boxGeometry args={[0.2, 0.01, 0.02]} />
          </mesh>
          <mesh position={[0, 0.006, 0]} material={rjStickDotMat}>
            <boxGeometry args={[0.016, 0.002, 0.016]} />
          </mesh>
        </group>
      )}
      {/* 行动指示灯(桌沿框上) */}
      {isTurn && (
        <mesh position={[0, 0.042, 0.5]} material={rjTurnMat}>
          <boxGeometry args={[0.12, 0.012, 0.018]} />
        </mesh>
      )}
    </group>
  );
}

export function RiichiTablePrefab({ position, rotation, tableId }: {
  position: [number, number, number]; rotation: number; tableId: string;
}) {
  const view = useWorld((s) => s.rj[tableId]);
  const pub = view?.pub ?? null;
  const active = !!pub && pub.phase !== 'idle';
  // 座位朝向与雀庄 layout 的入座顺序一致:0 南(+z) 1 东 2 北 3 西
  const seatAngles = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* 全自动桌体:深色框体 + 绿呢台面 + 四边扶栏 + 中柱底座 */}
      <mesh position={[0, 0.7, 0]} material={rjBodyMat} castShadow>
        <boxGeometry args={[1.18, 0.1, 1.18]} />
      </mesh>
      <mesh position={[0, 0.756, 0]} material={rjFeltMat}>
        <boxGeometry args={[1.0, 0.018, 1.0]} />
      </mesh>
      <mesh position={[0, 0.38, 0]} material={rjBodyMat}>
        <boxGeometry args={[0.26, 0.62, 0.26]} />
      </mesh>
      <mesh position={[0, 0.045, 0]} material={rjBodyMat}>
        <boxGeometry args={[0.62, 0.09, 0.62]} />
      </mesh>
      {/* 四边扶栏 + 点数屏 + 每家内容 */}
      {seatAngles.map((a, i) => (
        <group key={i} rotation={[0, a, 0]}>
          <group position={[0, 0.77, 0]}>
            <mesh position={[0, 0.01, 0.545]} material={rjRailMat} castShadow>
              <boxGeometry args={[1.18, 0.06, 0.09]} />
            </mesh>
            <RjPointDisplay points={pub ? pub.seats[i].points : 25000} />
            {active && pub && (
              <RjSeatContent
                seat={pub.seats[i]}
                isTurn={pub.phase === 'playing' && pub.turn === i}
              />
            )}
          </group>
        </group>
      ))}
      {/* 中央模块:骰子区 + 开局环 */}
      <group position={[0, 0.777, 0]}>
        <mesh material={rjBodyMat}>
          <boxGeometry args={[0.26, 0.016, 0.26]} />
        </mesh>
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.085, 0.1, 24]} />
          <meshStandardMaterial color="#38d9c3" emissive="#38d9c3" emissiveIntensity={active ? 1.2 : 0.35} />
        </mesh>
        {[[-0.028, 0.4], [0.03, -0.2]].map(([x, rz], i) => (
          <group key={i} position={[x, 0.014, i === 0 ? 0.02 : -0.025]} rotation={[0, rz, 0]}>
            <mesh material={rjDiceMat} castShadow>
              <boxGeometry args={[0.024, 0.024, 0.024]} />
            </mesh>
            <mesh position={[0, 0.0125, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.004, 8]} />
              <meshStandardMaterial color="#c0392b" />
            </mesh>
          </group>
        ))}
        {/* 宝牌指示牌:面朝上一排(杠后增加) */}
        {active && pub && pub.doraIndicators.length > 0 && (
          <group position={[0, 0.002, -0.2]}>
            {pub.doraIndicators.map((f, k) => (
              <RjTile
                key={k}
                position={[(k - (pub.doraIndicators.length - 1) / 2) * RJ_GAP, RJ_TILE_T / 2, 0]}
                face={f} faceUp
              />
            ))}
          </group>
        )}
      </group>
    </group>
  );
}
