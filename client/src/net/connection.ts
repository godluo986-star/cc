import { encode, safeParse, PROTOCOL_VERSION, INPUT_RATE, packState } from '@nexuspark/shared';
import type { S2CMap, SpaceInit } from '@nexuspark/shared';
import { hot } from '../state/hot';
import { useSession, useWorld, useChat, useUI, useVoice } from '../state/stores';

type Handler<T extends keyof S2CMap> = (d: S2CMap[T]) => void;

class Connection {
  private ws: WebSocket | null = null;
  private reconnectDelay = 800;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldRun = false;
  private lastInputSent = 0;
  private inputSeq = 0;
  private extraHandlers = new Map<string, Set<(d: unknown) => void>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /** Latency estimate (ms). */
  rtt = 0;

  /**
   * Server-clock offset estimate (ms): Date.now() + serverTimeOffset ≈ server
   * now. Read-only view of hot.serverTimeOffset for automation (sync-test).
   */
  get serverTimeOffset(): number {
    return hot.serverTimeOffset;
  }

  start(): void {
    this.shouldRun = true;
    this.open();
  }

  stop(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private open(): void {
    const token = useSession.getState().token;
    if (!token) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(encode('hello', { token, v: PROTOCOL_VERSION }));
    };
    ws.onmessage = (ev) => {
      const msg = safeParse(String(ev.data));
      if (msg) this.dispatch(msg.t, msg.d);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      const session = useSession.getState();
      if (!this.shouldRun) return;
      // auth-level rejections should return to the login screen
      if (ev.code === 4002 || ev.code === 4003) {
        session.setToken(null);
        session.setPhase('auth');
        session.setConnected(false);
        return;
      }
      if (ev.code === 4008) return; // superseded — kicked handler already ran
      session.setConnected(false, true);
      this.reconnectTimer = setTimeout(() => this.open(), this.reconnectDelay);
      this.reconnectDelay = Math.min(10000, this.reconnectDelay * 1.7);
    };
    ws.onerror = () => { /* close handler drives retry */ };
  }

  send(t: string, d?: unknown): void {
    if (this.connected) this.ws!.send(encode(t, d));
  }

