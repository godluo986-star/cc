import { describe, it, expect } from 'vitest';
import { mediaPositionAt } from '../src/media';
import type { MediaState } from '../src/types';

/** 基准状态:T0 时刻从 0 秒开始播放的直链视频。 */
const T0 = 1_700_000_000_000;
const base = (over: Partial<MediaState> = {}): MediaState => ({
  url: 'https://example.com/movie.mp4',
  kind: 'video',
  playing: true,
  position: 0,
  rate: 1,
  loop: false,
  updatedAt: T0,
  setBy: 'p1',
  ...over,
});

describe('mediaPositionAt(服务器时钟外推)', () => {
  it('空屏永远是 0', () => {
    expect(mediaPositionAt(base({ url: null, kind: null, position: 99 }), T0 + 5000)).toBe(0);
  });

  it('播放中按经过时间外推', () => {
    const m = base({ position: 10 });
    expect(mediaPositionAt(m, T0)).toBe(10);
    expect(mediaPositionAt(m, T0 + 5000)).toBe(15);
    expect(mediaPositionAt(m, T0 + 61_500)).toBeCloseTo(71.5, 9);
  });

  it('暂停时位置冻结,不随时间移动', () => {
    const m = base({ playing: false, position: 42.25 });
    expect(mediaPositionAt(m, T0)).toBe(42.25);
    expect(mediaPositionAt(m, T0 + 3000)).toBe(42.25);
    expect(mediaPositionAt(m, T0 + 3_600_000)).toBe(42.25);
  });

  it('倍速按 rate 缩放推进速度', () => {
    expect(mediaPositionAt(base({ rate: 1.5 }), T0 + 10_000)).toBeCloseTo(15, 9);
    expect(mediaPositionAt(base({ rate: 0.5 }), T0 + 10_000)).toBeCloseTo(5, 9);
    expect(mediaPositionAt(base({ position: 100, rate: 2 }), T0 + 4000)).toBeCloseTo(108, 9);
  });

  it('seek 后从新的 position/updatedAt 重算', () => {
    // 服务器处理 seek:position=300, updatedAt=now(与 handlers.ts 的 seek 分支一致)
    const seeked = base({ position: 300, updatedAt: T0 + 20_000 });
    expect(mediaPositionAt(seeked, T0 + 20_000)).toBe(300);   // seek 瞬间
    expect(mediaPositionAt(seeked, T0 + 22_000)).toBe(302);   // 2s 后
    // seek 前的旧外推(20s → 位置 20)被完全覆盖,与旧状态无关
    expect(mediaPositionAt(base(), T0 + 20_000)).toBe(20);
  });

  it('暂停→倍速→继续的组合与服务器语义一致', () => {
    // pause @ T0+8s:position = 8(服务器落盘),playing=false
    const paused = base({ playing: false, position: 8, updatedAt: T0 + 8000 });
    expect(mediaPositionAt(paused, T0 + 60_000)).toBe(8);
    // rate 1.5(暂停中改速不动位置)→ play @ T0+30s
    const resumed = base({ position: 8, rate: 1.5, updatedAt: T0 + 30_000 });
    expect(mediaPositionAt(resumed, T0 + 34_000)).toBeCloseTo(14, 9);
  });

  it('两个本地时钟不同但 serverTimeOffset 校准后的客户端得到同一位置', () => {
    const m = base({ position: 12, rate: 1.25 });
    const serverNow = T0 + 9000;
    // 客户端 A 本地快 700ms,B 慢 1300ms;各自 offset 把本地钟还原成服务器钟
    const clientA = mediaPositionAt(m, (serverNow + 700) + -700);
    const clientB = mediaPositionAt(m, (serverNow - 1300) + 1300);
    expect(clientA).toBe(clientB);
    expect(clientA).toBeCloseTo(12 + 9 * 1.25, 9);
  });
});
