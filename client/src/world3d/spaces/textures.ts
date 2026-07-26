/** Procedurally generated surface-pattern textures (planks, tiles, marble…).
 *  These are material patterns on real geometry, generated at runtime —
 *  the project ships no image assets.
 *  手绘绘本质感:低饱和粉彩 + 纸纹颗粒 + 水彩斑驳,全部程序化生成。 */
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 512, repeat = 4): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

/** 固定种子 LCG — 保证每次生成的纹理逐像素一致 (deterministic pseudo-random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 纸纹/水彩颗粒:两层 1px 细颗粒 + 一层大尺度 radial 淡斑。
 *  Reusable paper-grain overlay — call last so it sits on top of the pattern. */
function grain(ctx: CanvasRenderingContext2D, size: number, alpha: number): void {
  const rnd = lcg(20260726);
  // two layers of fine 1px speckles (亮/暗交替,像纸的纤维)
  for (let layer = 0; layer < 2; layer++) {
    const a = alpha * (layer === 0 ? 1 : 0.55);
    const n = Math.floor(size * size * 0.018);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rnd() > 0.5 ? `rgba(255,250,240,${a})` : `rgba(62,52,44,${a})`;
      ctx.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1, 1);
    }
  }
  // large soft blotches (水彩晕染斑,半径 20~60px,8~14 个)
  const blotches = 8 + Math.floor(rnd() * 7);
  for (let i = 0; i < blotches; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 20 + rnd() * 40;
    const c = rnd() > 0.5 ? '64,54,46' : '255,250,238';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${c},${Math.min(1, alpha * 2.2)})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

export function plankTexture(base = '#7a5c3f'): THREE.CanvasTexture {
  return make(`planks:${base}`, (ctx, s) => {
    const rnd = lcg(53535);
    const b = new THREE.Color(base);
    const rows = 8;
    const h = s / rows;
    for (let i = 0; i < rows; i++) {
      const y0 = i * h;
      // 每条木板亮度 + 色相轻微抖动 (subtle hue/lightness jitter per plank)
      const c = b.clone();
      c.offsetHSL((rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.07);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(0, y0, s, h);
      // 板内竖直方向的柔和明暗渐变,避免死平
      const lg = ctx.createLinearGradient(0, y0, 0, y0 + h);
      lg.addColorStop(0, 'rgba(255,244,225,0.06)');
      lg.addColorStop(0.5, 'rgba(0,0,0,0)');
      lg.addColorStop(1, 'rgba(60,42,26,0.08)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, y0, s, h);
      // 2~3 条弯曲木纹线 (quadratic curves, low-alpha dark strokes)
      const veins = 2 + Math.floor(rnd() * 2);
      for (let v = 0; v < veins; v++) {
        const vy = y0 + h * (0.25 + rnd() * 0.55);
        ctx.strokeStyle = `rgba(52,36,22,${0.1 + rnd() * 0.08})`;
        ctx.lineWidth = 1 + rnd() * 1.2;
        ctx.beginPath();
        ctx.moveTo(-4, vy);
        ctx.quadraticCurveTo(s * (0.2 + rnd() * 0.3), vy + (rnd() - 0.5) * h * 0.5, s * 0.55, vy + (rnd() - 0.5) * h * 0.25);
        ctx.quadraticCurveTo(s * (0.7 + rnd() * 0.2), vy + (rnd() - 0.5) * h * 0.5, s + 4, vy + (rnd() - 0.5) * h * 0.3);
        ctx.stroke();
      }
      // 柔和接缝阴影 (soft 2px gradient seam instead of hard black line)
      const seam = ctx.createLinearGradient(0, y0, 0, y0 + 3);
      seam.addColorStop(0, 'rgba(40,28,16,0.28)');
      seam.addColorStop(1, 'rgba(40,28,16,0)');
      ctx.fillStyle = seam;
      ctx.fillRect(0, y0, s, 3);
    }
    grain(ctx, s, 0.045);
  }, 512, 6);
}

export function tileTexture(base = '#c8c4bc', line = 'rgba(0,0,0,0.22)'): THREE.CanvasTexture {
  return make(`tiles:${base}`, (ctx, s) => {
    const rnd = lcg(7777);
    const b = new THREE.Color(base);
    const n = 4;
    const cell = s / n;
    // 浅暖灰勾缝打底 (warm light grout underneath)
    ctx.fillStyle = 'rgba(150,142,130,1)';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = b.clone();
        c.offsetHSL((rnd() - 0.5) * 0.015, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.05);
        const px = x * cell + 2;
        const py = y * cell + 2;
        const pw = cell - 4;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, pw, 5);
        ctx.fillStyle = `#${c.getHexString()}`;
        ctx.fill();
        // 每块砖一个柔和的对角高光 (soft diagonal sheen, matte not glossy)
        const lg = ctx.createLinearGradient(px, py, px + pw, py + pw);
        lg.addColorStop(0, 'rgba(255,250,240,0.10)');
        lg.addColorStop(0.6, 'rgba(0,0,0,0)');
        lg.addColorStop(1, 'rgba(70,60,50,0.07)');
        ctx.fillStyle = lg;
        ctx.fill();
      }
    }
    // 勾缝线弱化处理 (grout lines kept soft)
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(s, i * cell); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    grain(ctx, s, 0.04);
  }, 512, 4);
}

