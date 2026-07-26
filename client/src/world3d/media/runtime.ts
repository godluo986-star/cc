/**
 * Live playback readings from whatever player is active on the local client
 * (video element or YouTube API). The server never proxies media bytes — it
 * only stores {url, playing, position, rate, updatedAt}; every client loads
 * the media locally and steers its own player to match. The control panel
 * reads duration/position from here to render a real draggable seek bar.
 */
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
};
