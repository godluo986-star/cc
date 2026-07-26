import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { World } from '../game/world';
import type { AuthService } from '../auth/auth.service';
import { AuthError } from '../auth/auth.service';
import { createSession, send } from '../game/session';
import type { Session } from '../game/session';
import { handlers } from '../game/handlers';
import { safeParse, c2s, MAX_WS_FRAME, PROTOCOL_VERSION, HEARTBEAT_INTERVAL_MS } from '@nexuspark/shared';
import { config, log } from '../config';

interface PendingSocket {
  ws: WebSocket;
  timer: ReturnType<typeof setTimeout>;
}

export function attachGateway(server: Server, world: World, auth: AuthService): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_WS_FRAME,
    verifyClient: ({ origin }: { origin?: string }, done: (ok: boolean, code?: number) => void) => {
      // Browsers always send Origin; allow same-origin (no origin header for
      // non-browser clients such as tests) plus configured dev origins.
      if (!origin) return done(true);
      try {
        const o = new URL(origin);
        const sameHost = o.hostname === 'localhost' || o.hostname === '127.0.0.1' || o.hostname === config.host;
        if (sameHost || config.clientOrigins.includes(origin)) return done(true);
      } catch { /* fallthrough */ }
      log.info('rejected ws origin', origin);
      done(false, 403);
    },
  });

  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    let session: Session | null = null;
    const helloTimer = setTimeout(() => {
      if (!session) ws.close(4000, 'hello timeout');
    }, 8000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const raw = data.toString();
      const msg = safeParse(raw);
      if (!msg) return;

      if (!session) {
        if (msg.t !== 'hello') return;
        const parsed = c2s.hello.safeParse(msg.d);
        if (!parsed.success) { ws.close(4001, 'bad hello'); return; }
        if (parsed.data.v !== PROTOCOL_VERSION) { ws.close(4002, '版本不一致,请刷新页面'); return; }
        let user;
        try {
          user = auth.verifyToken(parsed.data.token);
        } catch (e) {
          const m = e instanceof AuthError ? e.message : 'auth failed';
          ws.send(JSON.stringify({ t: 'kicked', d: { reason: m } }));
          ws.close(4003, 'auth');
          return;
        }
        clearTimeout(helloTimer);
        // one live session per account
        const existing = world.sessionsByUser.get(user.id);
        if (existing) {
          send(existing, 'kicked', { reason: '你在其他窗口登录了。' });
          existing.ws.close(4008, 'superseded');
          world.disconnect(existing, true);
        }
        session = createSession(ws, user);
        world.sessionsById.set(session.id, session);
        world.sessionsByUser.set(user.id, session);
        const entry = world.entryFor(user.id, user.lastSpace, user.lastPos);
        const init = world.join(session, entry.spaceKey, entry.spawn);
        if (!init) { ws.close(1011, 'join failed'); return; }
        send(session, 'welcome', {
          self: world.buildSelfState(session),
          env: world.envState(),
          space: init,
          stun: config.stunServers,
        });
        if (user.dailyBonus > 0) {
          send(session, 'toast', { level: 'info', text: `每日登录奖励:+${user.dailyBonus} 金币!` });
        }
        log.info(`join user=${user.username} session=${session.id} space=${entry.spaceKey}`);
        return;
      }

      const handler = handlers[msg.t];
      const schema = (c2s as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>)[msg.t];
      if (!handler || !schema) return;
      const parsed = schema.safeParse(msg.d ?? {});
      if (!parsed.success) { log.debug('invalid payload', msg.t); return; }
      try {
        handler(world, session, parsed.data as never);
      } catch (e) {
        log.error('handler error', msg.t, e);
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (session && !session.closed) {
        log.info(`leave user=${session.user.username} session=${session.id}`);
        world.disconnect(session);
      }
    });
    ws.on('error', (e) => log.debug('ws error', e.message));
  });

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on('close', () => clearInterval(hb));

  return wss;
}
