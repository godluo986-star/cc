import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

/** Crisp canvas-rendered nametag texture (no font assets needed). */
export function nameTexture(name: string, isNpc = false): THREE.Texture {
  const key = `${isNpc ? 'n' : 'p'}:${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);

  ctx.font = '600 52px "Segoe UI", system-ui, sans-serif';
  const textW = Math.min(460, ctx.measureText(name).width);
  const padX = 28;
  const w = textW + padX * 2;
  const x = (512 - w) / 2;

  // pill background
  ctx.fillStyle = 'rgba(8, 12, 22, 0.72)';
  ctx.beginPath();
  ctx.roundRect(x, 22, w, 84, 42);
  ctx.fill();
  ctx.strokeStyle = isNpc ? 'rgba(255, 190, 90, 0.85)' : 'rgba(110, 160, 255, 0.65)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = isNpc ? '#ffd9a0' : '#f2f6ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 256, 66, 456);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
