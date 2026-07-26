import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** server/ package root (works from src/ in dev and dist/ in prod). */
export const SERVER_ROOT = path.resolve(__dirname, fs.existsSync(path.join(__dirname, '..', 'package.json')) ? '..' : '../..');

// Load .env from repo root or server dir (tiny parser; no dependency).
for (const envPath of [path.join(SERVER_ROOT, '..', '.env'), path.join(SERVER_ROOT, '.env')]) {
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in process.env) && m[2] !== '') process.env[m[1]] = m[2];
    }
  }
}

const dataDir = path.join(SERVER_ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) return process.env.JWT_SECRET;
  const secretFile = path.join(dataDir, 'jwt-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '127.0.0.1',
  jwtSecret: resolveJwtSecret(),
  dbPath: path.isAbsolute(process.env.DB_PATH || '')
    ? (process.env.DB_PATH as string)
    : path.join(SERVER_ROOT, process.env.DB_PATH || './data/nexuspark.db'),
  clientOrigins: (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  stunServers: (process.env.STUN_SERVERS || 'stun:stun.l.google.com:19302')
    .split(',').map((s) => s.trim()).filter(Boolean),
  logLevel: (process.env.LOG_LEVEL || 'info') as 'silent' | 'error' | 'info' | 'debug',
};

const LEVELS = { silent: 0, error: 1, info: 2, debug: 3 };
export const log = {
  error: (...a: unknown[]) => { if (LEVELS[config.logLevel] >= 1) console.error('[error]', ...a); },
  info: (...a: unknown[]) => { if (LEVELS[config.logLevel] >= 2) console.log('[info]', ...a); },
  debug: (...a: unknown[]) => { if (LEVELS[config.logLevel] >= 3) console.log('[debug]', ...a); },
};
