/**
 * Agent figure textures.
 *
 * Every agent on the campus is drawn from one of a small set of pre-rendered
 * figures, generated once at boot. The dress system is strict and enforced
 * here, not at the call site:
 *
 *   - `suit_black` figures wear a black tailored suit with silver accents.
 *   - `suit_alt`   figures wear an equally formal suit in a non-black palette.
 *
 * The figures are deliberately abstract — sharp shoulders, clean silhouette, no
 * face, no exaggerated proportions. At campus zoom they read as executives
 * crossing a plaza, which is the point.
 */

import { Texture } from 'pixi.js';
import type { SuitPalette } from '../stateVisuals';

/** Supersample factor — figures stay crisp when the camera zooms in. */
const SS = 4;

/** Figure dimensions in design units (origin: bottom centre). */
const FIG = {
  width: 14,
  height: 27,
  headR: 2.9,
  headY: 23.2,
  shoulderY: 19.6,
  hemY: 10.8,
  footY: 0,
};

export type FigureBuild = 'a' | 'b';

/** Walk cycle frames: 0 contact, 1 pass, 2 contact (mirrored), 3 pass. */
export const WALK_FRAMES = 4;

const cache = new Map<string, Texture[]>();

function hex(color: number, alpha = 1): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

const SKIN_TONES = [0x6b5a4c, 0x8a7362, 0x4e4038, 0x9c8570, 0x5f4d40];

interface FigureSpec {
  suit: SuitPalette;
  build: FigureBuild;
  skin: number;
}

/**
 * Returns the four-frame walk cycle for a figure. Frame 0 doubles as the
 * standing pose.
 */
