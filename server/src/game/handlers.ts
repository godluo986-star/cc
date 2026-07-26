import type { World } from './world';
import type { Session } from './session';
import { send, profileOf } from './session';
import type { Space, TttInternal, LoInternal } from './space';
import {
  MAX_VALID_SPEED, clampToBounds, resolveCollisions, floorHeightAt, PLAYER_RADIUS,
  WHITEBOARD_MAX_STROKES, BOARD_MAX_POSTS, ITEMS_BY_ID, FURNITURE_BY_TYPE, TRACK_IDS,
  dist2d, isRoomSpace, SPACE, unpackState, Anim, packState,
} from '@nexuspark/shared';
import type { C2SPayload, Stroke, ChatMsg } from '@nexuspark/shared';
import {
  addRoomObject, moveRoomObject, recolorRoomObject, removeRoomObject,
  setRoomObjectState, saveRoomMeta, listDirectory,
} from './roomService';
import { resolveDialogueNode } from './dialogues';
import { kvSet } from '../db/database';

const toast = (s: Session, level: 'info' | 'warn' | 'error', text: string) => send(s, 'toast', { level, text });

function space(world: World, s: Session): Space | null {
  return world.spaces.get(s.spaceKey) ?? null;
}

/** Find an interactable of one of `kinds` by id, and verify the player is near it. */
function nearInteractable(sp: Space, s: Session, id: string, kinds: string[], range = 5): ReturnType<Space['findInteractable']> {
  const it = sp.findInteractable(id);
  if (!it || !kinds.includes(it.kind)) return null;
  if (!sp.isNear(s, it.pos[0], it.pos[2], range)) return null;
  return it;
}

function canControlMedia(sp: Space, s: Session): boolean {
  if (sp.isRoom) {
    const room = sp.roomData!;
    return room.ownerId === s.user.id || room.mediaControl === 'guests';
  }
  return sp.hasScreen; // public screens: everyone (rate-limited)
}

function broadcastMedia(sp: Space): void {
  sp.saveMedia();
  sp.broadcast('media_state', sp.media);
}

