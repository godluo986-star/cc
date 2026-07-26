export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist2d = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
export const dist3d = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
  Math.hypot(ax - bx, ay - by, az - bz);

const TAU = Math.PI * 2;
/** Shortest-path angle interpolation. */
export function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
export function normalizeAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/** Deterministic seeded PRNG (mulberry32) — used for repeatable world scatter. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Colliders ───────────────────────────────────────────────────────────────
export type Collider =
  | { kind: 'box'; x: number; z: number; w: number; d: number }
  | { kind: 'circle'; x: number; z: number; r: number };

/**
 * Push a circle (player) out of static colliders. Returns corrected [x, z].
 */
export function resolveCollisions(
  x: number,
  z: number,
  radius: number,
  colliders: Collider[]
): [number, number] {
  for (const c of colliders) {
    if (c.kind === 'circle') {
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d < min && d > 1e-6) {
        x = c.x + (dx / d) * min;
        z = c.z + (dz / d) * min;
      } else if (d <= 1e-6) {
        x = c.x + min;
      }
    } else {
      const hw = c.w / 2 + radius;
      const hd = c.d / 2 + radius;
      const dx = x - c.x;
      const dz = z - c.z;
      if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
        const px = hw - Math.abs(dx);
        const pz = hd - Math.abs(dz);
        if (px < pz) x = c.x + Math.sign(dx || 1) * hw;
        else z = c.z + Math.sign(dz || 1) * hd;
      }
    }
  }
  return [x, z];
}

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number; }
export function clampToBounds(x: number, z: number, b: Bounds, pad = 0.3): [number, number] {
  return [clamp(x, b.minX + pad, b.maxX - pad), clamp(z, b.minZ + pad, b.maxZ - pad)];
}
