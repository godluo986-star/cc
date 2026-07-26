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
  // ── 抓取(第一阶段:单人抓单团子)────────────────────────────────────────
  /** 正被哪个会话抓着(被抓者视角);null = 自由身。 */
  grabbedBy: number | null;
  /** 正抓着哪个会话(抓取者视角)。 */
  grabbing: number | null;
  /** 目标身体局部抓取点(|分量|≤0.6),影响客户端倾斜表现。 */
  grabPointLocal: [number, number, number] | null;
  /** 抓取者期望的把持点世界坐标(move 更新,tick 里作弹簧目标)。 */
  grabTargetWorld: [number, number, number] | null;
  /** 被抓/抛落模拟速度。 */
  grabVel: [number, number, number];
  /** 挣扎积累秒数;达到 ESCAPE_BREAK 即挣脱。 */
  escapeAccum: number;
  /** 被抓期间输入化成的挣扎方向(单位向量;零向量 = 不挣扎)。 */
  escapeDir: [number, number, number];
  /** 松手/挣脱后的自由抛落阶段(落地即恢复正常输入位移)。 */
  grabAirborne: boolean;
  /** 免抓保护(后续设置项;默认 false)。 */
  noGrab: boolean;
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
    grabbedBy: null,
    grabbing: null,
    grabPointLocal: null,
    grabTargetWorld: null,
    grabVel: [0, 0, 0],
    escapeAccum: 0,
    escapeDir: [0, 0, 0],
    grabAirborne: false,
    noGrab: false,
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
