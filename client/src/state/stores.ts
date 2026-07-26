import { create } from 'zustand';
import type {
  SelfState, SpaceInit, PublicProfile, ChatMsg, MediaState, MusicState, WorldEnv,
  RoomData, BoardPost, Stroke, TicTacToeState, LightsOutState, DialogueNode,
  RoomDirectoryEntry, SeatStateEntry, AvatarConfig, InventoryEntry,
  XiangqiState, MahjongView,
} from '@nexuspark/shared';

// ── Session / auth ──────────────────────────────────────────────────────────
export type Phase = 'auth' | 'connecting' | 'inworld';
interface SessionStore {
  phase: Phase;
  token: string | null;
  self: SelfState | null;
  connected: boolean;
  reconnecting: boolean;
  kickedReason: string | null;
  setPhase: (p: Phase) => void;
  setToken: (t: string | null) => void;
  setSelf: (s: SelfState | null) => void;
  patchSelf: (p: Partial<SelfState>) => void;
  setConnected: (c: boolean, reconnecting?: boolean) => void;
  setKicked: (r: string | null) => void;
}
export const useSession = create<SessionStore>((set) => ({
  phase: 'auth',
  token: localStorage.getItem('np_token'),
  self: null,
  connected: false,
  reconnecting: false,
  kickedReason: null,
  setPhase: (phase) => set({ phase }),
  setToken: (token) => {
    if (token) localStorage.setItem('np_token', token);
    else localStorage.removeItem('np_token');
    set({ token });
  },
  setSelf: (self) => set({ self }),
  patchSelf: (p) => set((s) => ({ self: s.self ? { ...s.self, ...p } : s.self })),
  setConnected: (connected, reconnecting = false) => set({ connected, reconnecting }),
  setKicked: (kickedReason) => set({ kickedReason }),
}));

// ── World (per-space react state) ───────────────────────────────────────────
interface WorldStore {
  spaceKey: string;
  label: string;
  roster: PublicProfile[];
  seats: Record<string, number>;
  media: MediaState | null;
  music: MusicState | null;
  whiteboards: Record<string, Stroke[]>;
  boards: Record<string, BoardPost[]>;
  switches: Record<string, boolean>;
  room: RoomData | null;
  ttt: Record<string, TicTacToeState>;
  lo: Record<string, LightsOutState>;
  xq: Record<string, XiangqiState>;
  mj: Record<string, MahjongView>;
  env: WorldEnv;
  voiceRoster: number[];
  screenRoster: number[];
  roomDir: RoomDirectoryEntry[];
  applyInit: (init: SpaceInit) => void;
  addPlayer: (p: PublicProfile) => void;
  removePlayer: (id: number) => void;
  updatePlayer: (p: PublicProfile) => void;
  setSeat: (e: SeatStateEntry & { released?: boolean }) => void;
  setMedia: (m: MediaState | null) => void;
  setMusic: (m: MusicState | null) => void;
  addStroke: (boardId: string, s: Stroke) => void;
  clearBoard: (boardId: string) => void;
  setBoardPosts: (boardId: string, posts: BoardPost[]) => void;
  setSwitch: (id: string, on: boolean) => void;
  setRoom: (r: RoomData | null) => void;
  setTtt: (t: TicTacToeState) => void;
  setLo: (l: LightsOutState) => void;
  setXq: (t: XiangqiState) => void;
  setMj: (v: MahjongView) => void;
  setEnv: (e: WorldEnv) => void;
  setVoiceRoster: (ids: number[]) => void;
  setScreenRoster: (ids: number[]) => void;
  setRoomDir: (r: RoomDirectoryEntry[]) => void;
}
export const useWorld = create<WorldStore>((set) => ({
  spaceKey: '',
  label: '',
  roster: [],
  seats: {},
  media: null,
  music: null,
  whiteboards: {},
  boards: {},
  switches: {},
  room: null,
  ttt: {},
  lo: {},
  xq: {},
  mj: {},
  env: { timeOfDay: 0.35, at: Date.now(), dayLengthSec: 1200, weather: 'clear' },
  voiceRoster: [],
  screenRoster: [],
  roomDir: [],
  applyInit: (init) => set({
    spaceKey: init.spaceKey,
    label: init.label,
    roster: init.players,
    seats: Object.fromEntries(init.seats.map((s) => [s.seatId, s.playerId])),
    media: init.media,
    music: init.music,
    whiteboards: init.whiteboards,
    boards: init.boards,
    switches: init.switches,
    room: init.room,
    ttt: Object.fromEntries(init.games.tictactoe.map((t) => [t.machineId, t])),
    lo: Object.fromEntries(init.games.lightsout.map((l) => [l.machineId, l])),
    xq: Object.fromEntries(init.games.xiangqi.map((t) => [t.tableId, t])),
    mj: Object.fromEntries(init.games.mahjong.map((v) => [v.pub.tableId, v])),
    voiceRoster: init.voiceRoster,
    screenRoster: init.screenRoster,
  }),
  addPlayer: (p) => set((s) => ({ roster: [...s.roster.filter((r) => r.id !== p.id), p] })),
  removePlayer: (id) => set((s) => ({ roster: s.roster.filter((r) => r.id !== id) })),
  updatePlayer: (p) => set((s) => ({ roster: s.roster.map((r) => (r.id === p.id ? p : r)) })),
  setSeat: (e) => set((s) => {
    const seats = { ...s.seats };
    if (e.released) delete seats[e.seatId];
    else seats[e.seatId] = e.playerId;
    return { seats };
  }),
  setMedia: (media) => set({ media }),
  setMusic: (music) => set({ music }),
  addStroke: (boardId, stroke) => set((s) => ({
    whiteboards: { ...s.whiteboards, [boardId]: [...(s.whiteboards[boardId] ?? []), stroke] },
  })),
  clearBoard: (boardId) => set((s) => ({ whiteboards: { ...s.whiteboards, [boardId]: [] } })),
  setBoardPosts: (boardId, posts) => set((s) => ({ boards: { ...s.boards, [boardId]: posts } })),
  setSwitch: (id, on) => set((s) => ({ switches: { ...s.switches, [id]: on } })),
  setRoom: (room) => set({ room }),
  setTtt: (t) => set((s) => ({ ttt: { ...s.ttt, [t.machineId]: t } })),
  setLo: (l) => set((s) => ({ lo: { ...s.lo, [l.machineId]: l } })),
  setXq: (t) => set((s) => ({ xq: { ...s.xq, [t.tableId]: t } })),
  setMj: (v) => set((s) => ({ mj: { ...s.mj, [v.pub.tableId]: v } })),
  setEnv: (env) => set({ env }),
  setVoiceRoster: (voiceRoster) => set({ voiceRoster }),
  setScreenRoster: (screenRoster) => set({ screenRoster }),
  setRoomDir: (roomDir) => set({ roomDir }),
}));

