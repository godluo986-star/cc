import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { DB } from '../db/database';
import { config } from '../config';
import {
  USERNAME_RE, PASSWORD_MIN_LEN, STARTING_CREDITS, DAILY_LOGIN_BONUS,
} from '@nexuspark/shared';
import type { AvatarConfig } from '@nexuspark/shared';
import { createDefaultRoom } from '../game/roomService';

export interface UserRow {
  id: number;
  username: string;
  pass_hash: string;
  avatar: string;
  credits: number;
  is_guest: number;
  last_login_day: string | null;
  last_space: string | null;
  last_pos: string | null;
}

export interface AuthUser {
  id: number;
  username: string;
  avatar: AvatarConfig;
  credits: number;
  isGuest: boolean;
  lastSpace: string | null;
  lastPos: [number, number, number] | null;
  dailyBonus: number;
}

export class AuthError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const DEFAULT_AVATAR: AvatarConfig = {
  skin: '#e0ac69', hair: '#3b2a1d', shirt: '#4f7fbf', pants: '#33384a',
  shoes: '#23252b', hat: 0, hatColor: '#c0392b', glasses: false, hairStyle: 0,
};

function randomAvatar(): AvatarConfig {
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  return {
    skin: pick(['#f5d0a9', '#e0ac69', '#c68863', '#8d5524', '#f8e0c0']),
    hair: pick(['#2c1b10', '#4a3220', '#8c5a2b', '#b5651d', '#1f1f1f', '#7a3b8f', '#b03a48']),
    shirt: pick(['#4f7fbf', '#bf4f6f', '#3f9f6f', '#bf8f3f', '#7f5fbf', '#3fa9bf']),
    pants: pick(['#33384a', '#4a3333', '#2f4a33', '#3d3d3d']),
    shoes: pick(['#23252b', '#5a3a22', '#7a7a7a']),
    hat: Math.random() < 0.35 ? Math.floor(Math.random() * 3) + 1 : 0,
    hatColor: pick(['#c0392b', '#2c3e50', '#8e44ad', '#d4a017']),
    glasses: Math.random() < 0.25,
    hairStyle: Math.floor(Math.random() * 3),
  };
}

export class AuthService {
  constructor(private db: DB) {}

  register(username: string, password: string): { token: string; user: AuthUser } {
    if (!USERNAME_RE.test(username)) {
      throw new AuthError('bad_username', 'Username must be 3-20 characters: letters, digits, underscore.');
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LEN) {
      throw new AuthError('bad_password', `Password must be at least ${PASSWORD_MIN_LEN} characters.`);
    }
    const exists = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) throw new AuthError('taken', 'That username is already taken.');
    const hash = bcrypt.hashSync(password, 10);
    const info = this.db.prepare(
      'INSERT INTO users (username, pass_hash, avatar, credits, is_guest, created_at, last_login_day) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).run(username, hash, JSON.stringify(randomAvatar()), STARTING_CREDITS, Date.now(), today());
    const id = Number(info.lastInsertRowid);
    createDefaultRoom(this.db, id, username);
    return this.issue(this.loadUser(id, 0));
  }

  login(username: string, password: string): { token: string; user: AuthUser } {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!row || !bcrypt.compareSync(password, row.pass_hash)) {
      throw new AuthError('bad_credentials', 'Wrong username or password.');
    }
    const bonus = this.applyDailyBonus(row);
    return this.issue(this.loadUser(row.id, bonus));
  }

  /** Creates a lightweight persistent guest account. */
  guest(): { token: string; user: AuthUser } {
    for (let attempt = 0; attempt < 50; attempt++) {
      const name = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
      const exists = this.db.prepare('SELECT id FROM users WHERE username = ?').get(name);
      if (exists) continue;
      const info = this.db.prepare(
        'INSERT INTO users (username, pass_hash, avatar, credits, is_guest, created_at, last_login_day) VALUES (?, ?, ?, ?, 1, ?, ?)'
      ).run(name, bcrypt.hashSync(cryptoRandom(), 8), JSON.stringify(randomAvatar()), STARTING_CREDITS, Date.now(), today());
      const id = Number(info.lastInsertRowid);
      createDefaultRoom(this.db, id, name);
      return this.issue(this.loadUser(id, 0));
    }
    throw new AuthError('guest_exhausted', 'Could not allocate a guest slot, please register.');
  }

  verifyToken(token: string): AuthUser {
    let payload: { uid: number };
    try {
      payload = jwt.verify(token, config.jwtSecret) as { uid: number };
    } catch {
      throw new AuthError('bad_token', 'Session expired — please sign in again.');
    }
    const row = this.db.prepare('SELECT id FROM users WHERE id = ?').get(payload.uid) as { id: number } | undefined;
    if (!row) throw new AuthError('gone', 'Account no longer exists.');
    const full = this.db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid) as UserRow;
    const bonus = this.applyDailyBonus(full);
    return this.loadUser(payload.uid, bonus);
  }

  private applyDailyBonus(row: UserRow): number {
    if (row.is_guest) return 0;
    const day = today();
    if (row.last_login_day === day) return 0;
    this.db.prepare('UPDATE users SET last_login_day = ?, credits = credits + ? WHERE id = ?')
      .run(day, DAILY_LOGIN_BONUS, row.id);
    return DAILY_LOGIN_BONUS;
  }

  loadUser(id: number, dailyBonus = 0): AuthUser {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    let avatar: AvatarConfig;
    try { avatar = { ...DEFAULT_AVATAR, ...JSON.parse(row.avatar) }; } catch { avatar = { ...DEFAULT_AVATAR }; }
    let lastPos: [number, number, number] | null = null;
    try {
      const p = row.last_pos ? JSON.parse(row.last_pos) : null;
      if (Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n))) lastPos = p as [number, number, number];
    } catch { /* ignore */ }
    return {
      id: row.id, username: row.username, avatar, credits: row.credits,
      isGuest: !!row.is_guest, lastSpace: row.last_space, lastPos, dailyBonus,
    };
  }

  private issue(user: AuthUser): { token: string; user: AuthUser } {
    const token = jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '7d' });
    return { token, user };
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const cryptoRandom = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
