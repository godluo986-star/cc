import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config, log } from '../config';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  avatar TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 120,
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_day TEXT,
  last_space TEXT,
  last_pos TEXT
);
CREATE TABLE IF NOT EXISTS rooms (
  owner_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  media_control TEXT NOT NULL DEFAULT 'owner',
  style TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS room_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
  ry REAL NOT NULL,
  color TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_room_objects_owner ON room_objects(owner_id);
CREATE TABLE IF NOT EXISTS inventory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS unlocks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  furniture_type TEXT NOT NULL,
  PRIMARY KEY (user_id, furniture_type)
);
CREATE TABLE IF NOT EXISTS board_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_board_posts_key ON board_posts(board_key);
CREATE TABLE IF NOT EXISTS whiteboards (
  board_key TEXT PRIMARY KEY,
  strokes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_states (
  space_key TEXT PRIMARY KEY,
  url TEXT, kind TEXT,
  playing INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 1,
  loop INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  set_by TEXT
);
CREATE TABLE IF NOT EXISTS world_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDatabase(dbPath = config.dbPath): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  log.debug('database open at', dbPath);
  return db;
}

export function kvGet<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM world_kv WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}
export function kvSet(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO world_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
