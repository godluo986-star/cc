import { describe, it, expect } from 'vitest';
import { memoryDb } from './helpers';
import { AuthService, AuthError } from '../src/auth/auth.service';
import { loadRoom } from '../src/game/roomService';

describe('AuthService', () => {
  it('registers, logs in, and verifies tokens', () => {
    const db = memoryDb();
    const auth = new AuthService(db);
    const { token, user } = auth.register('alice', 'supersecret1');
    expect(user.username).toBe('alice');
    expect(user.credits).toBeGreaterThan(0);
    const verified = auth.verifyToken(token);
    expect(verified.id).toBe(user.id);

    const login = auth.login('alice', 'supersecret1');
    expect(login.user.id).toBe(user.id);
    expect(() => auth.login('alice', 'wrongpass99')).toThrow(AuthError);
  });

  it('rejects invalid usernames and short passwords', () => {
    const auth = new AuthService(memoryDb());
    expect(() => auth.register('a', 'supersecret1')).toThrow(AuthError);
    expect(() => auth.register('has spaces', 'supersecret1')).toThrow(AuthError);
    expect(() => auth.register('bob', 'short')).toThrow(AuthError);
  });

  it('prevents duplicate usernames case-insensitively', () => {
    const auth = new AuthService(memoryDb());
    auth.register('Carol', 'supersecret1');
    expect(() => auth.register('carol', 'supersecret1')).toThrow(AuthError);
  });

  it('creates a default room with starter furniture', () => {
    const db = memoryDb();
    const auth = new AuthService(db);
    const { user } = auth.register('dave', 'supersecret1');
    const room = loadRoom(db, user.id);
    expect(room).toBeTruthy();
    expect(room!.objects.length).toBeGreaterThan(5);
    expect(room!.visibility).toBe('public');
    expect(room!.objects.some((o) => o.type === 'tv')).toBe(true);
  });

  it('creates guests with rooms', () => {
    const db = memoryDb();
    const auth = new AuthService(db);
    const { token, user } = auth.guest();
    expect(user.isGuest).toBe(true);
    expect(user.username).toMatch(/^Guest_/);
    expect(auth.verifyToken(token).id).toBe(user.id);
    expect(loadRoom(db, user.id)).toBeTruthy();
  });

  it('rejects tampered tokens', () => {
    const auth = new AuthService(memoryDb());
    expect(() => auth.verifyToken('nonsense.token.value')).toThrow(AuthError);
  });
});
