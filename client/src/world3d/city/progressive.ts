/**
 * 分帧构建任务队列(设计文档 §10「加载」):
 * 程序化生成分帧执行(默认每帧预算 8ms = BUILD_FRAME_BUDGET_MS),
 * 按优先级出队(先出生点 80m 半径,再空闲帧补齐),并向加载界面报告
 * {done, total, label} 阶段进度(布局→贴图→建筑→道具→灯光)。
 *
 * 可测试性:step() 是纯逻辑核心,时间源 now 由构造参数注入(测试传假时钟,
 * 不直接依赖 rAF);run() 只是把 step() 挂上帧调度器的薄壳,调度器同样可注入
 * (默认 requestAnimationFrame,SSR/Node 环境退化为 setTimeout)。
 */
import { BUILD_FRAME_BUDGET_MS } from './quality';

/** 加载进度快照(交给加载界面渲染进度条与当前阶段文案)。 */
export interface BuildProgress {
  /** 已完成任务数。 */
  done: number;
  /** 累计入队任务总数(运行中继续 add 会增长)。 */
  total: number;
  /** 最近完成的任务标签(如「布局」「贴图」「建筑」…)。 */
  label: string;
}

export type ProgressCallback = (p: BuildProgress) => void;

interface BuildTask {
  label: string;
  fn: () => void;
  priority: number;
  /** 入队序号:同优先级保持 FIFO。 */
  seq: number;
}

export interface BuildQueueOptions {
  /** 毫秒时间源;默认 performance.now(测试注入假时钟)。 */
  now?: () => number;
  /** 帧调度器;默认 requestAnimationFrame(SSR/测试退化或注入手动泵)。 */
  schedule?: (cb: () => void) => void;
}

const defaultNow: () => number =
  typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

const defaultSchedule: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (cb) => { requestAnimationFrame(() => cb()); }
    : (cb) => { setTimeout(cb, 16); };

/**
 * 帧预算任务队列。
 * 用法:q.add('建筑', buildBlockA, 10).add('道具', scatterProps);
 *       q.onProgress(updateLoadingUI); await q.run();
 */
export class BuildQueue {
  private tasks: BuildTask[] = [];
  /** tasks 是否需要按优先级重排(add 后置脏,出队前惰性排序)。 */
  private dirty = false;
  private seq = 0;
  private doneCount = 0;
  private totalCount = 0;
  private lastLabel = '';
  private listeners = new Set<ProgressCallback>();
  private running: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void) => void;

  constructor(opts: BuildQueueOptions = {}) {
    this.now = opts.now ?? defaultNow;
    this.schedule = opts.schedule ?? defaultSchedule;
  }

  /** 入队一个构建任务;priority 越大越先执行,同级 FIFO。可链式调用。 */
  add(label: string, fn: () => void, priority = 0): this {
    this.tasks.push({ label, fn, priority, seq: this.seq++ });
    this.totalCount++;
    this.dirty = true;
    return this;
  }

  /** 订阅进度(每完成一个任务回调一次);返回退订函数。 */
  onProgress(cb: ProgressCallback): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** 待执行任务数。 */
  get pending(): number {
    return this.tasks.length;
  }

  /** 当前进度快照。 */
  get progress(): BuildProgress {
    return { done: this.doneCount, total: this.totalCount, label: this.lastLabel };
  }

  /**
   * 同步核心(纯逻辑,单测直接调):在 budgetMs 预算内依序执行任务。
   * 每步至少执行 1 个任务(保证前进,即使单任务超预算);任务抛错只记录
   * console.error 并继续(单个道具失败不能卡死整个加载)。
   * @returns 队列是否已清空。
   */
  step(budgetMs: number = BUILD_FRAME_BUDGET_MS): boolean {
    const start = this.now();
    while (this.tasks.length > 0) {
      if (this.dirty) {
        this.tasks.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
        this.dirty = false;
      }
      const task = this.tasks.shift()!;
      try {
        task.fn();
      } catch (err) {
        console.error(`[city/progressive] 构建任务「${task.label}」失败(已跳过):`, err);
      }
      this.doneCount++;
      this.lastLabel = task.label;
      const snapshot = this.progress;
      this.listeners.forEach((cb) => cb(snapshot));
      if (this.now() - start >= budgetMs) break; // 预算耗尽,让出主线程
    }
    return this.tasks.length === 0;
  }

  /**
   * rAF 薄壳:逐帧调用 step(budgetMs) 直到队列清空。
   * 运行期间重复调用返回同一个 Promise;运行中新 add 的任务会被同一轮消化。
   */
  run(budgetMs: number = BUILD_FRAME_BUDGET_MS): Promise<void> {
    if (this.running) return this.running;
    this.running = new Promise<void>((resolve) => {
      const pump = (): void => {
        if (this.step(budgetMs)) {
          this.running = null;
          resolve();
        } else {
          this.schedule(pump);
        }
      };
      this.schedule(pump);
    });
    return this.running;
  }
}
