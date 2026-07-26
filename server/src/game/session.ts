import type { WebSocket } from 'ws';
import type { AuthUser } from '../auth/auth.service';
import { TokenBucket } from '../util/rateLimiter';
import { encode } from '@nexuspark/shared';
import type { PublicProfile } from '@nexuspark/shared';

export interface Session {
  id: number;
  ws: WebSocket;
  user: AuthUser;
  spaceKey: string;
  x: number; y: number; z: number; ry: number;
  st: number;
  seq: number;
  seatId: string | null;
  voiceOn: boolean;
  /** 'near' = 就近语音(HRTF 衰减);'world' = 全世界语音(全服可闻)。 */
  voiceScope: 'near' | 'world';
  screenOn: boolean;
  alive: boolean;
  closed: boolean;
  lastInputAt: number;
  buckets: {
    input: TokenBucket;
    chat: TokenBucket;
    stroke: TokenBucket;
    rtc: TokenBucket;
    media: TokenBucket;
    board: TokenBucket;
    interact: TokenBucket;
    generic: TokenBucket;
  };
}

let nextSessionId = 1;

export function createSession(ws: WebSocket, user: AuthUser): Session {
  return {
    id: nextSessionId++,
    ws, user,
    spaceKey: '',
    x: 0, y: 0, z: 0, ry: 0,
    st: 0, seq: 0,
    seatId: null,
    voiceOn: false,
    voiceScope: 'near',
    screenOn: false,
    alive: true,
    closed: false,
    lastInputAt: Date.now(),
    buckets: {
      input: new TokenBucket(30, 60),
      chat: new TokenBucket(0.8, 4),
      stroke: new TokenBucket(30, 60),
      rtc: new TokenBucket(50, 120),
      media: new TokenBucket(0.5, 4),
      board: new TokenBucket(0.12, 2),
      interact: new TokenBucket(4, 10),
      generic: new TokenBucket(10, 25),
    },
  };
}

export function send(s: Session, t: string, d?: unknown): void {
  if (s.ws.readyState === s.ws.OPEN) s.ws.send(encode(t, d));
}

export function sendRaw(s: Session, raw: string): void {
  if (s.ws.readyState === s.ws.OPEN) s.ws.send(raw);
}

export function profileOf(s: Session): PublicProfile {
  return { id: s.id, userId: s.user.id, username: s.user.username, avatar: s.user.avatar };
}
