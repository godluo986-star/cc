/** 象棋与福州麻将的操作面板(便捷 2D 视角;3D 桌面供围观)。 */
import { useEffect, useMemo, useState } from 'react';
import { useWorld } from '../state/stores';
import { connection } from '../net/connection';
import { hot } from '../state/hot';
import { audio } from '../audio/engine';
import {
  xqMovesFrom, xqIsRed, XQ_CHAR, mjTileName, mjSuit,
} from '@nexuspark/shared';
import type { MahjongView } from '@nexuspark/shared';

/* ─── 象棋 ───────────────────────────────────────────────────────────────── */
export function XiangqiPanel({ tableId }: { tableId: string }) {
  const game = useWorld((s) => s.xq[tableId]);
  const [sel, setSel] = useState<number | null>(null);
  if (!game) return <div className="dim">棋桌不见了……</div>;
  const meIdx = game.players[0]?.id === hot.selfId ? 0 : game.players[1]?.id === hot.selfId ? 1 : -1;
  const seated = meIdx !== -1;
  const myTurn = seated && game.turn === meIdx && game.winner === -1 && game.players[0] && game.players[1];
  const targets = useMemo(() => (sel !== null ? new Set(xqMovesFrom(game.board, sel)) : new Set<number>()), [sel, game.board]);

  const cellClick = (idx: number) => {
    if (!myTurn) return;
    const piece = game.board[idx];
    const mine = piece && xqIsRed(piece) === (meIdx === 0);
    if (sel === null) {
      if (mine) { setSel(idx); audio.click(); }
      return;
    }
    if (mine && idx !== sel) { setSel(idx); audio.click(); return; }
    if (targets.has(idx)) {
      connection.send('xq_move', { tableId, from: sel, to: idx });
      setSel(null);
    } else if (idx === sel) {
      setSel(null);
    }
  };

  // 红方在下(y=0 在底部);黑方玩家翻转视角
  const flip = meIdx === 1;
  const rows = [];
  for (let ry = 0; ry < 10; ry++) {
    const y = flip ? ry : 9 - ry;
    const cells = [];
    for (let rx = 0; rx < 9; rx++) {
      const x = flip ? 8 - rx : rx;
      const idx = y * 9 + x;
      const piece = game.board[idx];
      const isSel = sel === idx;
      const isTarget = targets.has(idx);
      const isLast = game.lastMove?.includes(idx);
      cells.push(
        <div
          key={x}
          onClick={() => cellClick(idx)}
          style={{
            width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: myTurn ? 'pointer' : 'default', position: 'relative',
            background: isLast ? 'rgba(56,217,195,0.14)' : undefined,
          }}
        >
          {isTarget && (
            <div style={{
              position: 'absolute', inset: 6, borderRadius: '50%',
              border: piece ? '2px solid #ff6b6b' : undefined,
              background: piece ? undefined : 'rgba(56,217,195,0.35)',
            }} />
          )}
          {piece && (
            <div style={{
              width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 700,
              background: xqIsRed(piece) ? '#f5e6d3' : '#3a3f47',
              color: xqIsRed(piece) ? '#c0392b' : '#f2f2f2',
              border: `2px solid ${isSel ? '#38d9c3' : xqIsRed(piece) ? '#c0392b' : '#181b20'}`,
              boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
            }}>
              {XQ_CHAR[piece]}
            </div>
          )}
        </div>
      );
    }
    rows.push(<div key={ry} style={{ display: 'flex' }}>{cells}</div>);
    if (ry === 4) {
      rows.push(
        <div key="river" style={{ display: 'flex', justifyContent: 'space-around', color: '#8a6f52', fontSize: 13, letterSpacing: 12, padding: '1px 0' }}>
          <span>楚 河</span><span>汉 界</span>
        </div>
      );
    }
  }

  const name = (i: 0 | 1) => game.players[i]?.username ?? '虚位以待';
  return (
    <div className="col" style={{ alignItems: 'center' }}>
      <div className="dim" style={{ fontSize: 13 }}>
        红方:{name(0)} · 黑方:{name(1)}
        {seated && game.winner === -1 && game.players[0] && game.players[1] && (
          <b style={{ color: myTurn ? '#38d9c3' : undefined }}>{myTurn ? ' · 该你走棋!' : ' · 等对方走棋…'}</b>
        )}
      </div>
      <div style={{ background: '#e8d5b0', borderRadius: 10, padding: 8, border: '3px solid #8a6f52' }}>
        {rows}
      </div>
      <div style={{ minHeight: 20, fontSize: 14 }}>
        {game.winner !== -1 && <b>🏆 {game.winner === 0 ? '红方' : '黑方'}({name(game.winner)})获胜!</b>}
        {game.winner === -1 && (!game.players[0] || !game.players[1]) && <span className="dim">等待对手入座……</span>}
      </div>
      <div className="row">
        {!seated && <button className="btn primary" onClick={() => connection.send('game_join', { machineId: tableId })}>入座对弈</button>}
        {seated && game.winner !== -1 && <button className="btn primary" onClick={() => connection.send('game_join', { machineId: tableId })}>再来一局</button>}
        {seated && <button className="btn ghost" onClick={() => { connection.send('game_leave', { machineId: tableId }); setSel(null); }}>离席</button>}
      </div>
      <div className="dim" style={{ fontSize: 11 }}>民间规则:吃掉对方将/帅获胜,允许飞将。</div>
    </div>
  );
}

