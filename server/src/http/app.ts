import express from 'express';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthService } from '../auth/auth.service';
import { AuthError } from '../auth/auth.service';
import { KeyedLimiter } from '../util/rateLimiter';
import { config, log, SERVER_ROOT } from '../config';

const loginLimiter = new KeyedLimiter(0.2, 12);    // ~12 tries then 1 per 5s
const registerLimiter = new KeyedLimiter(0.05, 6); // 6 registrations, then 1 per 20s

export function createApp(auth: AuthService): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression());
  app.use(express.json({ limit: '32kb' }));

  // Dev CORS (the production server serves the client itself, same-origin)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.clientOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  const ip = (req: express.Request) => (req.socket.remoteAddress ?? 'unknown');

  app.get('/healthz', (_req, res) => { res.json({ ok: true }); });

  app.post('/api/register', (req, res) => {
    if (!registerLimiter.take(ip(req))) { res.status(429).json({ error: '注册太频繁,稍后再试。' }); return; }
    const { username, password } = req.body ?? {};
    try {
      res.json(auth.register(String(username ?? ''), String(password ?? '')));
    } catch (e) {
      if (e instanceof AuthError) { res.status(400).json({ error: e.message, code: e.code }); return; }
      log.error('register failed', e);
      res.status(500).json({ error: '注册失败了。' });
    }
  });

  app.post('/api/login', (req, res) => {
    if (!loginLimiter.take(ip(req))) { res.status(429).json({ error: '尝试太频繁,休息一下。' }); return; }
    const { username, password } = req.body ?? {};
    try {
      res.json(auth.login(String(username ?? ''), String(password ?? '')));
    } catch (e) {
      if (e instanceof AuthError) { res.status(401).json({ error: e.message, code: e.code }); return; }
      log.error('login failed', e);
      res.status(500).json({ error: '登录失败了。' });
    }
  });

  app.post('/api/guest', (req, res) => {
    if (!registerLimiter.take(ip(req))) { res.status(429).json({ error: '游客创建太频繁,稍后再试。' }); return; }
    try {
      res.json(auth.guest());
    } catch (e) {
      if (e instanceof AuthError) { res.status(400).json({ error: e.message, code: e.code }); return; }
      log.error('guest failed', e);
      res.status(500).json({ error: '游客登录失败了。' });
    }
  });

  app.get('/api/session', (req, res) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try {
      const user = auth.verifyToken(token);
      res.json({ user: { id: user.id, username: user.username, avatar: user.avatar, credits: user.credits, isGuest: user.isGuest } });
    } catch {
      res.status(401).json({ error: '登录状态无效。' });
    }
  });

  // ── Static client (production build) ──────────────────────────────────────
  const clientDist = path.resolve(SERVER_ROOT, '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, {
      maxAge: '1y', immutable: true, index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.get(/^\/(?!api\/|ws$).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    log.info('serving client from', clientDist);
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send('Nexus Park server is running. Client build not found — run `npm run build -w client`, or use the Vite dev server (npm run dev).');
    });
  }

  return app;
}