  /**
   * Movement input, throttled to INPUT_RATE.
   *
   * 挣扎语义:当自己被抓(hot.local.grabbedBy != null)时,这条 input 的 p
   * 不再驱动位移 —— 服务器把「p 相对被抓者实际位置的偏移方向」当作挣扎力
   * 累积(积满 ESCAPE_BREAK 秒即挣脱)。LocalPlayer 在被抓时负责把
   * l.x/y/z 设为「服务器快照位置 + 输入方向的小偏移」,因此这里照常读取
   * hot.local 即可,消息格式与频率完全不变。
   */
  sendInput(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastInputSent < 1000 / INPUT_RATE) return;
    if (!this.connected) return;
    this.lastInputSent = now;
    const l = hot.local;
    const st = packState(l.anim, l.speaking, l.held);
    this.send('input', {
      p: [round(l.x), round(l.y), round(l.z)],
      ry: Math.round(l.ry * 1000) / 1000,
      st,
      seq: ++this.inputSeq,
    });
  }

  on<T extends string>(type: T, fn: (d: unknown) => void): () => void {
    let set = this.extraHandlers.get(type);
    if (!set) { set = new Set(); this.extraHandlers.set(type, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  private dispatch(t: string, d: unknown): void {
    const session = useSession.getState();
    const world = useWorld.getState();
    const chat = useChat.getState();
    const ui = useUI.getState();

    switch (t as keyof S2CMap) {
      case 'welcome': {
        const w = d as S2CMap['welcome'];
        this.reconnectDelay = 800;
        session.setSelf(w.self);
        session.setConnected(true);
        session.setPhase('inworld');
        world.setEnv(w.env);
        this.stunServers = w.stun;
        this.applySpaceInit(w.space);
        if (!this.pingTimer) {
          this.pingTimer = setInterval(() => this.send('ping', { t: Date.now() }), 5000);
        }
        break;
      }
      case 'space_init':
        this.applySpaceInit(d as SpaceInit);
        break;
      case 'self_update': {
        const p = d as S2CMap['self_update'];
        session.patchSelf(p);
        break;
      }
      case 'player_join': {
        const { profile } = d as S2CMap['player_join'];
        world.addPlayer(profile);
        hot.upsertPlayer(profile);
        break;
      }
      case 'player_leave': {
        const { id } = d as S2CMap['player_leave'];
        world.removePlayer(id);
        hot.removePlayer(id);
        break;
      }
      case 'player_update': {
        const { profile } = d as S2CMap['player_update'];
        world.updatePlayer(profile);
        hot.upsertPlayer(profile);
        break;
      }
      case 'snap': {
        const s = d as S2CMap['snap'];
        // refine server clock offset from snapshot timestamps
        const localNow = Date.now();
        const off = s.t - localNow;
        hot.serverTimeOffset = hot.serverTimeOffset === 0 ? off : hot.serverTimeOffset * 0.9 + off * 0.1;
        hot.applySnapshot(s.t, s.e, s.o);
        break;
      }
      case 'chat':
        chat.push(d as S2CMap['chat']);
        break;
      case 'emote': {
        const e = d as S2CMap['emote'];
        hot.playEmote(e.id, e.anim);
        break;
      }
      case 'seat': {
        const e = d as S2CMap['seat'];
        world.setSeat(e);
        if (e.playerId === hot.selfId) {
          if (e.released) {
            hot.local.seatId = null;
          } else {
            hot.local.seatId = e.seatId;
          }
        }
        break;
      }
      case 'media_state':
        world.setMedia(d as S2CMap['media_state']);
        break;
      case 'music_state':
        world.setMusic(d as S2CMap['music_state']);
        break;
      case 'wb_stroke': {
        const w = d as S2CMap['wb_stroke'];
        world.addStroke(w.boardId, w.stroke);
        break;
      }
      case 'wb_clear':
        world.clearBoard((d as S2CMap['wb_clear']).boardId);
        break;
      case 'board_state': {
        const b = d as S2CMap['board_state'];
        world.setBoardPosts(b.boardId, b.posts);
        break;
      }
      case 'switch_state': {
        const s = d as S2CMap['switch_state'];
        world.setSwitch(s.switchId, s.on);
        break;
      }
      case 'npc_dialog': {
        const nd = d as S2CMap['npc_dialog'];
        if ('end' in nd && nd.end) ui.setDialogue(null);
        else ui.setDialogue(nd as Exclude<S2CMap['npc_dialog'], { end: true }>);
        break;
      }
      case 'game_ttt':
        world.setTtt(d as S2CMap['game_ttt']);
        break;
      case 'game_lo':
        world.setLo(d as S2CMap['game_lo']);
        break;
      case 'game_xq':
        world.setXq(d as S2CMap['game_xq']);
        break;
      case 'game_mj':
        world.setMj(d as S2CMap['game_mj']);
        break;
      case 'game_rj':
        world.setRj(d as S2CMap['game_rj']);
        break;
      case 'room_data':
        world.setRoom(d as S2CMap['room_data']);
        break;
      case 'room_dir':
        world.setRoomDir((d as S2CMap['room_dir']).rooms);
        break;
      case 'env':
        world.setEnv(d as S2CMap['env']);
        break;
      case 'voice_roster': {
        const vr = d as S2CMap['voice_roster'];
        world.setVoiceRoster(vr.ids, vr.world);
        break;
      }
      case 'screen_roster':
        world.setScreenRoster((d as S2CMap['screen_roster']).ids);
        break;
      case 'correction': {
        const c = d as S2CMap['correction'];
        hot.local.x = c.p[0]; hot.local.y = c.p[1]; hot.local.z = c.p[2];
        break;
      }
      case 'grab_state': {
        // 双向维护 hot 上的 grabbedBy/grabbing;released/broken 清理。
        // toast 已由服务器发,客户端不重复弹提示。
        hot.applyGrabState(d as S2CMap['grab_state']);
        break;
      }
      case 'toast': {
        const to = d as S2CMap['toast'];
        ui.toast(to.level, to.text);
        break;
      }
      case 'kicked': {
        const k = d as S2CMap['kicked'];
        session.setKicked(k.reason);
        this.shouldRun = false;
        break;
      }
      case 'pong': {
        const p = d as S2CMap['pong'];
        this.rtt = Date.now() - p.t;
        break;
      }
      default:
        break;
    }

    const extra = this.extraHandlers.get(t);
    if (extra) for (const fn of extra) fn(d);
  }

  stunServers: string[] = [];

  private applySpaceInit(init: SpaceInit): void {
    const world = useWorld.getState();
    const chat = useChat.getState();
    const ui = useUI.getState();
    hot.reset(init.selfId, init.spawn);
    for (const p of init.players) if (p.id !== init.selfId) hot.upsertPlayer(p);
    hot.applySnapshot(Date.now() + hot.serverTimeOffset, init.snaps, init.objs);
    world.applyInit(init);
    chat.setAll(init.chat);
    ui.closePanel();
    ui.setDialogue(null);
    ui.setEditMode(false);
    ui.setFade(false);
    // restore own seat if the server kept us seated (reconnect)
    const mySeat = init.seats.find((s) => s.playerId === init.selfId);
    hot.local.seatId = mySeat?.seatId ?? null;
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export const connection = new Connection();
