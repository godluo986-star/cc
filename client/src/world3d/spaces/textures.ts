/** Procedurally generated surface-pattern textures (planks, tiles, marble…).
 *  These are material patterns on real geometry, generated at runtime —
 *  the project ships no image assets. */
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 256, repeat = 4): THREE.CanvasTexture {
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

export function plankTexture(base = '#7a5c3f'): THREE.CanvasTexture {
  return make(`planks:${base}`, (ctx, s) => {
    const b = new THREE.Color(base);
    for (let i = 0; i < 6; i++) {
      const shade = 0.85 + ((i * 37) % 10) * 0.03;
      ctx.fillStyle = `#${b.clone().multiplyScalar(shade).getHexString()}`;
      ctx.fillRect(0, (i * s) / 6, s, s / 6);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, (i * s) / 6, s, 2);
      // wood grain flecks
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let j = 0; j < 8; j++) {
        ctx.fillRect(((i * 53 + j * 89) % s), (i * s) / 6 + 6 + ((j * 13) % (s / 6 - 10)), 18 + ((i + j) % 3) * 9, 1.5);
      }
    }
  });
}

export function tileTexture(base = '#c8c4bc', line = 'rgba(0,0,0,0.22)'): THREE.CanvasTexture {
  return make(`tiles:${base}`, (ctx, s) => {
    const b = new THREE.Color(base);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const shade = 0.92 + (((x * 7 + y * 13) % 5) * 0.025);
        ctx.fillStyle = `#${b.clone().multiplyScalar(shade).getHexString()}`;
        ctx.fillRect((x * s) / 4, (y * s) / 4, s / 4, s / 4);
      }
    }
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo((i * s) / 4, 0); ctx.lineTo((i * s) / 4, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * s) / 4); ctx.lineTo(s, (i * s) / 4); ctx.stroke();
    }
  });
}

export function grassTexture(): THREE.CanvasTexture {
  return make('grass', (ctx, s) => {
    ctx.fillStyle = '#4a7a3f';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const x = (i * 97) % s;
      const y = (i * 61) % s;
      const g = 100 + ((i * 31) % 60);
      ctx.fillStyle = `rgba(${40 + ((i * 13) % 30)}, ${g}, ${50 + ((i * 7) % 25)}, 0.5)`;
      ctx.fillRect(x, y, 2, 2 + (i % 3));
    }
  }, 256, 24);
}

export function pavingTexture(): THREE.CanvasTexture {
  return make('paving', (ctx, s) => {
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(0, 0, s, s);
    const cell = s / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const off = (y % 2) * (cell / 2);
        const shade = 140 + ((x * 5 + y * 11) % 5) * 8;
        ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 8})`;
        ctx.fillRect(((x * cell + off) % s), y * cell, cell - 3, cell - 3);
      }
    }
  }, 256, 12);
}

export function marbleTexture(): THREE.CanvasTexture {
  return make('marble', (ctx, s) => {
    ctx.fillStyle = '#d8d4cc';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(120, 118, 128, 0.3)';
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      let x = (i * 41) % s, y = 0;
      ctx.moveTo(x, y);
      while (y < s) {
        x += Math.sin(y * 0.05 + i * 3) * 9;
        y += 12;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, 256, 8);
}

export function carpetTexture(base = '#4a2a34'): THREE.CanvasTexture {
  return make(`carpet:${base}`, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + ((i * 7) % 4) * 0.008})`;
      ctx.fillRect((i * 89) % s, (i * 53) % s, 1.6, 1.6);
    }
  }, 256, 10);
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