const VIDEO_FILE_RE = /\.(mp4|webm|ogv|ogg|mov|m3u8)$/i;
function classifyMediaUrl(raw: string): { kind: 'video' | 'youtube' | 'site'; url: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const id = extractYouTubeId(u);
    if (!id) return null;
    return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}` };
  }
  if (VIDEO_FILE_RE.test(u.pathname)) return { kind: 'video', url: u.toString() };
  // Anything else is embedded as a website (legal iframe embedding; sites
  // that disallow framing will refuse to render and the panel explains it).
  return { kind: 'site', url: u.toString() };
}
function extractYouTubeId(u: URL): string | null {
  const ID = /^[A-Za-z0-9_-]{8,15}$/;
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return ID.test(id) ? id : null;
  }
  const v = u.searchParams.get('v');
  if (v && ID.test(v)) return v;
  const m = u.pathname.match(/\/(embed|shorts|live|v)\/([A-Za-z0-9_-]{8,15})/);
  if (m && ID.test(m[2])) return m[2];
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
export const handlers: Record<string, (world: World, s: Session, d: any) => void> = {

  input(world, s, d: C2SPayload<'input'>) {
    if (!s.buckets.input.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const now = Date.now();
    const dt = Math.max(0.016, Math.min(2, (now - s.lastInputAt) / 1000));
    s.lastInputAt = now;
    s.seq = d.seq;
    s.ry = d.ry % (Math.PI * 4);
    const { anim, speaking, held } = unpackState(d.st);
    const safeAnim = anim >= 0 && anim <= 9 ? anim : Anim.Idle;
    s.st = packState(s.seatId ? Anim.Sit : safeAnim, speaking, held);

    if (s.seatId) {
      const seat = sp.seats.get(s.seatId);
      if (seat) { s.x = seat.x; s.y = seat.y; s.z = seat.z; }
      return;
    }

    let [nx, ny, nz] = d.p;
    // Anti-teleport: cap distance travelled since last accepted input
    const travelled = dist2d(s.x, s.z, nx, nz);
    if (travelled > MAX_VALID_SPEED * dt + 0.6) {
      send(s, 'correction', { p: [s.x, s.y, s.z] });
      return;
    }
    [nx, nz] = clampToBounds(nx, nz, sp.layout.bounds);
    [nx, nz] = resolveCollisions(nx, nz, PLAYER_RADIUS, sp.colliders);
    const floor = floorHeightAt(sp.layout, nx, nz);
    ny = Math.min(Math.max(ny, floor - 0.05), floor + 3.2);
    const corrected = dist2d(nx, nz, d.p[0], d.p[2]) > 0.45;
    s.x = nx; s.y = ny; s.z = nz;
    if (corrected) send(s, 'correction', { p: [s.x, s.y, s.z] });
  },

  chat(world, s, d: C2SPayload<'chat'>) {
    if (!s.buckets.chat.take()) { toast(s, 'warn', '发言太快啦,歇一歇。'); return; }
    const sp = space(world, s);
    if (!sp) return;
    const text = d.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 300);
    if (!text) return;
    const msg: ChatMsg = { from: s.user.username, fromId: s.id, text, ts: Date.now() };
    sp.pushChat(msg);
    sp.broadcast('chat', msg);
  },

  switch_space(world, s, d: C2SPayload<'switch_space'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    // must actually be near a door/elevator that leads there (plaza fallback exempt)
    if (d.target !== SPACE.PLAZA || sp.layout.interactables.some((i) => i.kind === 'door')) {
      const doorNear = sp.layout.interactables.some((i) =>
        (i.kind === 'door' && i.data?.target === d.target && sp.isNear(s, i.pos[0], i.pos[2], 5)) ||
        (i.kind === 'elevator' && isRoomSpace(d.target) && sp.isNear(s, i.pos[0], i.pos[2], 5)));
      if (!doorNear && !(isRoomSpace(s.spaceKey) && d.target === SPACE.LOBBY)) {
        toast(s, 'warn', '要走到门口才能过去哦。');
        return;
      }
    }
    const init = world.switchSpace(s, d.target);
    if (init) send(s, 'space_init', init);
  },

  sit(world, s, d: C2SPayload<'sit'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const seat = sp.seats.get(d.seatId);
    if (!seat) return;
    if (sp.seatOcc.has(d.seatId)) { toast(s, 'info', '这个座位有人啦。'); return; }
    if (!sp.isNear(s, seat.x, seat.z, 4)) return;
    if (s.seatId) world.releaseSeat(s, sp);
    s.seatId = d.seatId;
    s.x = seat.x; s.y = seat.y; s.z = seat.z; s.ry = seat.ry;
    s.st = packState(Anim.Sit, false, unpackState(s.st).held);
    sp.seatOcc.set(d.seatId, s.id);
    sp.broadcast('seat', { seatId: d.seatId, playerId: s.id });
  },

  stand(world, s) {
    const sp = space(world, s);
    if (!sp || !s.seatId) return;
    const seat = sp.seats.get(s.seatId);
    world.releaseSeat(s, sp);
    if (seat) {
      let ex = seat.x + Math.sin(seat.ry) * 0.65;
      let ez = seat.z + Math.cos(seat.ry) * 0.65;
      [ex, ez] = clampToBounds(ex, ez, sp.layout.bounds);
      [ex, ez] = resolveCollisions(ex, ez, PLAYER_RADIUS, sp.colliders);
      s.x = ex; s.z = ez; s.y = floorHeightAt(sp.layout, ex, ez);
    }
    s.st = packState(Anim.Idle, false, unpackState(s.st).held);
  },

  emote(world, s, d: C2SPayload<'emote'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    sp.broadcast('emote', { id: s.id, anim: d.anim });
  },

  avatar_update(world, s, d: C2SPayload<'avatar_update'>) {
    if (!s.buckets.generic.take()) return;
    s.user.avatar = d.avatar;
    world.db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(JSON.stringify(d.avatar), s.user.id);
    const sp = space(world, s);
    sp?.broadcast('player_update', { profile: profileOf(s) });
  },

  media_set(world, s, d: C2SPayload<'media_set'>) {
    const sp = space(world, s);
    if (!sp || !sp.hasScreen || !sp.media) return;
    if (!canControlMedia(sp, s)) { toast(s, 'warn', '只有房主能控制这块屏幕。'); return; }
    if (!s.buckets.media.take()) { toast(s, 'warn', '换台太频繁啦,稍等一下。'); return; }
    if (d.shareOwnerId !== undefined) {
      // 投屏:把在场共享者的 WebRTC 画面设为大屏内容(流本身走 P2P)
      const owner = [...sp.sessions].find((m) => m.id === d.shareOwnerId);
      if (!owner || !owner.screenOn) {
        toast(s, 'warn', '这位团子不在本空间共享屏幕,没法投上大屏。');
        return;
      }
      sp.media = {
        url: null, kind: 'share', ownerId: owner.id, playing: true, position: 0, rate: 1,
        loop: false, updatedAt: Date.now(), setBy: s.user.username,
      };
      broadcastMedia(sp);
      return;
    }
    if (d.url === undefined) return; // schema 保证二选一;防御
    const classified = classifyMediaUrl(d.url);
    if (!classified) {
      toast(s, 'error', '不支持的链接。请用网站网址、视频文件(mp4/webm)或 YouTube 链接。');
      return;
    }
    sp.media = {
      url: classified.url, kind: classified.kind, playing: true, position: 0, rate: 1,
      loop: d.loop ?? false, updatedAt: Date.now(), setBy: s.user.username,
    };
    broadcastMedia(sp);
  },

  media_ctrl(world, s, d: C2SPayload<'media_ctrl'>) {
    const sp = space(world, s);
    if (!sp || !sp.hasScreen || !sp.media) return;
    // 投屏者本人永远可以停掉自己的投屏(即使无媒体控制权)
    const isOwnShareClear = d.op === 'clear' && sp.media.kind === 'share' && sp.media.ownerId === s.id;
    if (!canControlMedia(sp, s) && !isOwnShareClear) { toast(s, 'warn', '只有房主能控制这块屏幕。'); return; }
    if (!s.buckets.generic.take()) return;
    const m = sp.media;
    const now = Date.now();
    if (!m.url && d.op !== 'clear') return;
    switch (d.op) {
      case 'play':
        if (m.playing) return;
        m.playing = true; m.updatedAt = now; break;
      case 'pause':
        if (!m.playing) return;
        m.position = sp.mediaPosition(now); m.playing = false; m.updatedAt = now; break;
      case 'seek': {
        const t = Math.max(0, Math.min(86400, d.value ?? 0));
        m.position = t; m.updatedAt = now; break;
      }
      case 'rate': {
        const allowed = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const r = allowed.includes(d.value ?? 1) ? (d.value as number) : 1;
        m.position = sp.mediaPosition(now); m.rate = r; m.updatedAt = now; break;
      }
      case 'clear':
        sp.media = { url: null, kind: null, playing: false, position: 0, rate: 1, loop: false, updatedAt: now, setBy: s.user.username };
        broadcastMedia(sp);
        return;
    }
    m.setBy = s.user.username;
    broadcastMedia(sp);
  },

  music_set(world, s, d: C2SPayload<'music_set'>) {
    const sp = space(world, s);
    if (!sp || !sp.hasMusic || !sp.music) return;
    if (sp.isRoom && !canControlMedia(sp, s)) { toast(s, 'warn', '只有房主能控制这里的音乐。'); return; }
    if (!s.buckets.media.take()) { toast(s, 'warn', '点歌机换歌需要缓一缓。'); return; }
    if (d.trackId !== null && !TRACK_IDS.includes(d.trackId)) return;
    sp.music = { trackId: d.trackId, startedAt: Date.now(), setBy: s.user.username };
    sp.broadcast('music_state', sp.music);
  },

  wb_stroke(world, s, d: C2SPayload<'wb_stroke'>) {
    if (!s.buckets.stroke.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    if (!sp.whiteboards.has(d.boardId)) return;
    if (d.pts.length % 2 !== 0) return;
    if (d.pts.some((v) => v < -0.05 || v > 1.05)) return;
    const strokes = sp.whiteboards.get(d.boardId)!;
    const stroke: Stroke = { pts: d.pts, color: d.color, width: d.width };
    strokes.push(stroke);
    if (strokes.length > WHITEBOARD_MAX_STROKES) strokes.splice(0, strokes.length - WHITEBOARD_MAX_STROKES);
    sp.wbDirty.add(d.boardId);
    sp.broadcast('wb_stroke', { boardId: d.boardId, stroke }, s);
  },

  wb_clear(world, s, d: C2SPayload<'wb_clear'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp || !sp.whiteboards.has(d.boardId)) return;
    if (sp.isRoom && sp.roomData!.ownerId !== s.user.id) {
      toast(s, 'warn', '只有房主能擦掉整块板子。');
      return;
    }
    sp.whiteboards.set(d.boardId, []);
    sp.wbDirty.add(d.boardId);
    sp.broadcast('wb_clear', { boardId: d.boardId });
  },

  board_post(world, s, d: C2SPayload<'board_post'>) {
    const sp = space(world, s);
    if (!sp) return;
    const it = nearInteractable(sp, s, d.boardId, ['board']);
    if (!it) return;
    if (!s.buckets.board.take()) { toast(s, 'warn', '贴纸条别太快,几秒一张。'); return; }
    const text = d.text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!text) return;
    world.db.prepare('INSERT INTO board_posts (board_key, user_id, username, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(sp.boardKey(d.boardId), s.user.id, s.user.username, text, Date.now());
    // trim old posts beyond cap
    world.db.prepare(
      `DELETE FROM board_posts WHERE board_key = ? AND id NOT IN
       (SELECT id FROM board_posts WHERE board_key = ? ORDER BY id DESC LIMIT ?)`
    ).run(sp.boardKey(d.boardId), sp.boardKey(d.boardId), BOARD_MAX_POSTS);
    sp.broadcast('board_state', { boardId: d.boardId, posts: sp.loadBoard(d.boardId) });
  },

  board_delete(world, s, d: C2SPayload<'board_delete'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const it = sp.findInteractable(d.boardId);
    if (!it || it.kind !== 'board') return;
    const row = world.db.prepare('SELECT user_id FROM board_posts WHERE id = ? AND board_key = ?')
      .get(d.postId, sp.boardKey(d.boardId)) as { user_id: number } | undefined;
    if (!row) return;
    const isOwner = sp.isRoom && sp.roomData!.ownerId === s.user.id;
    if (row.user_id !== s.user.id && !isOwner) { toast(s, 'warn', '只能撕自己贴的纸条。'); return; }
    world.db.prepare('DELETE FROM board_posts WHERE id = ?').run(d.postId);
    sp.broadcast('board_state', { boardId: d.boardId, posts: sp.loadBoard(d.boardId) });
  },

  switch_toggle(world, s, d: C2SPayload<'switch_toggle'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    if (sp.isRoom && d.switchId === 'room-lights') {
      const room = sp.roomData!;
      room.style.lightsOn = !room.style.lightsOn;
      saveRoomMeta(world.db, room);
      sp.broadcast('room_data', room);
      return;
    }
    if (!sp.switches.has(d.switchId)) return;
    const sw = sp.layout.interactables.find((i) => i.kind === 'switch' && String(i.data?.switchId) === d.switchId);
    if (sw && !sp.isNear(s, sw.pos[0], sw.pos[2], 4.5)) return;
    const next = !sp.switches.get(d.switchId);
    sp.switches.set(d.switchId, next);
    sp.saveSwitch(d.switchId, next);
    sp.broadcast('switch_state', { switchId: d.switchId, on: next });
  },

  npc_talk(world, s, d: C2SPayload<'npc_talk'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const npc = sp.npcs.find((n) => n.def.id === d.npcId);
    if (!npc || !sp.isNear(s, npc.x, npc.z, 4.5)) return;
    const dialogueId = npc.def.dialogueId;
    const anyS = s as Session & { dialog?: { npcId: number; nodeId: string } };

    let nodeId = 'root';
    if (d.choice && anyS.dialog && anyS.dialog.npcId === d.npcId) {
      const current = resolveDialogueNode(dialogueId, anyS.dialog.nodeId);
      const opt = current?.options.find((o) => o.id === d.choice);
      if (!opt) return;
      if (opt.action === 'end') {
        anyS.dialog = undefined;
        send(s, 'npc_dialog', { npcId: d.npcId, end: true });
        return;
      }
      if (opt.action === 'buy_coffee') {
        const price = ITEMS_BY_ID['coffee'].price;
        if (s.user.credits >= price) {
          world.db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(price, s.user.id);
          world.db.prepare('INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, 1) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + 1')
            .run(s.user.id, 'coffee');
          send(s, 'self_update', world.buildSelfState(s));
          nodeId = 'coffee_ok';
        } else {
          nodeId = 'coffee_broke';
        }
      } else if (opt.next) {
        nodeId = opt.next;
      } else {
        return;
      }
    }
    const node = resolveDialogueNode(dialogueId, nodeId);
    if (!node) return;
    anyS.dialog = { npcId: d.npcId, nodeId };
    sp.pauseNpc(d.npcId, s.x, s.z);
    const env = world.envState();
    const t = typeof node.text === 'function'
      ? node.text({ username: s.user.username, credits: s.user.credits, weather: env.weather, isNight: env.timeOfDay < 0.22 || env.timeOfDay > 0.83 })
      : node.text;
    send(s, 'npc_dialog', {
      npcId: d.npcId, npcName: npc.def.name, text: t,
      options: node.options.map((o) => ({ id: o.id, label: o.label })),
    });
  },

  game_join(world, s, d: C2SPayload<'game_join'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const xq = sp.xq.get(d.machineId);
    if (xq) {
      if (!nearInteractable(sp, s, d.machineId, ['xiangqi'])) return;
      const err = xq.join(s);
      if (err) { toast(s, 'info', err); return; }
      sp.broadcast('game_xq', xq.publicState());
      return;
    }
    const ttt = sp.ttt.get(d.machineId);
    if (ttt) {
      if (!nearInteractable(sp, s, d.machineId, ['ttt'])) return;
      if (ttt.winner !== 0 && (ttt.players[0] === s || ttt.players[1] === s)) {
        ttt.board = Array(9).fill(0); ttt.turn = 1; ttt.winner = 0; // rematch
      } else if (ttt.players[0] !== s && ttt.players[1] !== s) {
        const slot = ttt.players[0] === null ? 0 : ttt.players[1] === null ? 1 : -1;
        if (slot === -1) { toast(s, 'info', '两个座位都满了——先观战这局吧!'); return; }
        ttt.players[slot] = s;
      }
      sp.broadcast('game_ttt', sp.tttPublic(ttt));
      return;
    }
    const lo = sp.lo.get(d.machineId);
    if (lo) {
      if (!nearInteractable(sp, s, d.machineId, ['lightsout'])) return;
      if (lo.session && lo.session !== s) { toast(s, 'info', `${lo.session.user.username} 正在玩呢。`); return; }
      lo.session = s;
      lo.moves = 0;
      lo.grid = generateLightsOut();
      sp.broadcast('game_lo', sp.loPublic(lo));
    }
  },

  game_leave(world, s, d: C2SPayload<'game_leave'>) {
    const sp = space(world, s);
    if (!sp) return;
    const xq = sp.xq.get(d.machineId);
    if (xq && xq.leave(s)) {
      sp.broadcast('game_xq', xq.publicState());
      return;
    }
    const ttt = sp.ttt.get(d.machineId);
    if (ttt && (ttt.players[0] === s || ttt.players[1] === s)) {
      const idx = ttt.players.indexOf(s);
      ttt.players[idx] = null;
      ttt.board = Array(9).fill(0); ttt.turn = 1; ttt.winner = 0;
      sp.broadcast('game_ttt', sp.tttPublic(ttt));
    }
    const lo = sp.lo.get(d.machineId);
    if (lo && lo.session === s) {
      lo.session = null;
      sp.broadcast('game_lo', sp.loPublic(lo));
    }
  },

  game_move(world, s, d: C2SPayload<'game_move'>) {
    if (!s.buckets.generic.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const ttt = sp.ttt.get(d.machineId);
    if (ttt) { tttMove(sp, ttt, s, d.cell); return; }
    const lo = sp.lo.get(d.machineId);
    if (lo && lo.session === s && d.cell < 25) {
      loPress(lo, d.cell);
      if (lo.grid.every((v) => !v)) {
        if (!lo.best || lo.moves < lo.best.moves) {
          lo.best = { name: s.user.username, moves: lo.moves };
          kvSet(world.db, `lo-best:${lo.machineId}`, lo.best);
          world.systemChat(sp, `${s.user.username} 创下关灯谜题纪录:${lo.moves} 步!`);
        } else {
          world.systemChat(sp, `${s.user.username} 用 ${lo.moves} 步解开了关灯谜题!`);
        }
        lo.session = null;
      }
      sp.broadcast('game_lo', sp.loPublic(lo));
    }
  },

  xq_move(world, s, d: C2SPayload<'xq_move'>) {
    if (!s.buckets.generic.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const table = sp.xq.get(d.tableId);
    if (!table) return;
    const err = table.move(s, d.from, d.to);
    if (err) { toast(s, 'info', err); return; }
    sp.broadcast('game_xq', table.publicState());
    if (table.winner !== -1) {
      const winner = table.players[table.winner];
      if (winner) world.systemChat(sp, `${winner.user.username} 在象棋桌上赢了一局!`);
    }
  },

  mj_action(world, s, d: C2SPayload<'mj_action'>) {
    if (!s.buckets.generic.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const table = sp.mj.get(d.tableId);
    if (!table) return;
    let err: string | null = null;
    switch (d.action) {
      case 'sit': {
        if (!nearInteractable(sp, s, d.tableId, ['mahjong'])) return;
        err = table.sit(s);
        break;
      }
      case 'leave':
        table.leave(s);
        break;
      case 'start':
        err = table.start(s);
        break;
      case 'discard': {
        const seat = table.seatOf(s);
        if (seat === -1 || d.tile === undefined) return;
        err = table.discard(seat, d.tile);
        break;
      }
      case 'pong':
      case 'kong':
      case 'hu':
      case 'pass': {
        const seat = table.seatOf(s);
        if (seat === -1) return;
        if (table.claim) {
          err = table.respond(seat, d.action);
        } else if (d.action === 'hu' || d.action === 'kong') {
          err = table.selfAction(seat, d.action, d.tile);
        }
        break;
      }
    }
    if (err) { toast(s, 'info', err); return; }
    sp.broadcastMahjong(table);
    for (const ev of table.drainEvents()) {
      if (ev.kind === 'finish') world.settleMahjong(sp, table, ev.winnerSeat, ev.winKind, ev.reward);
    }
  },

  rj_action(world, s, d: C2SPayload<'rj_action'>) {
    if (!s.buckets.generic.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const table = sp.rj.get(d.tableId);
    if (!table) return;
    let err: string | null = null;
    switch (d.action) {
      case 'sit': {
        if (!nearInteractable(sp, s, d.tableId, ['riichi'])) return;
        err = table.sit(s);
        break;
      }
      case 'leave':
        table.leave(s);
        break;
      case 'start':
        err = table.start(s);
        break;
      default:
        err = table.action(s, d.action, d.tileId, d.meld);
        break;
    }
    if (err) { toast(s, 'info', err); return; }
    sp.broadcastRiichi(table);
    world.settleRiichi(sp, table);
  },

  room_edit(world, s, d: C2SPayload<'room_edit'>) {
    if (!s.buckets.generic.take()) return;
    const sp = space(world, s);
    if (!sp || !sp.isRoom || !sp.roomData) return;
    const room = sp.roomData;
    if (room.ownerId !== s.user.id) { toast(s, 'warn', '只有房主能改造这个房间。'); return; }

    switch (d.op) {
      case 'add': {
        const def = FURNITURE_BY_TYPE[d.type];
        if (!def) return;
        if (def.price > 0) {
          const unlocked = world.db.prepare('SELECT 1 FROM unlocks WHERE user_id = ? AND furniture_type = ?').get(s.user.id, d.type);
          if (!unlocked) { toast(s, 'warn', `「${def.name}」要先去商店购买台解锁。`); return; }
        }
        const res = addRoomObject(world.db, s.user.id, d.type, d.x, d.y, d.z, d.ry, d.color);
        if ('error' in res) { toast(s, 'warn', res.error); return; }
        room.objects.push(res);
        break;
      }
      case 'move':
        if (!moveRoomObject(world.db, s.user.id, d.id, d.x, d.y, d.z, d.ry)) return;
        {
          const o = room.objects.find((v) => v.id === d.id);
          if (o) { o.x = d.x; o.y = d.y; o.z = d.z; o.ry = d.ry; }
        }
        break;
      case 'recolor':
        if (!recolorRoomObject(world.db, s.user.id, d.id, d.color)) return;
        {
          const o = room.objects.find((v) => v.id === d.id);
          if (o) o.color = d.color;
        }
        break;
      case 'remove': {
        if (!removeRoomObject(world.db, s.user.id, d.id)) return;
        const idx = room.objects.findIndex((v) => v.id === d.id);
        if (idx >= 0) room.objects.splice(idx, 1);
        // stand up anyone sitting on the removed object
        for (const member of sp.sessions) {
          if (member.seatId?.startsWith(`obj:${d.id}:`)) {
            world.releaseSeat(member, sp);
          }
        }
        break;
      }
      case 'style':
        if (d.wallColor) room.style.wallColor = d.wallColor;
        if (d.floorColor) room.style.floorColor = d.floorColor;
        if (d.ceilingColor) room.style.ceilingColor = d.ceilingColor;
        if (d.trimColor) room.style.trimColor = d.trimColor;
        if (d.lightPreset) room.style.lightPreset = d.lightPreset;
        saveRoomMeta(world.db, room);
        break;
      case 'rename':
        room.name = d.name.trim().slice(0, 40) || room.name;
        saveRoomMeta(world.db, room);
        break;
      case 'visibility':
        room.visibility = d.visibility;
        saveRoomMeta(world.db, room);
        if (d.visibility === 'private') {
          for (const member of [...sp.sessions]) {
            if (member.user.id !== room.ownerId) {
              toast(member, 'info', '房主把房间设为私密了。');
              const init = world.switchSpace(member, SPACE.LOBBY, undefined);
              if (init) send(member, 'space_init', init);
            }
          }
        }
        break;
      case 'mediaControl':
        room.mediaControl = d.policy;
        saveRoomMeta(world.db, room);
        break;
      case 'notes':
        room.notes = d.text;
        saveRoomMeta(world.db, room);
        break;
      case 'objState': {
        const o = room.objects.find((v) => v.id === d.id);
        if (!o) return;
        const merged = { ...o.state, ...d.state };
        if (!setRoomObjectState(world.db, s.user.id, d.id, merged)) return;
        o.state = merged;
        break;
      }
    }
    sp.rebuildRoomDerived();
    sp.broadcast('room_data', room);
  },

  obj_toggle(world, s, d: C2SPayload<'obj_toggle'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp || !sp.isRoom || !sp.roomData) return;
    const m = /^obj:(\d+)$/.exec(d.objectId);
    if (!m) return;
    const id = Number(m[1]);
    const o = sp.roomData.objects.find((v) => v.id === id);
    if (!o) return;
    const def = FURNITURE_BY_TYPE[o.type];
    if (!def || def.interaction !== 'lamp') return;
    if (!sp.isNear(s, o.x, o.z, 4.5)) return;
    o.state = { ...o.state, on: !(o.state.on ?? true) };
    setRoomObjectState(world.db, sp.roomData.ownerId, id, o.state);
    sp.broadcast('room_data', sp.roomData);
  },

  kick_ball(world, s, d: C2SPayload<'kick_ball'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (sp) sp.kickBall(s, d.dirX, d.dirZ);
  },

  buy(world, s, d: C2SPayload<'buy'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const vend = nearInteractable(sp, s, d.source, ['vending']);
    if (!vend) return;
    const allowed = (vend.data?.items as string[] | undefined) ?? [];
    if (!allowed.includes(d.itemId)) return;
    const item = ITEMS_BY_ID[d.itemId];
    if (!item) return;
    if (s.user.credits < item.price) { toast(s, 'warn', `金币不够(需要 ${item.price})。`); return; }
    world.db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(item.price, s.user.id);
    world.db.prepare('INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, 1) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + 1')
      .run(s.user.id, d.itemId);
    send(s, 'self_update', world.buildSelfState(s));
    toast(s, 'info', `${item.icon} ${item.name} 已放进背包。`);
  },

  unlock_furniture(world, s, d: C2SPayload<'unlock_furniture'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const kiosk = sp.layout.interactables.find((i) => i.kind === 'kiosk');
    if (!kiosk || !sp.isNear(s, kiosk.pos[0], kiosk.pos[2], 5)) return;
    const def = FURNITURE_BY_TYPE[d.type];
    if (!def || def.price <= 0) return;
    const exists = world.db.prepare('SELECT 1 FROM unlocks WHERE user_id = ? AND furniture_type = ?').get(s.user.id, d.type);
    if (exists) { toast(s, 'info', '已经解锁过啦。'); return; }
    if (s.user.credits < def.price) { toast(s, 'warn', `金币不够(需要 ${def.price})。`); return; }
    world.db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(def.price, s.user.id);
    world.db.prepare('INSERT INTO unlocks (user_id, furniture_type) VALUES (?, ?)').run(s.user.id, d.type);
    send(s, 'self_update', world.buildSelfState(s));
    toast(s, 'info', `「${def.name}」解锁成功!去房间编辑器里摆上吧。`);
  },

  use_item(world, s, d: C2SPayload<'use_item'>) {
    if (!s.buckets.interact.take()) return;
    const item = ITEMS_BY_ID[d.itemId];
    if (!item || item.heldId === undefined) return;
    const row = world.db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?').get(s.user.id, d.itemId) as { qty: number } | undefined;
    if (!row || row.qty <= 0) { toast(s, 'warn', '你没有这个物品。'); return; }
    if (item.kind === 'consumable') {
      world.db.prepare('UPDATE inventory SET qty = qty - 1 WHERE user_id = ? AND item_id = ?').run(s.user.id, d.itemId);
    }
    send(s, 'self_update', world.buildSelfState(s));
  },

  stash(world, s, d: C2SPayload<'stash'>) {
    if (!s.buckets.interact.take()) return;
    const sp = space(world, s);
    if (!sp || !sp.isRoom || !sp.roomData || sp.roomData.ownerId !== s.user.id) return;
    const o = sp.roomData.objects.find((v) => v.id === d.objectId);
    if (!o || FURNITURE_BY_TYPE[o.type]?.interaction !== 'storage') return;
    if (!ITEMS_BY_ID[d.itemId]) return;
    const stashRec = (o.state.stash ?? {}) as Record<string, number>;
    if (d.dir === 'toStash') {
      const row = world.db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?').get(s.user.id, d.itemId) as { qty: number } | undefined;
      if (!row || row.qty <= 0) return;
      world.db.prepare('UPDATE inventory SET qty = qty - 1 WHERE user_id = ? AND item_id = ?').run(s.user.id, d.itemId);
      stashRec[d.itemId] = (stashRec[d.itemId] ?? 0) + 1;
    } else {
      if ((stashRec[d.itemId] ?? 0) <= 0) return;
      stashRec[d.itemId] -= 1;
      if (stashRec[d.itemId] === 0) delete stashRec[d.itemId];
      world.db.prepare('INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, 1) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + 1')
        .run(s.user.id, d.itemId);
    }
    o.state = { ...o.state, stash: stashRec };
    setRoomObjectState(world.db, s.user.id, d.objectId, o.state);
    send(s, 'self_update', world.buildSelfState(s));
    sp.broadcast('room_data', sp.roomData);
  },

  voice_state(world, s, d: C2SPayload<'voice_state'>) {
    if (!s.buckets.generic.take()) return;
    const wasWorld = s.voiceOn && s.voiceScope === 'world';
    s.voiceOn = d.on;
    s.voiceScope = d.scope ?? 'near';
    const isWorld = s.voiceOn && s.voiceScope === 'world';
    if (wasWorld || isWorld) {
      // 世界语音名单变化影响所有空间
      world.broadcastVoiceRosters();
    } else {
      const sp = space(world, s);
      if (sp) sp.broadcast('voice_roster', world.voicePayload(sp));
    }
  },

  screen_share(world, s, d: C2SPayload<'screen_share'>) {
    if (!s.buckets.generic.take()) return;
    s.screenOn = d.on;
    const sp = space(world, s);
    if (!sp) return;
    sp.broadcast('screen_roster', { ids: sp.screenRoster() });
    // 停止共享时,若大屏正在放此人的投屏则自动清屏
    if (!d.on) world.clearShareIfOwner(sp, s.id);
  },

  rtc(world, s, d: C2SPayload<'rtc'>) {
    if (!s.buckets.rtc.take()) return;
    const target = world.sessionsById.get(d.to);
    if (!target) return;
    // 全世界语音:任一端是全服广播者时,允许跨空间建链
    const worldLink = (s.voiceOn && s.voiceScope === 'world') || (target.voiceOn && target.voiceScope === 'world');
    if (!worldLink && target.spaceKey !== s.spaceKey) return;
    // a link is legitimate when either end is publishing media (mic or screen)
    if (!worldLink && !(s.voiceOn || s.screenOn) && !(target.voiceOn || target.screenOn)) return;
    send(target, 'rtc', { from: s.id, kind: d.kind, payload: d.payload });
  },

  elevator_list(world, s) {
    if (!s.buckets.generic.take()) return;
    const sp = space(world, s);
    if (!sp) return;
    const nearElevator = sp.layout.interactables.some((i) => i.kind === 'elevator' && sp.isNear(s, i.pos[0], i.pos[2], 5.5));
    if (!nearElevator && !sp.isRoom) return;
    send(s, 'room_dir', { rooms: listDirectory(world.db, world.roomOnlineCounts(), s.user.id) });
  },

  ping(_world, s, d: C2SPayload<'ping'>) {
    send(s, 'pong', { t: d.t });
  },
};

// ── Tic-tac-toe helpers ─────────────────────────────────────────────────────
const WINS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
function tttMove(sp: Space, t: TttInternal, s: Session, cell: number): void {
  if (cell > 8 || t.winner !== 0) return;
  const me = t.players[0] === s ? 1 : t.players[1] === s ? 2 : 0;
  if (me === 0 || t.turn !== me) return;
  if (!t.players[0] || !t.players[1]) return; // wait for opponent
  if (t.board[cell] !== 0) return;
  t.board[cell] = me;
  if (WINS.some((w) => w.every((i) => t.board[i] === me))) t.winner = me as 1 | 2;
  else if (t.board.every((c) => c !== 0)) t.winner = 3;
  else t.turn = (t.turn === 1 ? 2 : 1);
  sp.broadcast('game_ttt', sp.tttPublic(t));
}

// ── Lights-out helpers ──────────────────────────────────────────────────────
function loPress(lo: LoInternal, cell: number): void {
  const toggle = (i: number) => { lo.grid[i] = !lo.grid[i]; };
  const r = Math.floor(cell / 5), c = cell % 5;
  toggle(cell);
  if (r > 0) toggle(cell - 5);
  if (r < 4) toggle(cell + 5);
  if (c > 0) toggle(cell - 1);
  if (c < 4) toggle(cell + 1);
  lo.moves += 1;
}
function generateLightsOut(): boolean[] {
  const lo = { grid: Array(25).fill(false) as boolean[], moves: 0, machineId: '', session: null, best: null } as LoInternal;
  const presses = 6 + Math.floor(Math.random() * 6);
  for (let i = 0; i < presses; i++) loPress(lo, Math.floor(Math.random() * 25));
  lo.moves = 0;
  if (lo.grid.every((v) => !v)) lo.grid[12] = lo.grid[7] = lo.grid[11] = lo.grid[13] = lo.grid[17] = true;
  return lo.grid;
}
