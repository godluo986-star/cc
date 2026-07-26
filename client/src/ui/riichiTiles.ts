/**
 * 立直麻将 · 牌面 canvas 精绘(riichiTiles.ts)
 *
 * 34 面 + 红5 全套程序化绘制(零外部资产),原始尺寸 64×88,首绘后缓存。
 * 规范:万 = 蓝数字 + 红「萬」;筒 = 同心圆规范排布;索 = 竹节绿(1索画鸟简形);
 * 字 = 东南西北黑 / 白(蓝框)/ 發绿 / 中红;红5(赤宝牌)数字全红。
 * 导出 drawTile(face, red) → HTMLCanvasElement 与 tileDataURL(face, red) → dataURL。
 */

export const RC_TILE_W = 64;
export const RC_TILE_H = 88;

const INK_BLUE = '#2456b8';
const INK_RED = '#c0392b';
const INK_GREEN = '#2e7d4f';
const INK_BLACK = '#23262f';
const IVORY = '#f8f4e9';
const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';

const canvasCache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 牌面底(象牙白 + 描边 + 底部厚度暗示)。 */
function tileBase(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = RC_TILE_W;
  c.height = RC_TILE_H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  roundRectPath(ctx, 1.5, 1.5, RC_TILE_W - 3, RC_TILE_H - 3, 8);
  const grad = ctx.createLinearGradient(0, 0, 0, RC_TILE_H);
  grad.addColorStop(0, '#fdfaf1');
  grad.addColorStop(0.82, IVORY);
  grad.addColorStop(1, '#e7e0cd');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#c4bba4';
  ctx.lineWidth = 2;
  ctx.stroke();
  return [c, ctx];
}

function centeredChar(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, x, y);
}

const NUM_CHARS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/* ── 筒:同心圆规范排布 ─────────────────────────────────────────────────── */
const PIN_LAYOUTS: Record<number, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [[0.5, 0.26], [0.5, 0.74]],
  3: [[0.26, 0.2], [0.5, 0.5], [0.74, 0.8]],
  4: [[0.28, 0.26], [0.72, 0.26], [0.28, 0.74], [0.72, 0.74]],
  5: [[0.25, 0.22], [0.75, 0.22], [0.5, 0.5], [0.25, 0.78], [0.75, 0.78]],
  6: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  7: [[0.22, 0.12], [0.5, 0.19], [0.78, 0.26], [0.3, 0.56], [0.7, 0.56], [0.3, 0.84], [0.7, 0.84]],
  8: [[0.3, 0.15], [0.7, 0.15], [0.3, 0.38], [0.7, 0.38], [0.3, 0.62], [0.7, 0.62], [0.3, 0.85], [0.7, 0.85]],
  9: [[0.25, 0.19], [0.5, 0.19], [0.75, 0.19], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.25, 0.81], [0.5, 0.81], [0.75, 0.81]],
};
const PIN_RADIUS: Record<number, number> = { 1: 17, 2: 11.5, 3: 10, 4: 9.5, 5: 8.5, 6: 8.5, 7: 7.2, 8: 7, 9: 7.2 };
const PIN_COLORS = [INK_BLUE, INK_RED, INK_GREEN];

/** 单个筒:外环 + 内点;1筒加花瓣缘。 */
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, big: boolean): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.24);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (big) {
    // 1筒:花瓣缘 + 双环
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.83, y + Math.sin(a) * r * 0.83, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

/* ── 索:竹节 ───────────────────────────────────────────────────────────── */
const SOU_LAYOUTS: Record<number, Array<[number, number]>> = {
  2: [[0.5, 0.26], [0.5, 0.74]],
  3: [[0.5, 0.2], [0.3, 0.72], [0.7, 0.72]],
  4: [[0.3, 0.26], [0.7, 0.26], [0.3, 0.74], [0.7, 0.74]],
  5: [[0.27, 0.2], [0.73, 0.2], [0.5, 0.5], [0.27, 0.8], [0.73, 0.8]],
  6: [[0.25, 0.28], [0.5, 0.28], [0.75, 0.28], [0.25, 0.72], [0.5, 0.72], [0.75, 0.72]],
  7: [[0.5, 0.16], [0.25, 0.52], [0.5, 0.52], [0.75, 0.52], [0.25, 0.86], [0.5, 0.86], [0.75, 0.86]],
  8: [[0.25, 0.17], [0.5, 0.17], [0.75, 0.17], [0.35, 0.5], [0.65, 0.5], [0.25, 0.83], [0.5, 0.83], [0.75, 0.83]],
  9: [[0.25, 0.19], [0.5, 0.19], [0.75, 0.19], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.25, 0.81], [0.5, 0.81], [0.75, 0.81]],
};

/** 单根竹:两节圆角条 + 中间节环 + 端头。 */
function drawStick(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string): void {
  const w = 6.5;
  ctx.fillStyle = color;
  roundRectPath(ctx, x - w / 2, y - h / 2, w, h, 3);
  ctx.fill();
  // 竹节(中部亮环)+ 上下端头
  ctx.fillStyle = IVORY;
  ctx.fillRect(x - w / 2 - 0.6, y - 1.1, w + 1.2, 2.2);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y - h / 2, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y + h / 2, 2.2, 0, Math.PI * 2); ctx.fill();
}

