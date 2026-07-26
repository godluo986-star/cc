import type { WebSocket } from 'ws';
import { openDatabase } from '../src/db/database';
import type { DB } from '../src/db/database';
import { AuthService } from '../src/auth/auth.service';
import { World } from '../src/game/world';
import { createSession } from '../src/game/session';
import type { Session } from '../src/game/session';

export function memoryDb(): DB {
  return openDatabase(':memory:');
}

export interface FakeWs {
  readyState: number;
  OPEN: number;
  sent: Array<{ t: string; d?: unknown }>;
  send: (raw: string) => void;
  close: () => void;
  ping: () => void;
  terminate: () => void;
  on: () => void;
}

export function fakeWs(): FakeWs {
  const ws: FakeWs = {
    readyState: 1,
    OPEN: 1,
    sent: [],
    send(raw: string) { ws.sent.push(JSON.parse(raw)); },
    close() { ws.readyState = 3; },
    ping() { /* noop */ },
    terminate() { ws.readyState = 3; },
    on() { /* noop */ },
  };
  return ws;
}

export function testRig() {
  const db = memoryDb();
  const auth = new AuthService(db);
  const world = new World(db);
  const mkSession = (username: string, password = 'password123'): { session: Session; ws: FakeWs } => {
    const { user } = auth.register(username, password);
    const ws = fakeWs();
    const session = createSession(ws as unknown as WebSocket, user);
    world.sessionsById.set(session.id, session);
    world.sessionsByUser.set(user.id, session);
    return { session, ws };
  };
  return { db, auth, world, mkSession };
}

export function lastOf(ws: FakeWs, type: string): { t: string; d?: any } | undefined {
  for (let i = ws.sent.length - 1; i >= 0; i--) {
    if (ws.sent[i].t === type) return ws.sent[i];
  }
  return undefined;
}
