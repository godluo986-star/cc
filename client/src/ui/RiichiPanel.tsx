/**
 * 立直麻将 · 雀魂式 2D 操作面板(RiichiPanel.tsx)
 *
 * 布局:上方对家侧视 → 中段 左家 | 中央信息盘 | 右家 → 我的牌河/副露 →
 * 底部自家手牌(自摸牌右侧分离,点选浮起再点确认切出)→ 行动条
 * (吃/碰/杠/荣/自摸/立直/过 + 8s 倒计时圈)→ 结算浮层(役种逐条 + 番符 + 点数变动)。
 * 服务器权威(rj_action),本组件只渲染 RiichiView 并发意图。
 */
import { useEffect, useMemo, useState } from 'react';
import { useWorld } from '../state/stores';
import { connection } from '../net/connection';
import { hot } from '../state/hot';
import { audio } from '../audio/engine';
import { rcTileName } from '@nexuspark/shared';
import type { RcTile, RcMeld, RjSeatPublic, RiichiPublic, RjWinSettle, RjDrawSettle } from '@nexuspark/shared';
import { tileDataURL, tileBackDataURL } from './riichiTiles';

const WIND_CHARS = ['东', '南', '西', '北'];
const CLAIM_WINDOW_S = 8;
const TEAL = '#38d9c3';

const windOf = (face: number) => WIND_CHARS[(face - 27 + 4) % 4];
const serverNow = () => Date.now() + hot.serverTimeOffset;

function seatName(seat: RjSeatPublic): string {
  return seat.profile?.username ?? (seat.botName ? `🤖 ${seat.botName}` : '空位');
}

/* ── 牌图 ─────────────────────────────────────────────────────────────────── */
function Tile({ tile, face, w = 40, back, onClick, raised, glow, dim, rot }: {
  tile?: RcTile; face?: number; w?: number; back?: boolean;
  onClick?: () => void; raised?: boolean; glow?: boolean; dim?: boolean; rot?: boolean;
}) {
  const h = Math.round((w * 88) / 64);
  const src = back ? tileBackDataURL() : tileDataURL(tile?.face ?? face ?? 0, tile?.red ?? false);
  const img = (
    <img
      src={src} draggable={false} alt=""
      onClick={onClick}
      style={{
        width: w, height: h, display: 'block', flexShrink: 0, userSelect: 'none',
        cursor: onClick ? 'pointer' : 'default',
        transform: `${raised ? 'translateY(-9px)' : ''} ${rot ? 'rotate(90deg)' : ''}`.trim() || undefined,
        transition: 'transform 0.12s',
        borderRadius: 4,
        boxShadow: glow ? `0 0 7px ${TEAL}, 0 0 2px ${TEAL}` : '0 1px 2px rgba(0,0,0,0.4)',
        opacity: dim ? 0.45 : 1,
      }}
    />
  );
  if (!rot) return img;
  return (
    <span style={{ display: 'inline-flex', width: h, height: h, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {img}
    </span>
  );
}

/** 副露一组(小图横排,被叫牌横置)。 */
function MeldRow({ meld, w = 20 }: { meld: RcMeld; w?: number }) {
  return (
    <span className="row" style={{ gap: 1, padding: '0 2px', flexShrink: 0 }}>
      {meld.tiles.map((t, i) => (
        meld.kind === 'ankan' && (i === 0 || i === 3)
          ? <Tile key={t.id} back w={w} />
          : <Tile key={t.id} tile={t} w={w} rot={meld.called?.id === t.id} />
      ))}
    </span>
  );
}

/** 牌河 6 列小图(立直宣言牌横置,最新一张描边)。 */
function River({ seat, latest, w = 22 }: { seat: RjSeatPublic; latest: RcTile | null; w?: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, width: (w + 2) * 6 + (w * 88) / 64, minHeight: (w * 88) / 64 }}>
      {seat.river.map((r) => (
        <span key={r.tile.id} style={{
          borderRadius: 4, outline: latest && latest.id === r.tile.id ? `2px solid ${TEAL}` : undefined,
          display: 'inline-flex',
        }}>
          <Tile tile={r.tile} w={w} rot={r.riichi} />
        </span>
      ))}
    </div>
  );
}

