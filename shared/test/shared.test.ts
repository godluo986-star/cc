import { describe, it, expect } from 'vitest';
import {
  packState, unpackState, Anim, roomSpaceKey, roomOwnerId, isRoomSpace,
} from '../src/constants';
import { c2s, safeParse, encode } from '../src/protocol';
import { resolveCollisions, clampToBounds, angleLerp, seededRandom } from '../src/math';
import { LAYOUTS, floorHeightAt } from '../src/layouts';
import { FURNITURE, FURNITURE_BY_TYPE, ITEMS_BY_ID } from '../src/catalog';

describe('state packing', () => {
  it('round-trips anim/speaking/held', () => {
    const st = packState(Anim.Run, true, 3);
    expect(unpackState(st)).toEqual({ anim: Anim.Run, speaking: true, held: 3 });
    const st2 = packState(Anim.Sit, false, 0);
    expect(unpackState(st2)).toEqual({ anim: Anim.Sit, speaking: false, held: 0 });
  });
});

describe('space keys', () => {
  it('builds and parses room keys', () => {
    expect(roomSpaceKey(42)).toBe('room:42');
    expect(isRoomSpace('room:42')).toBe(true);
    expect(roomOwnerId('room:42')).toBe(42);
    expect(roomOwnerId('plaza')).toBe(null);
  });
});

describe('protocol', () => {
  it('accepts valid input messages', () => {
    expect(c2s.input.safeParse({ p: [1, 0, 2], ry: 0.5, st: 0, seq: 1 }).success).toBe(true);
    expect(c2s.chat.safeParse({ text: 'hello' }).success).toBe(true);
  });
  it('rejects garbage', () => {
    expect(c2s.input.safeParse({ p: [1, 0], ry: 0, st: 0, seq: 0 }).success).toBe(false);
    expect(c2s.input.safeParse({ p: [NaN, 0, 0], ry: 0, st: 0, seq: 0 }).success).toBe(false);
    expect(c2s.chat.safeParse({ text: '' }).success).toBe(false);
    expect(c2s.media_set.safeParse({ url: 'x'.repeat(2000) }).success).toBe(false);
    expect(c2s.room_edit.safeParse({ op: 'add', type: 'sofa', x: 0, y: 0, z: 0, ry: 0, color: 'red' }).success).toBe(false);
  });
  it('wire encode/parse round-trip', () => {
    const raw = encode('chat', { text: 'hi' });
    const msg = safeParse(raw);
    expect(msg?.t).toBe('chat');
    expect(safeParse('not json')).toBe(null);
    expect(safeParse('{"x":1}')).toBe(null);
  });
});

describe('collisions', () => {
  it('pushes player out of a box', () => {
    const [x, z] = resolveCollisions(0.2, 0, 0.3, [{ kind: 'box', x: 0, z: 0, w: 2, d: 2 }]);
    expect(Math.abs(x) + Math.abs(z)).toBeGreaterThan(1.2);
  });
  it('pushes player out of a circle', () => {
    const [x, z] = resolveCollisions(0.5, 0, 0.3, [{ kind: 'circle', x: 0, z: 0, r: 1 }]);
    expect(Math.hypot(x, z)).toBeCloseTo(1.3, 5);
  });
  it('clamps to bounds', () => {
    const [x, z] = clampToBounds(999, -999, { minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
    expect(x).toBeLessThanOrEqual(10);
    expect(z).toBeGreaterThanOrEqual(-10);
  });
});

describe('angleLerp', () => {
  it('takes the short way around', () => {
    const r = angleLerp(Math.PI * 0.9, -Math.PI * 0.9, 0.5);
    expect(Math.abs(Math.abs(r) - Math.PI)).toBeLessThan(0.01);
  });
});

describe('seededRandom', () => {
  it('is deterministic', () => {
    const a = seededRandom(7); const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('layouts', () => {
  it('has all six public spaces with spawns inside bounds', () => {
    for (const key of ['plaza', 'cafe', 'cinema', 'arcade', 'shop', 'lobby']) {
      const l = LAYOUTS[key];
      expect(l).toBeTruthy();
      const [x, , z] = l.spawn;
      expect(x).toBeGreaterThanOrEqual(l.bounds.minX);
      expect(x).toBeLessThanOrEqual(l.bounds.maxX);
      expect(z).toBeGreaterThanOrEqual(l.bounds.minZ);
      expect(z).toBeLessThanOrEqual(l.bounds.maxZ);
    }
  });
  it('has unique interactable ids per space', () => {
    for (const l of Object.values(LAYOUTS)) {
      const ids = l.interactables.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('spawn points are not inside colliders', () => {
    for (const l of Object.values(LAYOUTS)) {
      const [sx, , sz] = l.spawn;
      const [x, z] = resolveCollisions(sx, sz, 0.34, l.colliders);
      expect(Math.hypot(x - sx, z - sz)).toBeLessThan(0.01);
    }
  });
  it('overpass deck is flat at 5.2 and ramps rise linearly', () => {
    const city = LAYOUTS['plaza'];
    expect(floorHeightAt(city, 0, -32)).toBeCloseTo(5.2, 3);       // 桥面
    expect(floorHeightAt(city, 9.5, -21.5)).toBeCloseTo(2.6, 2);   // 坡道中点
    expect(floorHeightAt(city, 9.5, -13.6)).toBeLessThan(0.05);    // 坡底
    expect(floorHeightAt(city, 0, 0)).toBe(0);                     // 路口平地
  });
});

describe('catalog', () => {
  it('seat furniture defines seat spots', () => {
    for (const f of FURNITURE) {
      if (f.interaction === 'seat') expect(f.seats && f.seats.length).toBeTruthy();
    }
    expect(FURNITURE_BY_TYPE['sofa']).toBeTruthy();
    expect(ITEMS_BY_ID['coffee'].heldId).toBe(1);
  });
});