// ── Chat ────────────────────────────────────────────────────────────────────
interface ChatStore {
  messages: ChatMsg[];
  setAll: (m: ChatMsg[]) => void;
  push: (m: ChatMsg) => void;
}
export const useChat = create<ChatStore>((set) => ({
  messages: [],
  setAll: (messages) => set({ messages }),
  push: (m) => set((s) => ({ messages: [...s.messages.slice(-79), m] })),
}));

// ── UI ──────────────────────────────────────────────────────────────────────
export type PanelKind =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'avatar' }
  | { kind: 'help' }
  | { kind: 'inventory' }
  | { kind: 'media'; screenId: string }
  | { kind: 'whiteboard'; boardId: string }
  | { kind: 'board'; boardId: string }
  | { kind: 'jukebox' }
  | { kind: 'ttt'; machineId: string }
  | { kind: 'lightsout'; machineId: string }
  | { kind: 'xiangqi'; tableId: string }
  | { kind: 'mahjong'; tableId: string }
  | { kind: 'vending'; vendId: string; items: string[] }
  | { kind: 'kiosk' }
  | { kind: 'elevator' }
  | { kind: 'notes'; objectId: number }
  | { kind: 'storage'; objectId: number }
  | { kind: 'books'; source: string }
  | { kind: 'roomSettings' };

export interface Toast { id: number; level: 'info' | 'warn' | 'error'; text: string; }
export interface Prompt { label: string; key: string; }

