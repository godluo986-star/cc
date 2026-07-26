/** End-to-end test: real HTTP server + WebSocket gateway + a live client. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { AddressInfo } from 'node:net';
import { openDatabase } from '../src/db/database';
import { AuthService } from '../src/auth/auth.service';
import { World } from '../src/game/world';
import { createApp } from '../src/http/app';
import { attachGateway } from '../src/ws/gateway';
import { PROTOCOL_VERSION, packState, Anim } from '@nexuspark/shared';

let server: http.Server;
let world: World;
let port: number;

beforeAll(async () => {
  const db = openDatabase(':memory:');
  const auth = new AuthService(db);
  world = new World(db);
  const app = createApp(auth);
  server = http.createServer(app);
  attachGateway(server, world, auth);
  world.start();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  world.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function api(path: string, body: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

interface TestClient {
  ws: WebSocket;
  messages: Array<{ t: string; d?: any }>;
  next: (type: string, timeoutMs?: number, match?: (d: any) => boolean) => Promise<any>;
  send: (t: string, d?: unknown) => void;
  close: () => void;
}

function connect(token: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: TestClient['messages'] = [];
    const waiters: Array<{ type: string; match?: (d: any) => boolean; resolve: (d: any) => void }> = [];
    const client: TestClient = {
      ws, messages,
      next: (type, timeoutMs = 3000, match) => new Promise((res, rej) => {
        const existing = messages.find((m) => m.t === type && (!match || match(m.d)));
        if (existing) { res(existing.d); return; }
        const timer = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), timeoutMs);
        waiters.push({ type, match, resolve: (d) => { clearTimeout(timer); res(d); } });
      }),
      send: (t, d) => ws.send(JSON.stringify({ t, d })),
      close: () => ws.close(),
    };
    ws.on('open', () => {
      client.send('hello', { token, v: PROTOCOL_VERSION });
      resolve(client);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].type === msg.t && (!waiters[i].match || waiters[i].match!(msg.d))) {
          const w = waiters.splice(i, 1)[0];
          w.resolve(msg.d);
        }
      }
    });
    ws.on('error', reject);
  });
}

describe('end-to-end multiplayer', () => {
  it('registers over HTTP, connects over WS, sees another player move', async () => {
    const reg1 = await api('/api/register', { username: 'e2e_alice', password: 'password123' });
    expect(reg1.status).toBe(200);
    const reg2 = await api('/api/register', { username: 'e2e_bob', password: 'password123' });

    const alice = await connect(reg1.json.token);
    const welcomeA = await alice.next('welcome');
    expect(welcomeA.space.spaceKey).toBe('plaza');
    expect(welcomeA.self.username).toBe('e2e_alice');
    expect(welcomeA.self.credits).toBeGreaterThan(0);

    const bob = await connect(reg2.json.token);
    const welcomeB = await bob.next('welcome');
    const [bx, , bz] = welcomeB.space.spawn;

    // Alice hears about Bob joining
    const joined = await alice.next('player_join');
    expect(joined.profile.username).toBe('e2e_bob');

    // Bob moves; Alice sees it in a snapshot
    bob.send('input', { p: [bx + 0.5, 0, bz - 0.5], ry: 1, st: packState(Anim.Walk, false, 0), seq: 1 });
    const bobId = welcomeB.space.selfId;
    await new Promise((r) => setTimeout(r, 250));
    const snaps = alice.messages.filter((m) => m.t === 'snap');
    const seen = snaps.some((s) => (s.d.e as number[][]).some((e) => e[0] === bobId && Math.abs(e[1] - (bx + 0.5)) < 0.01));
    expect(seen).toBe(true);

    // Chat round-trip
    bob.send('chat', { text: 'hello world' });
    const chat = await alice.next('chat', 3000, (d) => !d.system && d.text === 'hello world');
    expect(chat.from).toBe('e2e_bob');

    alice.close();
    bob.close();
  });

  it('rejects a bad token and duplicate logins supersede', async () => {
    const bad = await new Promise<{ code: number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', d: { token: 'garbage.token.here', v: PROTOCOL_VERSION } })));
      ws.on('close', (code) => resolve({ code }));
    });
    expect(bad.code).toBe(4003);

    const reg = await api('/api/register', { username: 'e2e_carol', password: 'password123' });
    const first = await connect(reg.json.token);
    await first.next('welcome');
    const second = await connect(reg.json.token);
    await second.next('welcome');
    const kicked = await first.next('kicked');
    expect(kicked.reason).toMatch(/another window/i);
    second.close();
  });

  it('guest flow works over HTTP', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/guest`, { method: 'POST' });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.user.username).toMatch(/^Guest_/);
    const client = await connect(body.token);
    const welcome = await client.next('welcome');
    expect(welcome.space.spaceKey).toBe('plaza');
    client.close();
  });

  it('health endpoint responds', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(((await res.json()) as any).ok).toBe(true);
  });
});