/* ─── 麻将牌面 ───────────────────────────────────────────────────────────── */
export function TileFace({ face, gold, small = false, onClick, raised = false }: {
  face: number; gold?: boolean; small?: boolean; onClick?: () => void; raised?: boolean;
}) {
  const suit = mjSuit(face);
  const color = suit === 'wan' ? '#c0392b' : suit === 'tiao' ? '#2f9e5f' : suit === 'tong' ? '#2f6fdb' : '#3a3f47';
  return (
    <div
      onClick={onClick}
      style={{
        width: small ? 26 : 38, height: small ? 36 : 52, borderRadius: 5,
        background: '#f8f5ee', color, border: `2px solid ${gold ? '#d4a017' : '#c9c2b4'}`,
        boxShadow: gold ? '0 0 8px rgba(212,160,23,0.7)' : '0 2px 3px rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: small ? 12 : 15, fontWeight: 700, cursor: onClick ? 'pointer' : 'default',
        transform: raised ? 'translateY(-8px)' : undefined, transition: 'transform 0.12s',
        userSelect: 'none', flexShrink: 0, textAlign: 'center', lineHeight: 1.1,
      }}
    >
      {mjTileName(face)}
    </div>
  );
}

/* ─── 福州麻将 ───────────────────────────────────────────────────────────── */
const SEAT_NAMES = ['东', '南', '西', '北'];
export function MahjongPanel({ tableId }: { tableId: string }) {
  const view = useWorld((s) => s.mj[tableId]) as MahjongView | undefined;
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 1000); // 倒计时刷新
    return () => clearInterval(iv);
  }, []);
  if (!view) return <div className="dim">牌桌不见了……</div>;
  const { pub, priv } = view;
  const mySeat = priv?.mySeat ?? -1;
  const seated = mySeat !== -1;
  const myDiscardTurn = !!priv?.mustAct && pub.claimDeadline === null && pub.turn === mySeat;
  const claimLeft = pub.claimDeadline ? Math.max(0, Math.ceil((pub.claimDeadline - Date.now()) / 1000)) : null;
  const send = (action: string, tile?: number) => connection.send('mj_action', { tableId, action, tile });

  const seatLabel = (i: number) => {
    const seat = pub.seats[i];
    const who = seat.profile?.username ?? (seat.isBot ? '🤖 陪打' : '空位');
    return `${SEAT_NAMES[i]}·${who}${i === pub.dealer && pub.phase !== 'waiting' ? '(庄)' : ''}`;
  };

  return (
    <div className="col">
      <div className="row" style={{ flexWrap: 'wrap', fontSize: 12 }} >
        {pub.seats.map((seat, i) => (
          <span key={i} className="dim" style={{
            padding: '3px 8px', borderRadius: 6,
            background: pub.turn === i && pub.phase === 'playing' ? 'rgba(56,217,195,0.18)' : 'rgba(120,150,200,0.08)',
            border: i === mySeat ? '1px solid #38d9c3' : '1px solid transparent',
          }}>
            {seatLabel(i)} <b>{seat.handCount}张</b>
          </span>
        ))}
        <span className="spacer" />
        <span className="dim">墙余 {pub.wallCount}</span>
      </div>

      {pub.goldFace >= 0 && (
        <div className="row" style={{ fontSize: 13 }}>
          <span>开金:</span>
          <TileFace face={pub.goldFace} gold small />
          <span className="dim">({mjTileName(pub.goldFace)} 为金,可当任意牌;起手三金即三金倒!)</span>
        </div>
      )}

      {/* 弃牌河 */}
      {pub.phase !== 'waiting' && (
        <div className="col" style={{ gap: 4 }}>
          {pub.seats.map((seat, i) => (
            <div key={i} className="row" style={{ gap: 3, flexWrap: 'wrap', minHeight: 24 }}>
              <span className="dim" style={{ fontSize: 11, width: 60, flexShrink: 0 }}>{SEAT_NAMES[i]}家弃牌</span>
              {seat.discards.map((t, j) => (
                <TileFace key={j} face={t} small gold={t === pub.goldFace} />
              ))}
              {seat.melds.map((m, j) => (
                <span key={`m${j}`} className="row" style={{ gap: 1, marginLeft: 6, padding: '0 3px', border: '1px dashed rgba(212,160,23,0.6)', borderRadius: 5 }}>
                  {Array.from({ length: m.kind === 'kong' ? 4 : 3 }).map((_, k) => (
                    <TileFace key={k} face={m.tile} small />
                  ))}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 结果 */}
      {pub.phase === 'finished' && (
        <div style={{ fontSize: 15, textAlign: 'center' }}>
          {pub.winner === -2
            ? <b>荒庄 — 牌墙摸完了,流局。</b>
            : <b>🏆 {SEAT_NAMES[pub.winner]}家 {pub.seats[pub.winner]?.profile?.username ?? '🤖'}
                {pub.winKind === 'sanjindao' ? ' 三金倒!!' : pub.winKind === 'zimo' ? ' 自摸!' : ' 胡牌!'}</b>}
        </div>
      )}

      {/* 我的手牌 */}
      {seated && priv && pub.phase === 'playing' && (
        <>
          <div className="row" style={{ gap: 3, flexWrap: 'wrap', padding: '8px 0' }}>
            {priv.hand.map((t, i) => (
              <TileFace
                key={i} face={t} gold={t === pub.goldFace}
                raised={priv.drawn === t && i === priv.hand.lastIndexOf(t)}
                onClick={myDiscardTurn ? () => send('discard', t) : undefined}
              />
            ))}
          </div>
          <div className="row">
            {claimLeft !== null && priv.mustAct && <span className="dim" style={{ fontSize: 12 }}>抢牌 {claimLeft}s:</span>}
            {priv.canHu && <button className="btn primary" onClick={() => send('hu')}>胡!</button>}
            {priv.canPong && <button className="btn" onClick={() => send('pong')}>碰</button>}
            {priv.canKong && <button className="btn" onClick={() => send('kong', pub.lastDiscard?.tile ?? priv.hand.find((t) => priv.hand.filter((x) => x === t).length >= 4))}>杠</button>}
            {claimLeft !== null && priv.mustAct && <button className="btn ghost" onClick={() => send('pass')}>过</button>}
            {myDiscardTurn && <span className="dim" style={{ fontSize: 12 }}>点击手牌打出</span>}
          </div>
        </>
      )}

      <div className="row">
        {!seated && pub.phase !== 'playing' && <button className="btn primary" onClick={() => send('sit')}>入座</button>}
        {!seated && pub.phase === 'playing' && pub.seats.some((x) => x.isBot && !x.profile) && (
          <button className="btn primary" onClick={() => send('sit')}>顶替机器人</button>
        )}
        {seated && pub.phase !== 'playing' && (
          <button className="btn primary" onClick={() => send('start')}>开局(空位由🤖陪打)</button>
        )}
        {seated && <button className="btn ghost" onClick={() => send('leave')}>离席</button>}
      </div>
      <div className="dim" style={{ fontSize: 11 }}>
        福州规则:不能吃,可碰/杠/胡;开金定百搭,三金倒直接胡。胡牌赢金币(自摸、三金倒更多)。
      </div>
    </div>
  );
}
