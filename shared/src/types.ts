import type { Weather } from './constants';

// ── Avatar ──────────────────────────────────────────────────────────────────
export interface AvatarConfig {
  /** Hex colors, e.g. "#e0ac69". */
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  /** 0 none, 1 cap, 2 beanie, 3 top hat. */
  hat: number;
  hatColor: string;
  glasses: boolean;
  /** 0..2 hair style: short, long, none(bald). */
  hairStyle: number;
}

export interface PublicProfile {
  /** Session id (small int, unique per connection). Negative ids are NPCs. */
  id: number;
  userId: number;
  username: string;
  avatar: AvatarConfig;
  isNpc?: boolean;
}

// ── Entity transforms (wire format: compact tuples) ─────────────────────────
/** [id, x, y, z, ry, stateInt] */
export type EntitySnap = [number, number, number, number, number, number];
/** [objectId, x, y, z] — dynamic objects such as the beach ball. */
export type ObjSnap = [string, number, number, number];

// ── Media ───────────────────────────────────────────────────────────────────
export type MediaKind = 'video' | 'youtube' | 'site';
export interface MediaState {
  url: string | null;
  kind: MediaKind | null;
  playing: boolean;
  /** Seconds into the media at `updatedAt`. */
  position: number;
  rate: number;
  loop: boolean;
  /** Server epoch ms when position was captured. */
  updatedAt: number;
  /** Username of who last changed it (display only). */
  setBy: string | null;
}

// ── Music (procedural synth jukebox) ────────────────────────────────────────
export interface MusicState {
  trackId: string | null;
  /** Server epoch ms at which the track (re)started. */
  startedAt: number;
  setBy: string | null;
}

// ── Whiteboard ──────────────────────────────────────────────────────────────
export interface Stroke {
  /** Flat [x0,y0,x1,y1,...] normalized 0..1 in board space. */
  pts: number[];
  color: string;
  width: number;
}

// ── Message boards ──────────────────────────────────────────────────────────
export interface BoardPost {
  id: number;
  userId: number;
  username: string;
  text: string;
  createdAt: number;
}

// ── Personal rooms ──────────────────────────────────────────────────────────
export type RoomVisibility = 'public' | 'private';
export type MediaControlPolicy = 'owner' | 'guests';
export type LightPreset = 'warm' | 'cool' | 'party';

export interface RoomStyle {
  wallColor: string;
  floorColor: string;
  ceilingColor: string;
  trimColor: string;
  lightPreset: LightPreset;
  /** Master ceiling lights on/off (wall switch). */
  lightsOn: boolean;
}

export interface RoomObject {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  color: string;
  /** Free-form per-object state, e.g. { on: true } for lamps, stash for wardrobe. */
  state: Record<string, unknown>;
}

export interface RoomData {
  ownerId: number;
  ownerName: string;
  name: string;
  visibility: RoomVisibility;
  mediaControl: MediaControlPolicy;
  style: RoomStyle;
  objects: RoomObject[];
  notes: string;
}

export interface RoomDirectoryEntry {
  ownerId: number;
  ownerName: string;
  name: string;
  visibility: RoomVisibility;
  online: number;
}

// ── Inventory / economy ─────────────────────────────────────────────────────
export interface InventoryEntry {
  itemId: string;
  qty: number;
}

// ── Arcade games ────────────────────────────────────────────────────────────
export interface TicTacToeState {
  machineId: string;
  /** 9 cells: 0 empty, 1 P1, 2 P2. */
  board: number[];
  players: [PublicProfile | null, PublicProfile | null];
  turn: 1 | 2;
  winner: 0 | 1 | 2 | 3; // 3 = draw
}
export interface LightsOutState {
  machineId: string;
  grid: boolean[]; // 25 cells
  moves: number;
  playerId: number | null;
  playerName: string | null;
  best: number | null;
}

// ── NPC dialogue ────────────────────────────────────────────────────────────
export interface DialogueNode {
  npcId: number;
  npcName: string;
  text: string;
  options: { id: string; label: string }[];
}

// ── World env ───────────────────────────────────────────────────────────────
export interface WorldEnv {
  /** Fraction of day 0..1 at `at` (server epoch ms). */
  timeOfDay: number;
  at: number;
  dayLengthSec: number;
  weather: Weather;
}

// ── Space snapshot sent on join/switch ──────────────────────────────────────
export interface SeatStateEntry {
  seatId: string;
  playerId: number;
}
export interface ChatMsg {
  from: string;
  fromId: number;
  text: string;
  ts: number;
  system?: boolean;
}

export interface SpaceInit {
  spaceKey: string;
  label: string;
  selfId: number;
  spawn: [number, number, number, number]; // x,y,z,ry
  players: PublicProfile[];
  snaps: EntitySnap[];
  seats: SeatStateEntry[];
  chat: ChatMsg[];
  media: MediaState | null;
  music: MusicState | null;
  whiteboards: Record<string, Stroke[]>;
  boards: Record<string, BoardPost[]>;
  switches: Record<string, boolean>;
  objs: ObjSnap[];
  room: RoomData | null;
  games: {
    tictactoe: TicTacToeState[];
    lightsout: LightsOutState[];
    xiangqi: import('./xiangqi').XiangqiState[];
    mahjong: import('./mahjong').MahjongView[];
  };
  voiceRoster: number[];
  /** 全服"全世界语音"广播者(可能不在本空间)。 */
  voiceWorldRoster: number[];
  screenRoster: number[];
}

export interface SelfState {
  userId: number;
  username: string;
  avatar: AvatarConfig;
  credits: number;
  inventory: InventoryEntry[];
  unlocks: string[];
}
