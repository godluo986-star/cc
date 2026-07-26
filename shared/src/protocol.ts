/**
 * Wire protocol. Every message is JSON: { t: string, d?: unknown }.
 * Client→server payloads are validated with zod on the server.
 */
import { z } from 'zod';
import {
  CHAT_MAX_LEN, MEDIA_URL_MAX_LEN, BOARD_POST_MAX_LEN, NOTES_MAX_LEN,
  WHITEBOARD_MAX_POINTS, ROOM_MAX_OBJECTS,
} from './constants';
import type {
  SpaceInit, SelfState, PublicProfile, EntitySnap, ObjSnap, MediaState, MusicState,
  Stroke, BoardPost, RoomData, RoomDirectoryEntry, ChatMsg, TicTacToeState,
  LightsOutState, DialogueNode, WorldEnv, SeatStateEntry,
} from './types';

// ── zod fragments ───────────────────────────────────────────────────────────
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const avatarSchema = z.object({
  skin: hexColor, hair: hexColor, shirt: hexColor, pants: hexColor, shoes: hexColor,
  hat: z.number().int().min(0).max(3),
  hatColor: hexColor,
  glasses: z.boolean(),
  hairStyle: z.number().int().min(0).max(2),
});
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const finite = z.number().finite();

// ── Client → Server messages ────────────────────────────────────────────────
export const c2s = {
  hello: z.object({ token: z.string().min(10).max(2000), v: z.number().int() }),
  input: z.object({
    p: vec3,
    ry: finite,
    st: z.number().int().min(0).max(1 << 20),
    seq: z.number().int().min(0),
  }),
  chat: z.object({ text: z.string().min(1).max(CHAT_MAX_LEN) }),
  switch_space: z.object({ target: z.string().min(1).max(64) }),
  sit: z.object({ seatId: z.string().min(1).max(64) }),
  stand: z.object({}),
  emote: z.object({ anim: z.number().int().min(5).max(9) }),
  avatar_update: z.object({ avatar: avatarSchema }),
  media_set: z.object({
    url: z.string().min(4).max(MEDIA_URL_MAX_LEN).optional(),
    loop: z.boolean().optional(),
    /** 投屏:把该会话(须在本空间且开着屏幕共享)的画面投上大屏;与 url 二选一。 */
    shareOwnerId: z.number().int().positive().optional(),
  }).refine((d) => (d.url !== undefined) !== (d.shareOwnerId !== undefined), {
    message: 'url 与 shareOwnerId 必须二选一',
  }),
  media_ctrl: z.object({
    op: z.enum(['play', 'pause', 'seek', 'rate', 'clear']),
    value: finite.optional(),
  }),
  music_set: z.object({ trackId: z.string().max(32).nullable() }),
  wb_stroke: z.object({
    boardId: z.string().min(1).max(64),
    pts: z.array(finite).min(4).max(WHITEBOARD_MAX_POINTS * 2),
    color: hexColor,
    width: z.number().min(0.001).max(0.05),
  }),
  wb_clear: z.object({ boardId: z.string().min(1).max(64) }),
  board_post: z.object({ boardId: z.string().min(1).max(64), text: z.string().min(1).max(BOARD_POST_MAX_LEN) }),
  board_delete: z.object({ boardId: z.string().min(1).max(64), postId: z.number().int() }),
  switch_toggle: z.object({ switchId: z.string().min(1).max(64) }),
  npc_talk: z.object({ npcId: z.number().int().max(-1), choice: z.string().max(64).optional() }),
  game_join: z.object({ machineId: z.string().min(1).max(32) }),
  game_leave: z.object({ machineId: z.string().min(1).max(32) }),
  game_move: z.object({ machineId: z.string().min(1).max(32), cell: z.number().int().min(0).max(24) }),
  xq_move: z.object({ tableId: z.string().min(1).max(32), from: z.number().int().min(0).max(89), to: z.number().int().min(0).max(89) }),
  mj_action: z.object({
    tableId: z.string().min(1).max(32),
    action: z.enum(['sit', 'leave', 'start', 'discard', 'pong', 'kong', 'hu', 'pass']),
    tile: z.number().int().min(0).max(33).optional(),
  }),
  room_edit: z.discriminatedUnion('op', [
    z.object({ op: z.literal('add'), type: z.string().max(32), x: finite, y: finite, z: finite, ry: finite, color: hexColor }),
    z.object({ op: z.literal('move'), id: z.number().int(), x: finite, y: finite, z: finite, ry: finite }),
    z.object({ op: z.literal('recolor'), id: z.number().int(), color: hexColor }),
    z.object({ op: z.literal('remove'), id: z.number().int() }),
    z.object({ op: z.literal('style'), wallColor: hexColor.optional(), floorColor: hexColor.optional(), ceilingColor: hexColor.optional(), trimColor: hexColor.optional(), lightPreset: z.enum(['warm', 'cool', 'party']).optional() }),
    z.object({ op: z.literal('rename'), name: z.string().min(1).max(40) }),
    z.object({ op: z.literal('visibility'), visibility: z.enum(['public', 'private']) }),
    z.object({ op: z.literal('mediaControl'), policy: z.enum(['owner', 'guests']) }),
    z.object({ op: z.literal('notes'), text: z.string().max(NOTES_MAX_LEN) }),
    z.object({ op: z.literal('objState'), id: z.number().int(), state: z.record(z.unknown()) }),
  ]),
  obj_toggle: z.object({ objectId: z.string().min(1).max(64) }),
  kick_ball: z.object({ dirX: finite, dirZ: finite }),
  buy: z.object({ itemId: z.string().max(32), source: z.string().max(32) }),
  unlock_furniture: z.object({ type: z.string().max(32) }),
  use_item: z.object({ itemId: z.string().max(32) }),
  stash: z.object({ objectId: z.number().int(), itemId: z.string().max(32), dir: z.enum(['toStash', 'toInventory']) }),
  voice_state: z.object({ on: z.boolean(), scope: z.enum(['near', 'world']).optional() }),
  screen_share: z.object({ on: z.boolean() }),
  rtc: z.object({
    to: z.number().int(),
    kind: z.enum(['offer', 'answer', 'ice']),
    payload: z.string().max(20000),
  }),
  elevator_list: z.object({}),
  ping: z.object({ t: z.number() }),
} as const;