export function agentFrames(suit: SuitPalette, build: FigureBuild, skinIndex: number): Texture[] {
  const skin = SKIN_TONES[skinIndex % SKIN_TONES.length];
  const key = `${suit.name}:${build}:${skin}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const frames: Texture[] = [];
  for (let f = 0; f < WALK_FRAMES; f++) {
    frames.push(renderFrame({ suit, build, skin }, f));
  }
  cache.set(key, frames);
  return frames;
}

function renderFrame(spec: FigureSpec, frame: number): Texture {
  const w = FIG.width * SS;
  const h = (FIG.height + 2) * SS;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  // Work in design units with y measured up from the feet.
  const cx = w / 2;
  const baseY = h - 1 * SS;
  const X = (u: number): number => cx + u * SS;
  const Y = (v: number): number => baseY - v * SS;

  const { suit, build } = spec;
  const shoulderHalf = build === 'a' ? 5.0 : 4.35;
  const hemHalf = build === 'a' ? 4.0 : 3.5;
  const waistHalf = build === 'a' ? 3.5 : 3.0;

  // Walk cycle: legs swing, body bobs a fraction of a unit.
  const swing = [0, 1, 0, -1][frame];
  const bob = frame % 2 === 1 ? 0.45 : 0;

  ctx.save();
  ctx.translate(0, -bob * SS);

  /* Legs ------------------------------------------------------------ */
  const legHalf = build === 'a' ? 1.5 : 1.3;
  const legs: Array<[number, number]> = [
    [-1.65, swing * 1.5],
    [1.65, -swing * 1.5],
  ];
  for (const [ox, sw] of legs) {
    ctx.fillStyle = hex(suit.legs);
    ctx.beginPath();
    ctx.moveTo(X(ox - legHalf), Y(FIG.hemY));
    ctx.lineTo(X(ox + legHalf), Y(FIG.hemY));
    ctx.lineTo(X(ox + legHalf * 0.82 + sw), Y(FIG.footY + 1.1));
    ctx.lineTo(X(ox - legHalf * 0.82 + sw), Y(FIG.footY + 1.1));
    ctx.closePath();
    ctx.fill();

    // Shoe: a small dark wedge, slightly forward of the ankle.
    ctx.fillStyle = hex(suit.jacketShadow);
    ctx.beginPath();
    ctx.ellipse(X(ox + sw * 1.1), Y(FIG.footY + 0.5), legHalf * 1.25 * SS, 0.85 * SS, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Jacket ---------------------------------------------------------- */
  ctx.fillStyle = hex(suit.jacket);
  ctx.beginPath();
  ctx.moveTo(X(-shoulderHalf), Y(FIG.shoulderY - 0.5));
  ctx.lineTo(X(-shoulderHalf * 0.72), Y(FIG.shoulderY + 0.9)); // shoulder line
  ctx.lineTo(X(shoulderHalf * 0.72), Y(FIG.shoulderY + 0.9));
  ctx.lineTo(X(shoulderHalf), Y(FIG.shoulderY - 0.5));
  ctx.lineTo(X(waistHalf + 0.4), Y(FIG.hemY + 3.4));
  ctx.lineTo(X(hemHalf), Y(FIG.hemY));
  ctx.lineTo(X(-hemHalf), Y(FIG.hemY));
  ctx.lineTo(X(-waistHalf - 0.4), Y(FIG.hemY + 3.4));
  ctx.closePath();
  ctx.fill();

  // Right side of the jacket falls into shadow, matching the campus key light.
  ctx.fillStyle = hex(suit.jacketShadow, 0.85);
  ctx.beginPath();
  ctx.moveTo(X(1.1), Y(FIG.shoulderY + 0.6));
  ctx.lineTo(X(shoulderHalf), Y(FIG.shoulderY - 0.5));
  ctx.lineTo(X(waistHalf + 0.4), Y(FIG.hemY + 3.4));
  ctx.lineTo(X(hemHalf), Y(FIG.hemY));
  ctx.lineTo(X(1.1), Y(FIG.hemY));
  ctx.closePath();
  ctx.fill();

  /* Shirt + accent --------------------------------------------------- */
  ctx.fillStyle = hex(suit.shirt);
  ctx.beginPath();
  ctx.moveTo(X(-1.35), Y(FIG.shoulderY + 0.5));
  ctx.lineTo(X(1.35), Y(FIG.shoulderY + 0.5));
  ctx.lineTo(X(0), Y(FIG.shoulderY - 4.2));
  ctx.closePath();
  ctx.fill();

  // Tie / silk placket in the accent colour — the only bright note on the suit.
  ctx.fillStyle = hex(suit.accent, 0.95);
  ctx.beginPath();
  ctx.moveTo(X(-0.5), Y(FIG.shoulderY - 0.2));
  ctx.lineTo(X(0.5), Y(FIG.shoulderY - 0.2));
  ctx.lineTo(X(0.32), Y(FIG.shoulderY - 5.6));
  ctx.lineTo(X(-0.32), Y(FIG.shoulderY - 5.6));
  ctx.closePath();
  ctx.fill();

  // Lapel edges, drawn as hairlines so the tailoring reads at close zoom.
  ctx.strokeStyle = hex(suit.accent, 0.28);
  ctx.lineWidth = Math.max(1, 0.28 * SS);
  ctx.beginPath();
  ctx.moveTo(X(-1.5), Y(FIG.shoulderY + 0.4));
  ctx.lineTo(X(-0.2), Y(FIG.shoulderY - 4.6));
  ctx.moveTo(X(1.5), Y(FIG.shoulderY + 0.4));
  ctx.lineTo(X(0.2), Y(FIG.shoulderY - 4.6));
  ctx.stroke();

  // Status pin at the left lapel — the subtle tech integration.
  ctx.fillStyle = hex(0xffffff, 0.9);
  ctx.beginPath();
  ctx.arc(X(-1.6), Y(FIG.shoulderY - 1.4), 0.42 * SS, 0, Math.PI * 2);
  ctx.fill();

  /* Arms ------------------------------------------------------------- */
  const armSwing = swing * 1.1;
  for (const side of [-1, 1]) {
    ctx.fillStyle = side < 0 ? hex(suit.jacket) : hex(suit.jacketShadow, 0.95);
    ctx.beginPath();
    ctx.moveTo(X(side * (shoulderHalf - 0.4)), Y(FIG.shoulderY + 0.4));
    ctx.lineTo(X(side * (shoulderHalf + 0.9)), Y(FIG.shoulderY - 0.6));
    ctx.lineTo(X(side * (shoulderHalf + 0.5) + side * armSwing), Y(FIG.hemY + 0.6));
    ctx.lineTo(X(side * (shoulderHalf - 1.1) + side * armSwing), Y(FIG.hemY + 1.0));
    ctx.closePath();
    ctx.fill();
  }

  /* Head ------------------------------------------------------------- */
  ctx.fillStyle = hex(spec.skin);
  ctx.beginPath();
  ctx.ellipse(X(0), Y(FIG.headY), FIG.headR * 0.86 * SS, FIG.headR * SS, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair: a clean dark cap. Build B carries slightly more volume at the sides.
  ctx.fillStyle = hex(0x14171c, 0.95);
  ctx.beginPath();
  const hairW = FIG.headR * (build === 'a' ? 0.9 : 1.06);
  ctx.ellipse(
    X(0),
    Y(FIG.headY + 0.9),
    hairW * SS,
    FIG.headR * (build === 'a' ? 0.72 : 0.86) * SS,
    0,
    Math.PI,
    Math.PI * 2,
  );
  ctx.fill();
  if (build === 'b') {
    ctx.beginPath();
    ctx.ellipse(X(0), Y(FIG.headY - 0.2), hairW * 1.02 * SS, FIG.headR * 1.02 * SS, 0, Math.PI * 0.05, Math.PI * 0.95);
    ctx.fill();
  }

  /* Rim light -------------------------------------------------------- */
  // A single cool highlight down the lit edge. This is what stops the figures
  // from disappearing into a dark campus.
  ctx.strokeStyle = 'rgba(214,230,248,0.5)';
  ctx.lineWidth = Math.max(1, 0.34 * SS);
  ctx.beginPath();
  ctx.moveTo(X(-shoulderHalf + 0.1), Y(FIG.shoulderY - 0.4));
  ctx.lineTo(X(-waistHalf - 0.3), Y(FIG.hemY + 3.4));
  ctx.lineTo(X(-hemHalf + 0.1), Y(FIG.hemY + 0.2));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(-1.1), Y(FIG.headY + 0.4), FIG.headR * 0.9 * SS, Math.PI * 0.75, Math.PI * 1.25);
  ctx.stroke();

  ctx.restore();

  return Texture.from(canvas);
}

/** Screen height of a figure at zoom 1, in pixels. */
export const FIGURE_SCREEN_HEIGHT = FIG.height + 2;

export function clearAgentTextureCache(): void {
  cache.clear();
}