/** 8 秒鸣牌倒计时圈。 */
function CountdownRing({ left }: { left: number }) {
  const r = 12, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / CLAIM_WINDOW_S));
  return (
    <svg width={30} height={30} style={{ flexShrink: 0 }}>
      <circle cx={15} cy={15} r={r} fill="none" stroke="rgba(120,150,200,0.25)" strokeWidth={3} />
      <circle
        cx={15} cy={15} r={r} fill="none" stroke={frac < 0.3 ? '#ff6b6b' : '#ffb347'} strokeWidth={3}
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 15 15)" strokeLinecap="round"
      />
      <text x={15} y={19} textAnchor="middle" fontSize={11} fill="#fff">{Math.ceil(left)}</text>
    </svg>
  );
}

/** 对家 / 左右家侧视块:名字风位点数 + 手牌背数 + 副露 + 牌河。 */
function SeatSide({ pub, idx, mySeat }: { pub: RiichiPublic; idx: number; mySeat: number }) {
  const seat = pub.seats[idx];
  const active = (pub.phase === 'playing' || pub.phase === 'claim') && pub.turn === idx;
  return (
    <div className="col" style={{
      gap: 4, padding: 6, borderRadius: 8, minWidth: 150,
      background: 'rgba(120,150,200,0.07)',
      border: active ? `1px solid ${TEAL}` : '1px solid transparent',
    }}>
      <div className="row" style={{ gap: 5, fontSize: 12, flexWrap: 'wrap' }}>
        <b style={{
          width: 18, height: 18, borderRadius: 4, textAlign: 'center', lineHeight: '18px', flexShrink: 0,
          background: idx === pub.dealer ? '#a03030' : 'rgba(120,150,200,0.25)',
        }}>{windOf(seat.seatWind)}</b>
        <span style={{ maxWidth: 84, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {seatName(seat)}{idx === mySeat ? '(我)' : ''}
        </span>
        <span className="dim">{seat.points}</span>
        {seat.riichi && <span style={{ color: '#ff6b6b', fontWeight: 700 }}>立直</span>}
      </div>
      {idx !== mySeat && (
        <div className="row" style={{ gap: 1, flexWrap: 'wrap' }}>
          {Array.from({ length: seat.handCount }).map((_, i) => <Tile key={i} back w={13} />)}
        </div>
      )}
      {seat.melds.length > 0 && (
        <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
          {seat.melds.map((m, i) => <MeldRow key={i} meld={m} w={16} />)}
        </div>
      )}
      <River seat={seat} latest={pub.lastDiscard && pub.lastDiscard.seat === idx ? pub.lastDiscard.tile : null} w={18} />
    </div>
  );
}

/* ── 结算浮层 ─────────────────────────────────────────────────────────────── */
function WinSettleBody({ pub, s }: { pub: RiichiPublic; s: RjWinSettle }) {
  return (
    <>
      <div style={{ fontSize: 17, textAlign: 'center' }}>
        🏆 <b>{seatName(pub.seats[s.winner])}</b>{s.tsumo ? ' 自摸!' : ` 荣和 ${s.from !== null ? seatName(pub.seats[s.from]) : ''}!`}
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
        <span className="dim" style={{ fontSize: 12 }}>和了牌</span>
        <Tile tile={s.winTile} w={30} glow />
      </div>
      <div className="col" style={{ gap: 3, maxWidth: 300, margin: '0 auto', width: '100%' }}>
        {s.yaku.map((y, i) => (
          <div key={i} className="row" style={{ fontSize: 13 }}>
            <span>{y.name}</span>
            <span className="spacer" />
            <b style={{ color: y.yakuman ? '#ffb347' : TEAL }}>{y.yakuman ? '役满' : `${y.han}番`}</b>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 15 }}>
        <b>{s.han}番 {s.fu}符</b>{s.label && <b style={{ color: '#ffb347' }}> · {s.label}</b>}
        <b style={{ color: TEAL }}> · {s.total} 点</b>
      </div>
      {s.uraIndicators.length > 0 && (
        <div className="row" style={{ justifyContent: 'center', gap: 3 }}>
          <span className="dim" style={{ fontSize: 12 }}>里宝牌指示</span>
          {s.uraIndicators.map((f, i) => <Tile key={i} face={f} w={22} />)}
        </div>
      )}
    </>
  );
}

function DrawSettleBody({ pub, s }: { pub: RiichiPublic; s: RjDrawSettle }) {
  return (
    <>
      <div style={{ fontSize: 17, textAlign: 'center' }}><b>荒牌流局</b></div>
      <div className="col" style={{ gap: 3, maxWidth: 300, margin: '0 auto', width: '100%' }}>
        {pub.seats.map((seat, i) => (
          <div key={i} className="row" style={{ fontSize: 13 }}>
            <span>{windOf(seat.seatWind)} · {seatName(seat)}</span>
            <span className="spacer" />
            <span style={{ color: s.tenpai[i] ? TEAL : undefined }} className={s.tenpai[i] ? '' : 'dim'}>
              {s.tenpai[i] ? '听牌' : '未听'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── 主面板 ───────────────────────────────────────────────────────────────── */
export default function RiichiPanel({ tableId }: { tableId: string }) {
  const view = useWorld((s) => s.rj[tableId]);
  const [, force] = useState(0);
  const [selId, setSelId] = useState<number | null>(null);
  const [riichiMode, setRiichiMode] = useState(false);
  const [kanMode, setKanMode] = useState(false);
  const [chiOpen, setChiOpen] = useState(false);
  const [ponOpen, setPonOpen] = useState(false);
  const [settleSeen, setSettleSeen] = useState('');

  // 倒计时 / 服务器摸打的界面刷新
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(iv);
  }, []);

  const priv = view?.priv ?? null;
  const actKey = priv
    ? `${priv.actions.discard}:${priv.actions.pass}:${priv.hand.map((t) => t.id).join(',')}`
    : '';
  // 手牌 / 可行动作变化时清掉本地选择态
  useEffect(() => {
    setSelId(null);
    setRiichiMode(false);
    setKanMode(false);
    setChiOpen(false);
    setPonOpen(false);
  }, [actKey]);

  const settleKey = useMemo(
    () => (view?.pub.settle ? JSON.stringify(view.pub.settle) : ''),
    [view?.pub.settle]
  );

  if (!view) return <div className="dim">牌桌不见了……</div>;
  const { pub } = view;
  const mySeat = priv?.mySeat ?? -1;
  const seated = mySeat !== -1;
  const base = seated ? mySeat : 0;
  const across = (base + 2) % 4, left = (base + 3) % 4, right = (base + 1) % 4;
  const mySeatPub = seated ? pub.seats[mySeat] : null;
  const inHand = pub.phase === 'playing' || pub.phase === 'claim';

  const send = (action: string, extra?: { tileId?: number; meld?: number[] }) => {
    audio.click();
    connection.send('rj_action', { tableId, action, ...extra });
  };

  const a = priv?.actions ?? null;
  const claimLeft = pub.claimDeadline !== null
    ? Math.max(0, (pub.claimDeadline - serverNow()) / 1000)
    : null;
  const claimTileId = pub.lastDiscard?.tile.id ?? -1;
  const inClaim = !!a?.pass;
  const canDiscard = !!a?.discard;
  const declared = !!mySeatPub?.riichi;

  // 自摸牌与其余手牌分离展示
  const handTiles = priv ? priv.hand.filter((t) => t.id !== priv.drawn?.id) : [];
  const drawnTile = priv?.drawn ?? null;

  const clickHand = (t: RcTile) => {
    if (!canDiscard) return;
    if (riichiMode) {
      if (a && a.riichiFaces.includes(t.face)) send('riichi', { tileId: t.id });
      return;
    }
    if (selId === t.id) { send('discard', { tileId: t.id }); setSelId(null); }
    else { setSelId(t.id); audio.click(); }
  };

  const meldOwnIds = (m: RcMeld) => m.tiles.filter((t) => t.id !== claimTileId).map((t) => t.id);

  // 自家杠(暗/加杠)候选:每个 face 取一张手牌代表
  const kanChoices: RcTile[] = a
    ? [...a.ankanFaces, ...a.kakanFaces].map((f) => priv!.hand.find((t) => t.face === f)).filter((t): t is RcTile => !!t)
    : [];

  const settleShown = pub.phase === 'finished' && pub.settle !== null && settleKey !== settleSeen;

  return (
    <div className="col" style={{ gap: 8, position: 'relative', minWidth: 560 }}>
      {/* ── 对家 ── */}
      <div className="row" style={{ justifyContent: 'center' }}>
        <SeatSide pub={pub} idx={across} mySeat={mySeat} />
      </div>

      {/* ── 左家 | 中央信息盘 | 右家 ── */}
      <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
        <SeatSide pub={pub} idx={left} mySeat={mySeat} />
        <div className="col spacer" style={{
          gap: 5, alignItems: 'center', padding: '10px 6px', borderRadius: 10,
          background: 'rgba(46,125,79,0.14)', border: '1px solid rgba(120,150,200,0.2)', alignSelf: 'stretch',
          justifyContent: 'center',
        }}>
          <div style={{ fontSize: 16 }}>
            <b>{windOf(pub.roundWind)}{pub.kyoku + 1}局</b>
            <span className="dim"> · {pub.honba}本场</span>
          </div>
          <div className="dim" style={{ fontSize: 12 }}>
            供托 {pub.riichiSticks} · 余牌 {pub.wallCount}
          </div>
          <div className="row" style={{ gap: 3 }}>
            <span className="dim" style={{ fontSize: 12 }}>宝牌指示</span>
            {pub.doraIndicators.map((f, i) => <Tile key={i} face={f} w={22} />)}
            {pub.doraIndicators.length === 0 && <span className="dim" style={{ fontSize: 12 }}>—</span>}
          </div>
          {inHand && (
            <div style={{ fontSize: 12, color: TEAL }}>
              轮到:{windOf(pub.seats[pub.turn].seatWind)} · {seatName(pub.seats[pub.turn])}
            </div>
          )}
          {pub.phase === 'idle' && <div className="dim" style={{ fontSize: 12 }}>等待开局</div>}
          {pub.gameOver && <div style={{ fontSize: 12, color: '#ffb347' }}>东风战终局</div>}
        </div>
        <SeatSide pub={pub} idx={right} mySeat={mySeat} />
      </div>

      {/* ── 自家:名字行 + 牌河 + 副露 ── */}
      {seated && mySeatPub && (
        <div className="col" style={{
          gap: 4, padding: 6, borderRadius: 8,
          background: 'rgba(120,150,200,0.07)',
          border: inHand && pub.turn === mySeat ? `1px solid ${TEAL}` : '1px solid transparent',
        }}>
          <div className="row" style={{ gap: 5, fontSize: 12 }}>
            <b style={{
              width: 18, height: 18, borderRadius: 4, textAlign: 'center', lineHeight: '18px',
              background: mySeat === pub.dealer ? '#a03030' : 'rgba(120,150,200,0.25)',
            }}>{windOf(mySeatPub.seatWind)}</b>
            <span>{seatName(mySeatPub)}(我)</span>
            <span className="dim">{mySeatPub.points}</span>
            {declared && <span style={{ color: '#ff6b6b', fontWeight: 700 }}>立直 · 自动摸切</span>}
            <span className="spacer" />
            {priv && priv.waits.length > 0 && (
              <span className="row" style={{ gap: 2 }}>
                <span className="dim">听:</span>
                {priv.waits.map((f) => <Tile key={f} face={f} w={16} />)}
              </span>
            )}
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <River seat={mySeatPub} latest={pub.lastDiscard && pub.lastDiscard.seat === mySeat ? pub.lastDiscard.tile : null} w={20} />
            {mySeatPub.melds.length > 0 && (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginLeft: 'auto' }}>
                {mySeatPub.melds.map((m, i) => <MeldRow key={i} meld={m} w={22} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 自家手牌(自摸牌右侧分离) ── */}
      {seated && priv && priv.hand.length > 0 && (
        <div className="row rj-hand" style={{ gap: 3, flexWrap: 'wrap', paddingTop: 10, opacity: declared ? 0.55 : 1 }}>
          {handTiles.map((t) => (
            <Tile
              key={t.id} tile={t} w={38}
              raised={selId === t.id}
              glow={riichiMode && !!a && a.riichiFaces.includes(t.face)}
              dim={riichiMode && (!a || !a.riichiFaces.includes(t.face))}
              onClick={canDiscard ? () => clickHand(t) : undefined}
            />
          ))}
          {drawnTile && (
            <span style={{ marginLeft: 14, display: 'inline-flex' }}>
              <Tile
                tile={drawnTile} w={38}
                raised={selId === drawnTile.id}
                glow={riichiMode && !!a && a.riichiFaces.includes(drawnTile.face)}
                dim={riichiMode && (!a || !a.riichiFaces.includes(drawnTile.face))}
                onClick={canDiscard ? () => clickHand(drawnTile) : undefined}
              />
            </span>
          )}
        </div>
      )}

      {/* ── 行动条 ── */}
      {seated && a && (inClaim || canDiscard) && (
        <div className="col" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {inClaim && claimLeft !== null && <CountdownRing left={claimLeft} />}
            {a.tsumo && <button className="btn primary" onClick={() => send('tsumo')}>自摸!</button>}
            {a.ron && <button className="btn primary" onClick={() => send('ron')}>荣!</button>}
            {a.kan && inClaim && <button className="btn" onClick={() => send('kan')}>杠</button>}
            {a.pon.length > 0 && (
              <button className="btn" onClick={() => {
                if (a.pon.length === 1) send('pon', { meld: meldOwnIds(a.pon[0]) });
                else { setPonOpen(!ponOpen); setChiOpen(false); }
              }}>碰</button>
            )}
            {a.chi.length > 0 && (
              <button className="btn" onClick={() => {
                if (a.chi.length === 1) send('chi', { meld: meldOwnIds(a.chi[0]) });
                else { setChiOpen(!chiOpen); setPonOpen(false); }
              }}>吃</button>
            )}
            {canDiscard && a.riichiFaces.length > 0 && (
              <button
                className={`btn ${riichiMode ? 'primary' : ''}`}
                onClick={() => { setRiichiMode(!riichiMode); setKanMode(false); setSelId(null); audio.click(); }}
              >
                {riichiMode ? '取消立直' : '立直!'}
              </button>
            )}
            {canDiscard && kanChoices.length > 0 && (
              <button className={`btn ${kanMode ? 'primary' : ''}`} onClick={() => { setKanMode(!kanMode); setRiichiMode(false); audio.click(); }}>
                杠
              </button>
            )}
            {a.pass && <button className="btn ghost" onClick={() => send('pass')}>过</button>}
            {canDiscard && selId !== null && !riichiMode && (
              <button className="btn primary" onClick={() => { send('discard', { tileId: selId }); setSelId(null); }}>确认切出</button>
            )}
            <span className="dim" style={{ fontSize: 12, alignSelf: 'center' }}>
              {riichiMode
                ? '选择高亮的宣言牌打出(立直供托 1000 点)'
                : canDiscard && selId === null ? '点选手牌浮起,再点一次(或按确认)切出' : ''}
            </span>
          </div>
          {/* 吃/碰组合选择(红5 区分) */}
          {(chiOpen || ponOpen) && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {(chiOpen ? a.chi : a.pon).map((m, i) => (
                <button
                  key={i} className="btn"
                  style={{ display: 'flex', gap: 2, padding: 4 }}
                  onClick={() => send(chiOpen ? 'chi' : 'pon', { meld: meldOwnIds(m) })}
                >
                  {m.tiles.map((t) => <Tile key={t.id} tile={t} w={24} />)}
                </button>
              ))}
            </div>
          )}
          {/* 暗杠 / 加杠选择 */}
          {kanMode && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {kanChoices.map((t) => (
                <button key={t.id} className="btn" style={{ display: 'flex', gap: 4, padding: 4, alignItems: 'center' }} onClick={() => send('kan', { tileId: t.id })}>
                  <Tile tile={t} w={24} /> <span style={{ fontSize: 12 }}>{rcTileName(t.face)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 入座 / 开局 / 离席 ── */}
      <div className="row" style={{ gap: 8 }}>
        {!seated && !inHand && <button className="btn primary" onClick={() => send('sit')}>入座</button>}
        {!seated && inHand && pub.seats.some((s) => s.botName && !s.profile) && (
          <button className="btn primary" onClick={() => send('sit')}>顶替机器人</button>
        )}
        {seated && !inHand && (
          <button className="btn primary" onClick={() => send('start')}>
            {pub.gameOver || pub.phase === 'idle' ? '开局(空位由🤖陪打)' : '下一局'}
          </button>
        )}
        {seated && <button className="btn ghost" onClick={() => send('leave')}>离席</button>}
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 11 }}>四人东风战 · 吃碰杠 / 立直 / 宝牌·里宝 · 缺人🤖陪打</span>
      </div>

      {/* ── 结算浮层 ── */}
      {settleShown && pub.settle && (
        <div style={{
          position: 'absolute', inset: -6, borderRadius: 12, zIndex: 5,
          background: 'rgba(10,14,24,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="col" style={{ gap: 10, padding: 18, width: '100%', maxWidth: 420 }}>
            {pub.settle.type === 'win'
              ? <WinSettleBody pub={pub} s={pub.settle} />
              : <DrawSettleBody pub={pub} s={pub.settle} />}
            <div className="col" style={{ gap: 3, maxWidth: 300, margin: '0 auto', width: '100%' }}>
              {pub.settle.payments.map((p, i) => (
                <div key={i} className="row" style={{ fontSize: 13 }}>
                  <span>{seatName(pub.seats[p.seat])}</span>
                  <span className="spacer" />
                  <b style={{ color: p.delta >= 0 ? TEAL : '#ff6b6b' }}>{p.delta >= 0 ? `+${p.delta}` : p.delta}</b>
                </div>
              ))}
            </div>
            {pub.gameOver && (
              <div style={{ textAlign: 'center', fontSize: 14, color: '#ffb347' }}>
                🏁 东风战终局:{[...pub.seats].map((s, i) => ({ s, i })).sort((x, y) => y.s.points - x.s.points)
                  .map(({ s }, rank) => `${rank + 1}位 ${seatName(s)} ${s.points}`).join(' · ')}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <button className="btn primary" onClick={() => { setSettleSeen(settleKey); audio.click(); }}>确认</button>
              {seated && <button className="btn" onClick={() => { setSettleSeen(settleKey); send('start'); }}>
                {pub.gameOver ? '再来一战' : '下一局'}
              </button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
