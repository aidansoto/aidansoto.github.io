/**
 * Runtime-generated textures.
 *
 * The campus ships no image assets: every texture here is drawn once into an
 * offscreen canvas at boot and then reused by hundreds of sprites. That keeps
 * the bundle small, keeps the look perfectly consistent, and means colours can
 * be re-themed without shipping new art.
 */

import { Texture } from 'pixi.js';

const cache = new Map<string, Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;
  draw(ctx);
  const tex = Texture.from(canvas);
  cache.set(key, tex);
  return tex;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * Soft radial falloff, used additively for every light source on the campus —
 * lamps, window bloom, beacons, the monument.
 */
export function glowTexture(size = 128, softness = 0.55): Texture {
  return canvasTexture(`glow:${size}:${softness}`, size, size, (ctx) => {
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(softness, 'rgba(255,255,255,0.28)');
    grad.addColorStop(0.82, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  });
}

/**
 * Elongated glow used for ground light pools under lamps and along walkways —
 * an isometric puddle of light reads as an ellipse, not a circle.
 */
export function groundGlowTexture(size = 128): Texture {
  return canvasTexture(`groundglow:${size}`, size, size / 2, (ctx) => {
    const grad = ctx.createRadialGradient(size / 2, size / 4, 0, size / 2, size / 4, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size / 2);
  });
}

/** Vertical light shaft for beacons and the monument column. */
export function beamTexture(w = 32, h = 256): Texture {
  return canvasTexture(`beam:${w}:${h}`, w, h, (ctx) => {
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    // Slight taper so the shaft narrows as it rises.
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w, h);
    ctx.lineTo(w * 0.68, 0);
    ctx.lineTo(w * 0.32, 0);
    ctx.closePath();
    ctx.fill();
  });
}

/** A 2x2 white pixel — the workhorse for tinted, scaled rectangles. */
export function whiteTexture(): Texture {
  return canvasTexture('white', 2, 2, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2, 2);
  });
}

/**
 * Fine anisotropic streak used for brushed-metal highlights on silver trim.
 */
export function brushedTexture(color: number, size = 64): Texture {
  return canvasTexture(`brushed:${color}:${size}`, size, size, (ctx) => {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < size; i += 2) {
      ctx.fillStyle = i % 4 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(0, i, size, 1);
    }
    ctx.globalAlpha = 1;
  });
}

/** Vertical sky gradient drawn behind the campus. */
export function skyTexture(top: number, bottom: number): Texture {
  return canvasTexture(`sky:${top}:${bottom}`, 4, 256, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, hex(top));
    grad.addColorStop(0.62, hex(bottom));
    grad.addColorStop(1, hex(bottom));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
  });
}

/** Soft elliptical contact shadow placed beneath agents and props. */
export function contactShadowTexture(size = 48): Texture {
  return canvasTexture(`shadow:${size}`, size, size / 2, (ctx) => {
    const grad = ctx.createRadialGradient(size / 2, size / 4, 0, size / 2, size / 4, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size / 2);
  });
}

/** Single raindrop streak. */
export function rainTexture(): Texture {
  return canvasTexture('rain', 2, 18, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 18);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.6, 'rgba(210,228,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 18);
  });
}

/** Snowflake / fog puff — a soft dot. */
export function softDotTexture(size = 16): Texture {
  return canvasTexture(`dot:${size}`, size, size, (ctx) => {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  });
}

export function clearTextureCache(): void {
  cache.clear();
}
