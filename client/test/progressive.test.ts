/**
 * BuildQueue(city/progressive)纯逻辑核心测试:
 * 注入假时钟与手动帧泵(不依赖 rAF/DOM),验证优先级、帧预算切分、
 * 进度报告、错误容忍与 run() 薄壳行为(设计文档 §10「加载」)。
 */
import { describe, it, expect, vi } from 'vitest';
import { BuildQueue } from '../src/world3d/city/progressive';
import { BUILD_FRAME_BUDGET_MS } from '../src/world3d/city/quality';

/** 可手动推进的假时钟。 */
function fakeClock(): { now: () => number; tick: (ms: number) => void } {
  let t = 0;
  return { now: () => t, tick: (ms) => { t += ms; } };
}

describe('BuildQueue(帧预算分帧队列)', () => {
  it('按优先级降序执行,同优先级保持 FIFO', () => {
    const clock = fakeClock();
    const q = new BuildQueue({ now: clock.now });
    const order: string[] = [];
    q.add('b', () => order.push('b'), 1);
    q.add('a', () => order.push('a'), 2);
    q.add('c', () => order.push('c'), 1);
    q.add('d', () => order.push('d')); // 默认优先级 0
    expect(q.step(100)).toBe(true);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('单步 step 受预算限制,跨多步耗尽队列', () => {
    const clock = fakeClock();
    const q = new BuildQueue({ now: clock.now });
    const ran: string[] = [];
    for (const name of ['t1', 't2', 't3']) {
      q.add(name, () => { ran.push(name); clock.tick(5); }); // 每任务耗时 5ms
    }
    // 预算 8ms:t1 后 5 < 8 继续,t2 后 10 ≥ 8 让出
    expect(q.step(8)).toBe(false);
    expect(ran).toEqual(['t1', 't2']);
    expect(q.pending).toBe(1);
    expect(q.step(8)).toBe(true);
    expect(ran).toEqual(['t1', 't2', 't3']);
  });

  it('即使单任务超预算,每步也至少执行 1 个任务(保证前进)', () => {
    const clock = fakeClock();
    const q = new BuildQueue({ now: clock.now });
    let runs = 0;
    q.add('heavy1', () => { runs++; clock.tick(50); });
    q.add('heavy2', () => { runs++; clock.tick(50); });
    expect(q.step(BUILD_FRAME_BUDGET_MS)).toBe(false);
    expect(runs).toBe(1);
    expect(q.step(BUILD_FRAME_BUDGET_MS)).toBe(true);
    expect(runs).toBe(2);
  });

  it('onProgress 逐任务报告 {done,total,label},退订后不再回调', () => {
    const clock = fakeClock();
    const q = new BuildQueue({ now: clock.now });
    const seen: Array<{ done: number; total: number; label: string }> = [];
    const off = q.onProgress((p) => seen.push({ ...p }));
    q.add('布局', () => {});
    q.add('贴图', () => {});
    q.step(100);
    expect(seen).toEqual([
      { done: 1, total: 2, label: '布局' },
      { done: 2, total: 2, label: '贴图' },
    ]);
    off();
    q.add('建筑', () => {});
    q.step(100);
    expect(seen).toHaveLength(2); // 已退订
    expect(q.progress).toEqual({ done: 3, total: 3, label: '建筑' });
  });

  it('任务抛错被记录并跳过,不阻塞后续任务', () => {
    const clock = fakeClock();
    const q = new BuildQueue({ now: clock.now });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ran: string[] = [];
    q.add('bad', () => { throw new Error('boom'); });
    q.add('good', () => ran.push('good'));
    expect(q.step(100)).toBe(true);
    expect(ran).toEqual(['good']);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(q.progress.done).toBe(2); // 失败任务也计入进度
    errSpy.mockRestore();
  });

  it('运行中入队的任务在同一轮 run 内被消化', () => {
    const clock = fakeClock();
    const q = new BuildQueue({ now: clock.now });
    const order: string[] = [];
    q.add('first', () => {
      order.push('first');
      q.add('spawned', () => order.push('spawned'));
    });
    expect(q.step(100)).toBe(true);
    expect(order).toEqual(['first', 'spawned']);
    expect(q.progress).toEqual({ done: 2, total: 2, label: 'spawned' });
  });

  it('run() 通过注入的调度器分帧执行并最终 resolve;重复调用返回同一 Promise', async () => {
    const clock = fakeClock();
    const frames: Array<() => void> = [];
    const q = new BuildQueue({ now: clock.now, schedule: (cb) => frames.push(cb) });
    const ran: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      q.add(name, () => { ran.push(name); clock.tick(10); }); // 每任务超 8ms 预算
    }
    const p1 = q.run(); // 默认预算 BUILD_FRAME_BUDGET_MS = 8
    const p2 = q.run();
    expect(p2).toBe(p1);
    let resolved = false;
    void p1.then(() => { resolved = true; });
    // 手动泵帧:每帧只跑 1 个任务(超预算),3 任务 + 结算帧
    let pumps = 0;
    while (frames.length > 0 && pumps < 10) {
      frames.shift()!();
      pumps++;
      await Promise.resolve();
    }
    await p1;
    expect(resolved).toBe(true);
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(pumps).toBe(3); // 三帧各执行 1 个任务,第三帧清空即 resolve
    // 清空后再次 run:空队列下一帧立即 resolve(新 Promise)
    const p3 = q.run();
    expect(p3).not.toBe(p1);
    frames.shift()!();
    await p3;
  });
});
