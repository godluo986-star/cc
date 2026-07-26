/**
 * Media clock math — the single authoritative formula for "what second should
 * playback be at right now". The server stores only
 * { url, kind, playing, position, rate, updatedAt } and every client
 * extrapolates against the server clock, so keeping this one pure function in
 * shared guarantees the extrapolation can never drift between endpoints
 * (design doc §9.1; covered by shared/test/media.test.ts and the end-to-end
 * scripts/sync-test.mjs).
 */
import type { MediaState } from './types';

/** The fields `mediaPositionAt` actually reads (a full MediaState qualifies). */
export type MediaClock = Pick<MediaState, 'url' | 'playing' | 'position' | 'rate' | 'updatedAt'>;

/**
 * Extrapolated playback position in seconds at server-clock time `nowMs`.
 * - nothing loaded → 0
 * - paused → frozen at `position`
 * - playing → `position` + elapsed-since-`updatedAt` × `rate`
 *
 * `nowMs` must be on the SERVER clock: clients pass
 * `Date.now() + serverTimeOffset`, the server passes `Date.now()`.
 */
export function mediaPositionAt(m: MediaClock, nowMs: number): number {
  if (!m.url) return 0;
  return m.playing ? m.position + ((nowMs - m.updatedAt) / 1000) * m.rate : m.position;
}
