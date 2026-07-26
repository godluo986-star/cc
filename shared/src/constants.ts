/** Protocol + gameplay constants shared by client and server. */

export const PROTOCOL_VERSION = 1;

/** Server snapshot broadcast rate (Hz). */
export const SNAPSHOT_RATE = 10;
/** Client input send rate (Hz). */
export const INPUT_RATE = 15;
/** How far (ms) behind live remote entities are rendered for interpolation. */
export const INTERP_DELAY_MS = 130;

// ── Movement tuning ──────────────────────────────────────────────────────────
export const WALK_SPEED = 3.1; // m/s
export const RUN_SPEED = 6.4; // m/s
export const JUMP_VELOCITY = 5.4; // m/s
export const GRAVITY = 15.5; // m/s²
export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT = 1.7;
/** Server-side anti-teleport tolerance (m/s, generous for jumps + lag). */
export const MAX_VALID_SPEED = 11;

// ── Interaction ──────────────────────────────────────────────────────────────
export const INTERACT_RANGE = 3.4;
export const VOICE_RANGE = 24; // metres, spatial voice audibility
export const VOICE_CONNECT_RANGE = 27; // hysteresis: connect below, drop above

// ── World clock / weather ───────────────────────────────────────────────────
/** One full in-game day, in real seconds (20 minutes). */
export const DAY_LENGTH_SEC = 1200;
/** Fraction of the day at which a fresh world starts (mid-morning). */
export const DAY_START_FRACTION = 0.35;
export type Weather = 'clear' | 'cloudy' | 'rain';
export const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain'];
export const WEATHER_MIN_SEC = 150;
export const WEATHER_MAX_SEC = 420;

// ── Chat / boards / limits ──────────────────────────────────────────────────
export const CHAT_MAX_LEN = 300;
export const CHAT_HISTORY = 60;
export const BOARD_POST_MAX_LEN = 240;
export const BOARD_MAX_POSTS = 40;
export const NOTES_MAX_LEN = 4000;
export const WHITEBOARD_MAX_STROKES = 500;
export const WHITEBOARD_MAX_POINTS = 160;
export const ROOM_MAX_OBJECTS = 90;
export const MEDIA_URL_MAX_LEN = 600;
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
export const PASSWORD_MIN_LEN = 8;
export const MAX_WS_FRAME = 64 * 1024;

// ── Economy ─────────────────────────────────────────────────────────────────
export const STARTING_CREDITS = 120;
export const DAILY_LOGIN_BONUS = 25;

// ── Animation state ─────────────────────────────────────────────────────────
/** Locomotion / pose channel (mutually exclusive). */
export enum Anim {
  Idle = 0,
  Walk = 1,
  Run = 2,
  Jump = 3,
  Sit = 4,
  Wave = 5,
  Dance = 6,
  Clap = 7,
  Point = 8,
  Laugh = 9,
}
export const EMOTES: { anim: Anim; label: string; icon: string }[] = [
  { anim: Anim.Wave, label: '挥手', icon: '👋' },
  { anim: Anim.Dance, label: '跳舞', icon: '🕺' },
  { anim: Anim.Clap, label: '鼓掌', icon: '👏' },
  { anim: Anim.Point, label: '指一指', icon: '👉' },
  { anim: Anim.Laugh, label: '大笑', icon: '😂' },
];
/** Bit flags packed alongside anim in the state integer. */
export const ST_SPEAKING = 1 << 6;
/** state int layout: bits 0-5 = Anim, bit 6 = speaking, bits 8+ = held item id. */
export function packState(anim: Anim, speaking: boolean, held: number): number {
  return (anim & 63) | (speaking ? ST_SPEAKING : 0) | ((held & 255) << 8);
}
export function unpackState(st: number): { anim: Anim; speaking: boolean; held: number } {
  return { anim: (st & 63) as Anim, speaking: (st & ST_SPEAKING) !== 0, held: (st >> 8) & 255 };
}

// ── Held item ids (visual props attached to the avatar's hand) ──────────────
export enum HeldItem {
  None = 0,
  Coffee = 1,
  Soda = 2,
  Pizza = 3,
  Book = 4,
}

// ── Space keys ──────────────────────────────────────────────────────────────
export const SPACE = {
  PLAZA: 'plaza',
  CAFE: 'cafe',
  CINEMA: 'cinema',
  ARCADE: 'arcade',
  SHOP: 'shop',
  LOBBY: 'lobby',
} as const;
export type PublicSpaceKey = (typeof SPACE)[keyof typeof SPACE];
export const PUBLIC_SPACES: PublicSpaceKey[] = Object.values(SPACE);
export const roomSpaceKey = (ownerId: number) => `room:${ownerId}`;
export const isRoomSpace = (key: string) => key.startsWith('room:');
export const roomOwnerId = (key: string): number | null =>
  isRoomSpace(key) ? Number(key.slice(5)) || null : null;

// ── Misc timings ────────────────────────────────────────────────────────────
export const HEARTBEAT_INTERVAL_MS = 15000;
export const HEARTBEAT_TIMEOUT_MS = 35000;
export const RESUME_GRACE_MS = 75000;
export const EMOTE_DURATION_MS = 3200;
export const HOLD_ITEM_DURATION_MS = 90000;