/** 1索:鸟简形(竹雀)。 */
function drawBird(ctx: CanvasRenderingContext2D, red: boolean): void {
  const main = red ? INK_RED : INK_GREEN;
  const cx = 32, cy = 46;
  // 尾羽三根
  ctx.strokeStyle = main;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const dx of [-8, 0, 8]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + 10);
    ctx.quadraticCurveTo(cx + dx * 0.6, cy + 20, cx + dx, cy + 27);
    ctx.stroke();
  }
  // 身体
  ctx.fillStyle = main;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2, 10.5, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  // 翅(深色弧)
  ctx.strokeStyle = red ? '#8f2a20' : '#1d5738';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(cx - 2, cy + 2, 8, Math.PI * 0.25, Math.PI * 0.95);
  ctx.stroke();
  // 胸口浅斑
  ctx.fillStyle = '#f3ecd8';
  ctx.beginPath();
  ctx.ellipse(cx + 3.5, cy + 5, 4, 6.5, -0.25, 0, Math.PI * 2);
  ctx.fill();
  // 头 + 眼
  ctx.fillStyle = main;
  ctx.beginPath();
  ctx.arc(cx + 5, cy - 14, 6.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx + 6.6, cy - 15.2, 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INK_BLACK;
  ctx.beginPath(); ctx.arc(cx + 7, cy - 15.2, 1, 0, Math.PI * 2); ctx.fill();
  // 喙(橙)
  ctx.fillStyle = '#d98a2b';
  ctx.beginPath();
  ctx.moveTo(cx + 10.5, cy - 15.5);
  ctx.lineTo(cx + 17, cy - 13.5);
  ctx.lineTo(cx + 10.5, cy - 11.5);
  ctx.closePath();
  ctx.fill();
}

/* ── 各花色主绘制 ───────────────────────────────────────────────────────── */
function drawMan(ctx: CanvasRenderingContext2D, n: number, red: boolean): void {
  centeredChar(ctx, NUM_CHARS[n - 1], 32, 24, 28, red ? INK_RED : INK_BLUE);
  centeredChar(ctx, '萬', 32, 61, 32, INK_RED);
}

function drawPins(ctx: CanvasRenderingContext2D, n: number, red: boolean): void {
  const layout = PIN_LAYOUTS[n];
  const r = PIN_RADIUS[n];
  layout.forEach(([ux, uy], i) => {
    const x = 10 + ux * 44;
    const y = 11 + uy * 66;
    const color = red ? INK_RED : PIN_COLORS[(i + n) % 3];
    drawPin(ctx, x, y, r, color, n === 1);
  });
}

function drawSou(ctx: CanvasRenderingContext2D, n: number, red: boolean): void {
  if (n === 1) { drawBird(ctx, red); return; }
  const layout = SOU_LAYOUTS[n];
  const h = n <= 4 ? 24 : n <= 6 ? 22 : 18;
  for (const [ux, uy] of layout) {
    drawStick(ctx, 10 + ux * 44, 11 + uy * 66, h, red ? INK_RED : INK_GREEN);
  }
}

function drawHonor(ctx: CanvasRenderingContext2D, idx: number): void {
  // idx: 0-3 东南西北 · 4 白 · 5 發 · 6 中
  if (idx === 4) {
    // 白:双层蓝框
    ctx.strokeStyle = INK_BLUE;
    ctx.lineWidth = 3;
    roundRectPath(ctx, 12, 14, 40, 60, 6);
    ctx.stroke();
    ctx.lineWidth = 1.6;
    roundRectPath(ctx, 18, 21, 28, 46, 4);
    ctx.stroke();
    return;
  }
  const ch = ['東', '南', '西', '北', '', '發', '中'][idx];
  const color = idx === 5 ? INK_GREEN : idx === 6 ? INK_RED : INK_BLACK;
  centeredChar(ctx, ch, 32, 45, 44, color);
}

/** 牌面绘制(64×88,缓存)。red 仅对 5万/5筒/5索 生效(赤宝牌数字全红)。 */
export function drawTile(face: number, red = false): HTMLCanvasElement {
  const key = `${face}:${red ? 'r' : 'n'}`;
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const [c, ctx] = tileBase();
  if (face < 9) drawMan(ctx, face + 1, red);
  else if (face < 18) drawPins(ctx, face - 9 + 1, red);
  else if (face < 27) drawSou(ctx, face - 18 + 1, red);
  else drawHonor(ctx, face - 27);
  if (red) {
    // 赤宝牌角标(左上小红点)
    ctx.fillStyle = INK_RED;
    ctx.beginPath();
    ctx.arc(9, 10, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  canvasCache.set(key, c);
  return c;
}

/** 牌面 dataURL(缓存)。 */
export function tileDataURL(face: number, red = false): string {
  const key = `${face}:${red ? 'r' : 'n'}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const url = drawTile(face, red).toDataURL();
  urlCache.set(key, url);
  return url;
}

/** 牌背(靛蓝 + 菱格纹)。 */
export function tileBackDataURL(): string {
  const hit = urlCache.get('back');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = RC_TILE_W;
  c.height = RC_TILE_H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  roundRectPath(ctx, 1.5, 1.5, RC_TILE_W - 3, RC_TILE_H - 3, 8);
  const grad = ctx.createLinearGradient(0, 0, RC_TILE_W, RC_TILE_H);
  grad.addColorStop(0, '#3d5a8f');
  grad.addColorStop(1, '#2b3f66');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#1d2130';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1.4;
  for (let i = -RC_TILE_H; i < RC_TILE_W + RC_TILE_H; i += 10) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + RC_TILE_H, RC_TILE_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i + RC_TILE_H, 0); ctx.lineTo(i, RC_TILE_H); ctx.stroke();
  }
  ctx.restore();
  const url = c.toDataURL();
  urlCache.set('back', url);
  return url;
}