interface UIStore {
  panel: PanelKind;
  prompt: Prompt | null;
  toasts: Toast[];
  dialogue: DialogueNode | null;
  editMode: boolean;
  editSelection: number | null;
  editPlacing: string | null;
  fade: boolean;
  showRoster: boolean;
  helpSeen: boolean;
  openPanel: (p: PanelKind) => void;
  closePanel: () => void;
  setPrompt: (p: Prompt | null) => void;
  toast: (level: Toast['level'], text: string) => void;
  dismissToast: (id: number) => void;
  setDialogue: (d: DialogueNode | null) => void;
  setEditMode: (on: boolean) => void;
  setEditSelection: (id: number | null) => void;
  setEditPlacing: (type: string | null) => void;
  setFade: (f: boolean) => void;
  setShowRoster: (v: boolean) => void;
  setHelpSeen: () => void;
}
let toastId = 1;
export const useUI = create<UIStore>((set) => ({
  panel: { kind: 'none' },
  prompt: null,
  toasts: [],
  dialogue: null,
  editMode: false,
  editSelection: null,
  editPlacing: null,
  fade: false,
  showRoster: false,
  helpSeen: localStorage.getItem('np_help_seen') === '1',
  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: { kind: 'none' } }),
  setPrompt: (prompt) => set((s) => {
    const a = s.prompt, b = prompt;
    if (a === b || (a && b && a.label === b.label && a.key === b.key)) return s;
    return { ...s, prompt };
  }),
  toast: (level, text) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, level, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setDialogue: (dialogue) => set({ dialogue }),
  setEditMode: (editMode) => set({ editMode, editSelection: null, editPlacing: null }),
  setEditSelection: (editSelection) => set({ editSelection, editPlacing: null }),
  setEditPlacing: (editPlacing) => set({ editPlacing, editSelection: null }),
  setFade: (fade) => set({ fade }),
  setShowRoster: (showRoster) => set({ showRoster }),
  setHelpSeen: () => { localStorage.setItem('np_help_seen', '1'); set({ helpSeen: true }); },
}));

// ── Settings ────────────────────────────────────────────────────────────────
export type Quality = 'low' | 'medium' | 'high' | 'ultra';
interface SettingsStore {
  quality: Quality;
  shadows: boolean;
  postfx: boolean;
  reflections: boolean;
  particles: boolean;
  clouds: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  mediaVolume: number;
  invertY: boolean;
  set: (p: Partial<SettingsStore>) => void;
  applyQuality: (q: Quality) => void;
}
const savedSettings = (() => {
  try { return JSON.parse(localStorage.getItem('np_settings') ?? '{}'); } catch { return {}; }
})();
export const useSettings = create<SettingsStore>((set, get) => ({
  quality: 'high',
  shadows: true,
  postfx: true,
  reflections: true,
  particles: true,
  clouds: true,
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.8,
  voiceVolume: 1.0,
  mediaVolume: 0.9,
  invertY: false,
  ...savedSettings,
  set: (p) => {
    set(p);
    const { set: _s, applyQuality: _a, ...rest } = get();
    localStorage.setItem('np_settings', JSON.stringify(rest));
  },
  applyQuality: (q) => {
    const presets: Record<Quality, Partial<SettingsStore>> = {
      low: { quality: q, shadows: false, postfx: false, reflections: false, particles: false, clouds: false },
      medium: { quality: q, shadows: true, postfx: false, reflections: false, particles: true, clouds: true },
      high: { quality: q, shadows: true, postfx: true, reflections: true, particles: true, clouds: true },
      ultra: { quality: q, shadows: true, postfx: true, reflections: true, particles: true, clouds: true },
    };
    get().set(presets[q]);
  },
}));

// ── Voice ───────────────────────────────────────────────────────────────────
interface VoiceStore {
  enabled: boolean;
  micLevel: number;
  error: string | null;
  peers: number[];
  screenOn: boolean;
  /** Bumped whenever a remote screen stream arrives/leaves (re-render hint). */
  screenVersion: number;
  setEnabled: (v: boolean) => void;
  setMicLevel: (v: number) => void;
  setError: (e: string | null) => void;
  setPeers: (p: number[]) => void;
  setScreenOn: (v: boolean) => void;
  bumpScreens: () => void;
}
export const useVoice = create<VoiceStore>((set) => ({
  enabled: false,
  micLevel: 0,
  error: null,
  peers: [],
  screenOn: false,
  screenVersion: 0,
  setEnabled: (enabled) => set({ enabled }),
  setMicLevel: (micLevel) => set({ micLevel }),
  setError: (error) => set({ error }),
  setPeers: (peers) => set({ peers }),
  setScreenOn: (screenOn) => set({ screenOn }),
  bumpScreens: () => set((s) => ({ screenVersion: s.screenVersion + 1 })),
}));

export function inventoryCount(inv: InventoryEntry[], id: string): number {
  return inv.find((i) => i.itemId === id)?.qty ?? 0;
}
export type { AvatarConfig };