export function grassTexture(): THREE.CanvasTexture {
  return make('grass', (ctx, s) => {
    const rnd = lcg(4242);
    // 低饱和偏黄绿的底色 (muted yellow-green base, storybook meadow)
    ctx.fillStyle = '#9dbb7a';
    ctx.fillRect(0, 0, s, s);
    // 3~4 个相近绿色的大块软斑,radial gradient 交叠出水彩草地
    const patchColors = ['170,190,130', '146,178,110', '158,186,118', '178,196,142'];
    for (let i = 0; i < 4; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = s * (0.3 + rnd() * 0.3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${patchColors[i]},0.55)`);
      g.addColorStop(1, `rgba(${patchColors[i]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    // 细草点:短竖线,颜色在邻近绿之间抖动 (tiny grass ticks)
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const rr2 = 140 + Math.floor(rnd() * 40);
      const gg = 165 + Math.floor(rnd() * 40);
      const bb = 95 + Math.floor(rnd() * 30);
      ctx.fillStyle = `rgba(${rr2},${gg},${bb},${0.3 + rnd() * 0.3})`;
      ctx.fillRect(x, y, 1, 1 + rnd() * 2);
    }
    grain(ctx, s, 0.035);
  }, 512, 32);
}

export function pavingTexture(): THREE.CanvasTexture {
  return make('paving', (ctx, s) => {
    const rnd = lcg(9090);
    // 浅暖灰缝隙打底 (warm light-grey gaps, not black)
    ctx.fillStyle = '#a8a29a';
    ctx.fillRect(0, 0, s, s);
    const n = 4;
    const cell = s / n;
    for (let y = 0; y < n; y++) {
      const off = (y % 2) * (cell / 2);
      for (let x = -1; x < n; x++) {
        const bx = x * cell + off;
        const by = y * cell;
        const shade = 168 + Math.floor(rnd() * 5) * 7;
        ctx.beginPath();
        ctx.roundRect(bx + 2, by + 2, cell - 5, cell - 5, 7);
        ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 5})`;
        ctx.fill();
        // 砖面对角淡渐变 (subtle diagonal light across each stone)
        const lg = ctx.createLinearGradient(bx, by, bx + cell, by + cell);
        lg.addColorStop(0, 'rgba(255,250,240,0.10)');
        lg.addColorStop(1, 'rgba(80,74,66,0.09)');
        ctx.fillStyle = lg;
        ctx.fill();
        // 每块砖 1~2 个小色斑 (small tonal blotches per stone)
        const spots = 1 + Math.floor(rnd() * 2);
        for (let k = 0; k < spots; k++) {
          const sx = bx + cell * (0.2 + rnd() * 0.6);
          const sy = by + cell * (0.2 + rnd() * 0.6);
          const sr = 6 + rnd() * 14;
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
          const c = rnd() > 0.5 ? '120,112,102' : '235,230,220';
          g.addColorStop(0, `rgba(${c},0.14)`);
          g.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
        }
      }
    }
    grain(ctx, s, 0.04);
  }, 512, 12);
}

export function marbleTexture(): THREE.CanvasTexture {
  return make('marble', (ctx, s) => {
    const rnd = lcg(3131);
    ctx.fillStyle = '#ddd8d0';
    ctx.fillRect(0, 0, s, s);
    // 大块云状底纹 (cloudy tonal patches under the veins)
    for (let i = 0; i < 5; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = s * (0.2 + rnd() * 0.25);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = rnd() > 0.5 ? '200,195,188' : '235,231,224';
      g.addColorStop(0, `rgba(${c},0.4)`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    // 柔和灰纹:3 段 bezier 蜿蜒而下 (soft grey veins, 3 bezier segments each)
    const vein = (color: string, width: number) => {
      let x = rnd() * s;
      let y = -8;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let seg = 0; seg < 3; seg++) {
        const ny = y + s / 3 + rnd() * 16;
        const nx = x + (rnd() - 0.5) * s * 0.35;
        ctx.bezierCurveTo(
          x + (rnd() - 0.5) * s * 0.25, y + s * 0.12,
          nx + (rnd() - 0.5) * s * 0.25, ny - s * 0.12,
          nx, ny,
        );
        x = nx; y = ny;
      }
      ctx.stroke();
    };
    for (let i = 0; i < 6; i++) vein(`rgba(150,146,152,${0.12 + rnd() * 0.1})`, 1 + rnd() * 1.6);
    // 一条淡金线 (a single faint gold vein, storybook accent)
    vein('rgba(196,168,112,0.22)', 1.4);
    grain(ctx, s, 0.035);
  }, 512, 8);
}

export function carpetTexture(base = '#4a2a34'): THREE.CanvasTexture {
  return make(`carpet:${base}`, (ctx, s) => {
    const rnd = lcg(6161);
    const b = new THREE.Color(base);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    // 大块柔和色斑,让地毯有织物晕染 (soft tonal patches)
    for (let i = 0; i < 5; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = s * (0.15 + rnd() * 0.25);
      const c = b.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.1);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0.5)`);
      g.addColorStop(1, `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    // 短绒毛:2~4px 的小短线,方向轻微随机 (tiny fuzz strokes)
    ctx.lineCap = 'round';
    for (let i = 0; i < 3200; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const len = 2 + rnd() * 2;
      const ang = (rnd() - 0.5) * 1.2 + Math.PI / 2;
      const light = rnd() > 0.45;
      ctx.strokeStyle = light
        ? `rgba(255,240,235,${0.03 + rnd() * 0.04})`
        : `rgba(20,10,14,${0.04 + rnd() * 0.05})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    grain(ctx, s, 0.03);
  }, 512, 10);
}

export function gridGlowTexture(): THREE.CanvasTexture {
  return make('gridglow', (ctx, s) => {
    ctx.fillStyle = '#14172a';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(70, 90, 200, 0.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo((i * s) / 4, 0); ctx.lineTo((i * s) / 4, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * s) / 4); ctx.lineTo(s, (i * s) / 4); ctx.stroke();
    }
  }, 256, 8);
}
