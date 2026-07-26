/** All interaction panels: media, jukebox, boards, games, shopping, elevator,
 *  books, inventory, notes, storage. Each is fully wired to the server. */
import { useEffect, useMemo, useState } from 'react';
import { useWorld, useSession, useUI, inventoryCount } from '../state/stores';
import { connection } from '../net/connection';
import { audio } from '../audio/engine';
import { hot } from '../state/hot';
import {
  TRACKS, ITEMS_BY_ID, FURNITURE, isRoomSpace, roomSpaceKey, HOLD_ITEM_DURATION_MS,
  BOARD_POST_MAX_LEN, NOTES_MAX_LEN,
} from '@nexuspark/shared';
import { BOOKS } from './books';
import { mediaRuntime } from '../world3d/media/runtime';

/* ─── Media ──────────────────────────────────────────────────────────────── */
/** Draggable seek bar fed by the LOCAL player (duration/pos read from the
 *  local video element / YouTube API — the server only relays tiny control
 *  messages, it never streams media). */
function SeekBar({ playing }: { playing: boolean }) {
  const [now, setNow] = useState({ cur: mediaRuntime.current, dur: mediaRuntime.duration });
  const [dragging, setDragging] = useState<number | null>(null);
  useEffect(() => {
    const iv = setInterval(() => setNow({ cur: mediaRuntime.current, dur: mediaRuntime.duration }), 400);
    return () => clearInterval(iv);
  }, []);
  if (!now.dur || now.dur <= 0) return null;
  const value = dragging ?? now.cur;
  return (
    <div className="row" style={{ width: '100%' }}>
      <span className="dim" style={{ fontSize: 11, width: 40 }}>{fmtTime(value)}</span>
      <input
        type="range" className="seek" min={0} max={now.dur} step={0.5} value={Math.min(value, now.dur)}
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={() => {
          if (dragging !== null) {
            connection.send('media_ctrl', { op: 'seek', value: dragging });
            setDragging(null);
          }
        }}
        onKeyUp={(e) => {
          if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && dragging !== null) {
            connection.send('media_ctrl', { op: 'seek', value: dragging });
            setDragging(null);
          }
        }}
      />
      <span className="dim" style={{ fontSize: 11, width: 40 }}>{fmtTime(now.dur)}</span>
      <span style={{ fontSize: 11 }}>{playing ? '▶' : '⏸'}</span>
    </div>
  );
}

