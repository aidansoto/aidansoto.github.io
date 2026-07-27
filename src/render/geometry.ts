/**
 * Isometric solid geometry helpers.
 *
 * Buildings are extruded prisms. Everything the building factory draws is
 * built from `Mass` volumes described here, which keeps the silhouettes varied
 * while the material treatment stays identical across the campus — that shared
 * language is what makes ten different shapes read as one estate.
 */

import { Graphics } from 'pixi.js';
import { gridToScreen, type ScreenPoint } from '@/core/iso';
import type { BuildingStyle, GridRect } from '@/core/types';

export interface Mass {
  rect: GridRect;
  /** Height-units. */
  base: number;
  top: number;
}

export type FaceKind = 'right' | 'left';

/** Shrink a rect symmetrically by `n` tiles per side, never below 1x1. */
export function inset(r: GridRect, n: number): GridRect {
  const w = Math.max(1, r.w - n * 2);
  const h = Math.max(1, r.h - n * 2);
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/**
 * Parametric point on a visible side face.
 * `u` runs 0..1 across the face; `v` runs 0..1 from `base` to `top`.
 */
export function facePoint(m: Mass, kind: FaceKind, u: number, v: number): ScreenPoint {
  const height = m.base + (m.top - m.base) * v;
  if (kind === 'right') {
    return gridToScreen(m.rect.x + m.rect.w, m.rect.y + u * m.rect.h, height);
  }
  return gridToScreen(m.rect.x + u * m.rect.w, m.rect.y + m.rect.h, height);
}

/** The four screen corners of a visible side face. */
export function faceQuad(m: Mass, kind: FaceKind): ScreenPoint[] {
  return [
    facePoint(m, kind, 0, 1),
    facePoint(m, kind, 1, 1),
    facePoint(m, kind, 1, 0),
    facePoint(m, kind, 0, 0),
  ];
}

/** The top face diamond of a mass. */
export function topQuad(m: Mass): ScreenPoint[] {
  const r = m.rect;
  return [
    gridToScreen(r.x, r.y, m.top),
    gridToScreen(r.x + r.w, r.y, m.top),
    gridToScreen(r.x + r.w, r.y + r.h, m.top),
    gridToScreen(r.x, r.y + r.h, m.top),
  ];
}

/** A rectangular patch on a face, in face-parametric space. */
export function facePatch(
  m: Mass,
  kind: FaceKind,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
): number[] {
  const a = facePoint(m, kind, u0, v1);
  const b = facePoint(m, kind, u1, v1);
  const c = facePoint(m, kind, u1, v0);
  const d = facePoint(m, kind, u0, v0);
  return [a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, d.sx, d.sy];
}

export function poly(points: ScreenPoint[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.sx, p.sy);
  return out;
}

/** Draw a filled polygon with an optional hairline edge. */
export function fillPoly(
  g: Graphics,
  points: number[],
  color: number,
  alpha = 1,
  edge?: { color: number; width: number; alpha: number },
): void {
  g.poly(points).fill({ color, alpha });
  if (edge) {
    g.poly(points).stroke({ color: edge.color, width: edge.width, alpha: edge.alpha, alignment: 0.5 });
  }
}

/**
 * The mass stack for each architectural archetype.
 * `h` is the building's total height in height-units.
 */
export function massesFor(style: BuildingStyle, footprint: GridRect, h: number): Mass[] {
  const f = footprint;
  switch (style) {
    case 'tower':
      // Stepped obsidian shaft: broad podium, tall shaft, slender crown.
      return [
        { rect: f, base: 0, top: h * 0.14 },
        { rect: inset(f, 1), base: h * 0.14, top: h * 0.58 },
        { rect: inset(f, 2), base: h * 0.58, top: h * 0.88 },
        { rect: inset(f, 3.5), base: h * 0.88, top: h },
      ];

    case 'suite':
      // Elevated private suite: narrow core lifting a cantilevered glass box.
      return [
        { rect: inset(f, 3.5), base: 0, top: h * 0.72 },
        { rect: f, base: h * 0.72, top: h * 0.97 },
        { rect: inset(f, 2), base: h * 0.97, top: h },
      ];

    case 'slab':
      return [
        { rect: f, base: 0, top: h * 0.92 },
        { rect: inset(f, 1), base: h * 0.92, top: h },
      ];

    case 'lab':
      // Glass laboratory with a raised clerestory band.
      return [
        { rect: f, base: 0, top: h * 0.7 },
        { rect: inset(f, 1.5), base: h * 0.7, top: h * 0.95 },
        { rect: inset(f, 3), base: h * 0.95, top: h },
      ];

    case 'bunker':
      // Battered secure mass — wide at the ground, tapering upward.
      return [
        { rect: f, base: 0, top: h * 0.3 },
        { rect: inset(f, 1), base: h * 0.3, top: h * 0.78 },
        { rect: inset(f, 2), base: h * 0.78, top: h },
      ];

    case 'vault':
      // Solid archive block. No setback — deliberately unbroken.
      return [
        { rect: f, base: 0, top: h * 0.96 },
        { rect: inset(f, 0.5), base: h * 0.96, top: h },
      ];

    case 'studio':
      return [{ rect: f, base: 0, top: h * 0.82 }];

    case 'annex':
      return [
        { rect: f, base: 0, top: h * 0.85 },
        { rect: inset(f, 2), base: h * 0.85, top: h },
      ];

    case 'cylinder':
      // Drawn as a drum by the factory; the mass is the bounding volume.
      return [{ rect: f, base: 0, top: h }];

    case 'hub':
      // Open transit canopy: low platform plus a lifted roof plate.
      return [
        { rect: f, base: 0, top: h * 0.12 },
        { rect: inset(f, 0.5), base: h * 0.82, top: h },
      ];
  }
}

/** Ellipse describing a drum's plan at a given height, in screen space. */
export function drumEllipse(
  r: GridRect,
  height: number,
): { cx: number; cy: number; rx: number; ry: number } {
  const c = gridToScreen(r.x + r.w / 2, r.y + r.h / 2, height);
  const east = gridToScreen(r.x + r.w, r.y + r.h / 2, height);
  const south = gridToScreen(r.x + r.w / 2, r.y + r.h, height);
  return {
    cx: c.sx,
    cy: c.sy,
    rx: Math.abs(east.sx - c.sx),
    ry: Math.abs(south.sy - c.sy),
  };
}

/**
 * Shading factors per surface. The key light sits high and to the screen-left,
 * so the left face catches it and the right face falls into shadow.
 */
export const SHADE = {
  top: 1.0,
  left: 0.72,
  right: 0.44,
} as const;

/** Multiply a packed RGB colour by a scalar. */
export function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Blend two packed colours. `t` = 0 returns `a`. */
export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
