/**
 * Live playback readings + the single persistent media layer's frame channel.
 *
 * 架构(任务书「全屏必须复用同一个播放器」):
 *  - 整个客户端只有一个真实播放器实例,常驻挂在 DOM 的 MediaLayer 里。
 *  - 场景内观看:MediaScreen(Canvas 内)每帧把 drei 同款 CSS3D 变换字符串
 *    推到这里,MediaLayer 直接写进自己的 DOM(不走 React 渲染)。
 *  - 全屏:MediaLayer 切换为 fixed inset:0,同一批 React 节点只换样式,
 *    video/iframe/YT 实例全程不重建 → 无重载、无双声、无进度丢失。
 *  - 多块屏幕镜像同一媒体时(个人房间双电视),按 priority(屏宽)认领,
 *    最大的屏得到真实画面,其余显示待机面(单实例的取舍,诚实标注)。
 */

export interface LayerFrame {
  /** 外层 perspective(px)。 */
  fovPx: number;
  /** 相机层 transform(translateZ + matrix3d + translate(halfW,halfH))。 */
  cameraCss: string;
  /** 物体层 transform(translate(-50%,-50%) + matrix3d)。 */
  objectCss: string;
  /** 画布 CSS 尺寸。 */
  w: number;
  h: number;
  /** 内容 CSS 像素尺寸(PX × py)。 */
  px: number;
  py: number;
  /** 锚点是否可见(正面/距离内)。 */
  visible: boolean;
}

export interface WatchDebug {
  drift: number;
  mode: 'idle' | 'rate' | 'seek' | 'buffer';
  rate: number;
  expected: number;
  local: number;
}

type LayerListener = (f: LayerFrame | null) => void;

export const mediaRuntime = {
  duration: 0,
  current: 0,
  updatedAt: 0,
  report(current: number, duration: number): void {
    this.current = current;
    this.duration = Number.isFinite(duration) ? duration : 0;
    this.updatedAt = performance.now();
  },
  reset(): void {
    this.duration = 0;
    this.current = 0;
  },

  // ── 单播放层认领(多屏镜像时宽度最大的屏胜出)────────────────────────────
  _claims: new Map<string, number>(),
  claim(id: string, priority: number): void {
    this._claims.set(id, priority);
  },
  release(id: string): void {
    this._claims.delete(id);
    if (this._owner === id) this._owner = null;
  },
  _owner: null as string | null,
  /** 每帧由各 MediaScreen 调用;返回 true = 你是画面的持有者。 */
  isOwner(id: string): boolean {
    let best: string | null = null;
    let bestP = -Infinity;
    for (const [k, p] of this._claims) {
      if (p > bestP) { best = k; bestP = p; }
    }
    this._owner = best;
    return best === id;
  },

  // ── 帧变换通道(MediaScreen → MediaLayer,不经 React)────────────────────
  _layerListener: null as LayerListener | null,
  onLayerFrame(fn: LayerListener | null): void {
    this._layerListener = fn;
  },
  pushLayerFrame(f: LayerFrame | null): void {
    this._layerListener?.(f);
  },

  // ── 同步调试(np_watch_debug=1 时 MediaLayer 显示)────────────────────────
  debug: { drift: 0, mode: 'idle', rate: 1, expected: 0, local: 0 } as WatchDebug,
  reportSync(d: WatchDebug): void {
    this.debug = d;
  },
};