export function MediaPanel() {
  const media = useWorld((s) => s.media);
  const room = useWorld((s) => s.room);
  const spaceKey = useWorld((s) => s.spaceKey);
  const self = useSession((s) => s.self);
  const [url, setUrl] = useState('');
  const [loop, setLoop] = useState(false);
  const canControl = !isRoomSpace(spaceKey)
    || !room
    || room.ownerId === self?.userId
    || room.mediaControl === 'guests';
  const isTimed = media?.kind === 'video' || media?.kind === 'youtube';

  const position = useMemo(() => {
    if (!media?.url) return 0;
    return media.playing
      ? media.position + ((Date.now() + hot.serverTimeOffset - media.updatedAt) / 1000) * media.rate
      : media.position;
  }, [media]);

  return (
    <div className="col">
      <div className="dim" style={{ fontSize: 13 }}>
        {media?.url ? (
          <>
            Now showing (<b>{media.kind}</b>): <span style={{ wordBreak: 'break-all' }}>{media.url}</span>
            <br />set by <b>{media.setBy ?? '—'}</b>
          </>
        ) : (
          'Nothing on screen. Put a website, YouTube link, or video file URL up for everyone in this space.'
        )}
      </div>
      {!canControl && (
        <div className="dim">🔒 Only the room owner ({room?.ownerName}) can control this screen.</div>
      )}
      {canControl && (
        <>
          <div className="row">
            <input
              className="input"
              placeholder="https://… (website, YouTube, or .mp4/.webm)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim()) {
                  connection.send('media_set', { url: url.trim(), loop });
                  setUrl('');
                }
              }}
            />
            <button
              className="btn primary"
              disabled={!url.trim()}
              onClick={() => { connection.send('media_set', { url: url.trim(), loop }); setUrl(''); }}
            >
              Show
            </button>
          </div>
          <label className="row dim" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            loop videos
          </label>
          {media?.url && isTimed && <SeekBar playing={media.playing} />}
          {media?.url && isTimed && (
            <div className="media-controls">
              <button className="btn small" onClick={() => connection.send('media_ctrl', { op: media.playing ? 'pause' : 'play' })}>
                {media.playing ? '⏸ Pause' : '▶ Play'}
              </button>
              {[-30, -5, 5, 30].map((d) => (
                <button key={d} className="btn small" onClick={() => connection.send('media_ctrl', { op: 'seek', value: Math.max(0, position + d) })}>
                  {d > 0 ? `+${d}s` : `${d}s`}
                </button>
              ))}
              <select
                className="input" style={{ width: 84 }}
                value={media.rate}
                onChange={(e) => connection.send('media_ctrl', { op: 'rate', value: Number(e.target.value) })}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
              </select>
              <span className="dim" style={{ fontSize: 12 }}>{fmtTime(position)}</span>
            </div>
          )}
          {media?.url && (
            <button className="btn small danger" style={{ alignSelf: 'flex-start' }} onClick={() => connection.send('media_ctrl', { op: 'clear' })}>
              Clear screen
            </button>
          )}
        </>
      )}
      <div className="dim" style={{ fontSize: 11 }}>
        Sites that forbid embedding (X-Frame-Options) will stay blank — that's the site's choice, not a bug.
        Everyone in the space sees the same screen; videos stay in sync.
      </div>
    </div>
  );
}
const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/* ─── Jukebox ────────────────────────────────────────────────────────────── */
export function JukeboxPanel() {
  const music = useWorld((s) => s.music);
  return (
    <div className="col">
      <div className="dim" style={{ fontSize: 13 }}>
        Synth jukebox — everyone in this space hears the same beat, in sync.
        {music?.trackId && <> Now playing: <b>{TRACKS.find((t) => t.id === music.trackId)?.name}</b> (queued by {music.setBy})</>}
      </div>
      {TRACKS.map((t) => (
        <div key={t.id} className="row">
          <span style={{ width: 130 }}>{t.name}</span>
          <span className="dim" style={{ fontSize: 12 }}>{t.bpm} bpm</span>
          <div className="spacer" />
          <button
            className={`btn small ${music?.trackId === t.id ? 'primary' : ''}`}
            onClick={() => connection.send('music_set', { trackId: t.id })}
          >
            {music?.trackId === t.id ? '▶ Playing' : 'Play'}
          </button>
        </div>
      ))}
      <button className="btn small ghost" disabled={!music?.trackId} onClick={() => connection.send('music_set', { trackId: null })}>
        ⏹ Stop music
      </button>
    </div>
  );
}