export type C2SType = keyof typeof c2s;
export type C2SPayload<T extends C2SType> = z.infer<(typeof c2s)[T]>;

// ── Server → Client messages (plain types; server is trusted) ───────────────
export interface S2CMap {
  welcome: { self: SelfState; env: WorldEnv; space: SpaceInit; stun: string[] };
  space_init: SpaceInit;
  self_update: Partial<SelfState> & { credits?: number };
  player_join: { profile: PublicProfile };
  player_leave: { id: number; reason?: string };
  player_update: { profile: PublicProfile };
  snap: { t: number; e: EntitySnap[]; o?: ObjSnap[] };
  chat: ChatMsg;
  emote: { id: number; anim: number };
  seat: SeatStateEntry & { released?: boolean };
  media_state: MediaState;
  music_state: MusicState;
  wb_stroke: { boardId: string; stroke: Stroke };
  wb_clear: { boardId: string };
  board_state: { boardId: string; posts: BoardPost[] };
  switch_state: { switchId: string; on: boolean };
  npc_dialog: DialogueNode | { npcId: number; end: true };
  game_ttt: TicTacToeState;
  game_lo: LightsOutState;
  game_xq: import('./xiangqi').XiangqiState;
  game_mj: import('./mahjong').MahjongView;
  room_data: RoomData;
  room_dir: { rooms: RoomDirectoryEntry[] };
  env: WorldEnv;
  /** ids: 本空间开麦的人;world: 全服"全世界语音"广播者(跨空间可闻)。 */
  voice_roster: { ids: number[]; world: number[] };
  screen_roster: { ids: number[] };
  rtc: { from: number; kind: 'offer' | 'answer' | 'ice'; payload: string };
  correction: { p: [number, number, number] };
  toast: { level: 'info' | 'warn' | 'error'; text: string };
  kicked: { reason: string };
  pong: { t: number };
}
export type S2CType = keyof S2CMap;

export interface WireMsg { t: string; d?: unknown; }
export function encode<T extends string>(t: T, d?: unknown): string {
  return JSON.stringify(d === undefined ? { t } : { t, d });
}
export function safeParse(raw: string): WireMsg | null {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && typeof o.t === 'string') return o as WireMsg;
    return null;
  } catch {
    return null;
  }
}
export { ROOM_MAX_OBJECTS };