/* ─── Message board ──────────────────────────────────────────────────────── */
export function BoardPanel({ boardId }: { boardId: string }) {
  const posts = useWorld((s) => s.boards[boardId]) ?? [];
  const room = useWorld((s) => s.room);
  const self = useSession((s) => s.self);
  const [text, setText] = useState('');
  const canDelete = (userId: number) => userId === self?.userId || (room && room.ownerId === self?.userId);
  return (
    <div className="col">
      <div className="row">
        <input
          className="input" placeholder="Pin a note…" value={text} maxLength={BOARD_POST_MAX_LEN}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { connection.send('board_post', { boardId, text: text.trim() }); setText(''); } }}
        />
        <button className="btn primary" disabled={!text.trim()} onClick={() => { connection.send('board_post', { boardId, text: text.trim() }); setText(''); }}>
          Pin
        </button>
      </div>
      <div className="col" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {posts.length === 0 && <div className="dim">No notes yet — be the first!</div>}
        {posts.map((p) => (
          <div key={p.id} className="inv-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12 }} className="dim">{p.username} · {new Date(p.createdAt).toLocaleDateString()}</div>
              <div style={{ fontSize: 13 }}>{p.text}</div>
            </div>
            {canDelete(p.userId) && (
              <button className="btn small ghost" onClick={() => connection.send('board_delete', { boardId, postId: p.id })}>✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Tic-tac-toe ────────────────────────────────────────────────────────── */
export function TttPanel({ machineId }: { machineId: string }) {
  const game = useWorld((s) => s.ttt[machineId]);
  const selfId = hot.selfId;
  if (!game) return <div className="dim">Machine offline.</div>;
  const meIdx = game.players[0]?.id === selfId ? 1 : game.players[1]?.id === selfId ? 2 : 0;
  const myTurn = meIdx !== 0 && game.turn === meIdx && game.winner === 0 && game.players[0] && game.players[1];
  const seated = meIdx !== 0;
  return (
    <div className="col" style={{ alignItems: 'center' }}>
      <div className="dim" style={{ fontSize: 13 }}>
        ❌ {game.players[0]?.username ?? 'open seat'} vs ⭕ {game.players[1]?.username ?? 'open seat'}
      </div>
      <div className="ttt-grid">
        {game.board.map((cell, i) => (
          <button
            key={i}
            className="btn ttt-cell"
            disabled={!myTurn || cell !== 0}
            onClick={() => connection.send('game_move', { machineId, cell })}
          >
            {cell === 1 ? '✕' : cell === 2 ? '◯' : ''}
          </button>
        ))}
      </div>
      <div style={{ minHeight: 22, fontSize: 14 }}>
        {game.winner === 0 && game.players[0] && game.players[1] && (
          <span>{myTurn ? 'Your move!' : `${game.turn === 1 ? game.players[0]?.username : game.players[1]?.username} is thinking…`}</span>
        )}
        {game.winner === 0 && (!game.players[0] || !game.players[1]) && <span className="dim">Waiting for players…</span>}
        {game.winner === 3 && <b>It's a draw!</b>}
        {(game.winner === 1 || game.winner === 2) && (
          <b>{game.winner === meIdx ? '🎉 You win!' : `${(game.winner === 1 ? game.players[0] : game.players[1])?.username} wins!`}</b>
        )}
      </div>
      <div className="row">
        {!seated && <button className="btn primary" onClick={() => connection.send('game_join', { machineId })}>Take a seat</button>}
        {seated && game.winner !== 0 && <button className="btn primary" onClick={() => connection.send('game_join', { machineId })}>Play again</button>}
        {seated && <button className="btn ghost" onClick={() => connection.send('game_leave', { machineId })}>Leave game</button>}
      </div>
    </div>
  );
}

/* ─── Lights Out ─────────────────────────────────────────────────────────── */
export function LightsOutPanel({ machineId }: { machineId: string }) {
  const game = useWorld((s) => s.lo[machineId]);
  const selfId = hot.selfId;
  if (!game) return <div className="dim">Machine offline.</div>;
  const mine = game.playerId === selfId;
  return (
    <div className="col" style={{ alignItems: 'center' }}>
      <div className="dim" style={{ fontSize: 13 }}>
        Turn every light off. Pressing a cell toggles it and its neighbours.
        {game.best !== null && <> · Record: <b>{game.best} moves</b></>}
      </div>
      <div className="lo-grid">
        {game.grid.map((on, i) => (
          <div
            key={i}
            className={`lo-cell ${on ? 'on' : ''}`}
            onClick={() => { if (mine) connection.send('game_move', { machineId, cell: i }); }}
          />
        ))}
      </div>
      <div style={{ minHeight: 20, fontSize: 13 }}>
        {game.playerId === null && <span className="dim">Free machine — start a puzzle!</span>}
        {mine && <span>Moves: <b>{game.moves}</b></span>}
        {game.playerId !== null && !mine && <span className="dim">{game.playerName} is playing (moves: {game.moves})</span>}
      </div>
      <div className="row">
        {!mine && game.playerId === null && (
          <button className="btn primary" onClick={() => connection.send('game_join', { machineId })}>Start puzzle</button>
        )}
        {mine && (
          <>
            <button className="btn" onClick={() => connection.send('game_join', { machineId })}>New puzzle</button>
            <button className="btn ghost" onClick={() => connection.send('game_leave', { machineId })}>Walk away</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Vending machine ────────────────────────────────────────────────────── */
export function VendingPanel({ vendId, items }: { vendId: string; items: string[] }) {
  const self = useSession((s) => s.self);
  return (
    <div className="col">
      <div className="dim" style={{ fontSize: 13 }}>Credits: <b>{self?.credits ?? 0}</b></div>
      {items.map((id) => {
        const item = ITEMS_BY_ID[id];
        if (!item) return null;
        return (
          <div key={id} className="inv-row">
            <span style={{ fontSize: 22 }}>{item.icon}</span>
            <span style={{ flex: 1 }}>{item.name}</span>
            <span className="dim">{item.price} cr</span>
            <button
              className="btn small primary"
              disabled={(self?.credits ?? 0) < item.price}
              onClick={() => { connection.send('buy', { itemId: id, source: vendId }); audio.vend(); }}
            >
              Buy
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Furniture kiosk ────────────────────────────────────────────────────── */
export function KioskPanel() {
  const self = useSession((s) => s.self);
  const premium = FURNITURE.filter((f) => f.price > 0);
  return (
    <div className="col">
      <div className="dim" style={{ fontSize: 13 }}>
        One-time unlocks for your room. Free furniture is always available in the room editor.
        Credits: <b>{self?.credits ?? 0}</b>
      </div>
      <div className="cat-grid">
        {premium.map((f) => {
          const owned = self?.unlocks.includes(f.type);
          return (
            <div key={f.type} className={`cat-item ${owned ? 'locked' : ''}`}>
              <span className="ico">🛋️</span>
              <div>{f.name}</div>
              {owned ? (
                <div className="dim" style={{ marginTop: 4 }}>✓ owned</div>
              ) : (
                <button
                  className="btn small primary" style={{ marginTop: 6 }}
                  disabled={(self?.credits ?? 0) < f.price}
                  onClick={() => connection.send('unlock_furniture', { type: f.type })}
                >
                  {f.price} cr
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Elevator directory ─────────────────────────────────────────────────── */
export function ElevatorPanel() {
  const rooms = useWorld((s) => s.roomDir);
  const self = useSession((s) => s.self);
  const ui = useUI.getState();
  useEffect(() => {
    const iv = setInterval(() => connection.send('elevator_list', {}), 5000);
    return () => clearInterval(iv);
  }, []);
  const go = (ownerId: number) => {
    ui.closePanel();
    ui.setFade(true);
    audio.doorSlide();
    setTimeout(() => connection.send('switch_space', { target: roomSpaceKey(ownerId) }), 260);
  };
  return (
    <div className="col">
      <div className="dim" style={{ fontSize: 13 }}>Pick a floor — every resident has a room.</div>
      <div className="col" style={{ maxHeight: 340, overflowY: 'auto' }}>
        {rooms.map((r) => (
          <div key={r.ownerId} className="inv-row">
            <span style={{ fontSize: 18 }}>{r.ownerId === self?.userId ? '🏠' : '🚪'}</span>
            <div style={{ flex: 1 }}>
              <div>{r.name}</div>
              <div className="dim" style={{ fontSize: 11 }}>
                {r.ownerName}{r.ownerId === self?.userId ? ' (you)' : ''} · {r.online > 0 ? `${r.online} inside` : 'empty'}
                {r.visibility === 'private' ? ' · private' : ''}
              </div>
            </div>
            <button className="btn small primary" onClick={() => go(r.ownerId)}>Visit</button>
          </div>
        ))}
        {rooms.length === 0 && <div className="dim">Loading directory…</div>}
      </div>
    </div>
  );
}

/* ─── Books ──────────────────────────────────────────────────────────────── */
export function BooksPanel() {
  const [bookId, setBookId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const book = BOOKS.find((b) => b.id === bookId);
  if (book) {
    const pages = book.pages;
    return (
      <div className="col">
        <div className="row">
          <button className="btn small ghost" onClick={() => { setBookId(null); setPage(0); }}>← Shelf</button>
          <span className="title">{book.title}</span>
        </div>
        <div className="dim" style={{ fontSize: 11 }}>{book.attribution}</div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.65, minHeight: 220, maxHeight: 320, overflowY: 'auto' }}>
          {pages[page]}
        </div>
        <div className="row">
          <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="dim" style={{ fontSize: 12 }}>page {page + 1} / {pages.length}</span>
          <button className="btn small" disabled={page >= pages.length - 1} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      </div>
    );
  }
  return (
    <div className="col">
      {BOOKS.map((b) => (
        <div key={b.id} className="inv-row" style={{ cursor: 'pointer' }} onClick={() => setBookId(b.id)}>
          <span style={{ fontSize: 20 }}>📕</span>
          <div style={{ flex: 1 }}>
            <div>{b.title}</div>
            <div className="dim" style={{ fontSize: 11 }}>{b.subtitle}</div>
          </div>
          <span className="dim">read →</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Inventory ──────────────────────────────────────────────────────────── */
export function InventoryPanel() {
  const self = useSession((s) => s.self);
  if (!self) return null;
  const entries = self.inventory.filter((e) => e.qty > 0);
  return (
    <div className="col">
      <div className="dim" style={{ fontSize: 13 }}>Credits: <b>{self.credits}</b> · daily bonus on first login each day</div>
      {entries.length === 0 && <div className="dim">Empty. Vending machines are in the shop, arcade, lobby and cinema.</div>}
      {entries.map((e) => {
        const item = ITEMS_BY_ID[e.itemId];
        if (!item) return null;
        return (
          <div key={e.itemId} className="inv-row">
            <span style={{ fontSize: 22 }}>{item.icon}</span>
            <span style={{ flex: 1 }}>{item.name}</span>
            <span className="dim">×{e.qty}</span>
            {item.heldId !== undefined && (
              <button
                className="btn small primary"
                onClick={() => {
                  connection.send('use_item', { itemId: e.itemId });
                  hot.local.held = item.heldId!;
                  hot.local.heldUntil = performance.now() + HOLD_ITEM_DURATION_MS;
                  connection.sendInput(true);
                  audio.chime(true);
                }}
              >
                {item.kind === 'consumable' ? 'Enjoy' : 'Hold'}
              </button>
            )}
          </div>
        );
      })}
      {hot.local.held !== 0 && (
        <button className="btn small ghost" onClick={() => { hot.local.held = 0; hot.local.heldUntil = 0; connection.sendInput(true); }}>
          Put item away
        </button>
      )}
    </div>
  );
}

/* ─── Computer notes ─────────────────────────────────────────────────────── */
export function NotesPanel() {
  const room = useWorld((s) => s.room);
  const self = useSession((s) => s.self);
  const isOwner = room?.ownerId === self?.userId;
  const [text, setText] = useState(room?.notes ?? '');
  const [saved, setSaved] = useState(true);
  useEffect(() => { setText(room?.notes ?? ''); setSaved(true); }, [room?.notes]);
  if (!room) return null;
  return (
    <div className="col">
      <div className="dim" style={{ fontSize: 13 }}>
        {isOwner ? 'Your in-world notes — shown on the computer screen.' : `${room.ownerName}'s notes:`}
      </div>
      <textarea
        className="input" rows={9} value={text} maxLength={NOTES_MAX_LEN}
        readOnly={!isOwner}
        onChange={(e) => { setText(e.target.value); setSaved(false); }}
      />
      {isOwner && (
        <button
          className="btn primary" disabled={saved}
          onClick={() => { connection.send('room_edit', { op: 'notes', text }); setSaved(true); }}
        >
          {saved ? 'Saved ✓' : 'Save notes'}
        </button>
      )}
    </div>
  );
}

/* ─── Wardrobe storage ───────────────────────────────────────────────────── */
export function StoragePanel({ objectId }: { objectId: number }) {
  const room = useWorld((s) => s.room);
  const self = useSession((s) => s.self);
  const obj = room?.objects.find((o) => o.id === objectId);
  const isOwner = room?.ownerId === self?.userId;
  const stash = (obj?.state.stash ?? {}) as Record<string, number>;
  if (!obj) return <div className="dim">The wardrobe is gone.</div>;
  if (!isOwner) return <div className="dim">It's not polite to rummage in someone else's wardrobe.</div>;
  const stashEntries = Object.entries(stash).filter(([, q]) => q > 0);
  const invEntries = (self?.inventory ?? []).filter((e) => e.qty > 0);
  return (
    <div className="grid2">
      <div className="col">
        <div className="title" style={{ fontSize: 13 }}>Wardrobe</div>
        {stashEntries.length === 0 && <div className="dim" style={{ fontSize: 12 }}>Empty shelves.</div>}
        {stashEntries.map(([id, q]) => (
          <div key={id} className="inv-row">
            <span>{ITEMS_BY_ID[id]?.icon}</span>
            <span style={{ flex: 1, fontSize: 13 }}>{ITEMS_BY_ID[id]?.name} ×{q}</span>
            <button className="btn small" onClick={() => connection.send('stash', { objectId, itemId: id, dir: 'toInventory' })}>Take →</button>
          </div>
        ))}
      </div>
      <div className="col">
        <div className="title" style={{ fontSize: 13 }}>Your pockets</div>
        {invEntries.length === 0 && <div className="dim" style={{ fontSize: 12 }}>Nothing to store.</div>}
        {invEntries.map((e) => (
          <div key={e.itemId} className="inv-row">
            <span>{ITEMS_BY_ID[e.itemId]?.icon}</span>
            <span style={{ flex: 1, fontSize: 13 }}>{ITEMS_BY_ID[e.itemId]?.name} ×{e.qty}</span>
            <button className="btn small" onClick={() => connection.send('stash', { objectId, itemId: e.itemId, dir: 'toStash' })}>← Store</button>
          </div>
        ))}
      </div>
    </div>
  );
}
export { inventoryCount };
