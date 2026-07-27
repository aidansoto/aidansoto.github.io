/**
 * Isometric projection maths.
 *
 * The campus lives on a 2:1 diamond grid. Grid coordinates run (x → south-east,
 * y → south-west). Height is a third axis that lifts geometry straight up the
 * screen, which is what gives buildings their mass.
 *
 * All functions here are pure and unit-tested — the renderer and the camera
 * both depend on them agreeing exactly.
 */

import { iso } from '@/design/tokens';
import type { GridPoint, GridRect } from './types';

export interface ScreenPoint {
  sx: number;
  sy: number;
}

/** Project a grid point (+ optional height) into unscaled world-screen space. */
export function gridToScreen(x: number, y: number, height = 0): ScreenPoint {
  return {
    sx: (x - y) * (iso.tileWidth / 2),
    sy: (x + y) * (iso.tileHeight / 2) - height * iso.heightUnit,
  };
}

/** Inverse projection at ground level (height 0). */
export function screenToGrid(sx: number, sy: number): GridPoint {
  const halfW = iso.tileWidth / 2;
  const halfH = iso.tileHeight / 2;
  return {
    x: (sx / halfW + sy / halfH) / 2,
    y: (sy / halfH - sx / halfW) / 2,
  };
}

/** Round a fractional grid point to the containing tile. */
export function tileOf(p: GridPoint): GridPoint {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

/**
 * Painter's-algorithm depth key. Larger draws later (in front).
 * Height is weighted lightly so a tall building never occludes something that
 * is genuinely in front of it.
 */
export function depthKey(x: number, y: number, height = 0): number {
  return (x + y) * 1000 + height;
}

/** The four screen-space corners of a single tile diamond. */
export function tileCorners(x: number, y: number, height = 0): ScreenPoint[] {
  return [
    gridToScreen(x, y, height),
    gridToScreen(x + 1, y, height),
    gridToScreen(x + 1, y + 1, height),
    gridToScreen(x, y + 1, height),
  ];
}

/** Screen-space corners of an axis-aligned grid rectangle's top face. */
export function rectCorners(r: GridRect, height = 0): ScreenPoint[] {
  return [
    gridToScreen(r.x, r.y, height),
    gridToScreen(r.x + r.w, r.y, height),
    gridToScreen(r.x + r.w, r.y + r.h, height),
    gridToScreen(r.x, r.y + r.h, height),
  ];
}

/** Flatten screen points into the flat number array PixiJS `poly()` wants. */
export function flatten(points: ScreenPoint[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(p.sx, p.sy);
  }
  return out;
}

/** Centre of a grid rectangle, in grid space. */
export function rectCenter(r: GridRect): GridPoint {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectContains(r: GridRect, p: GridPoint): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Euclidean distance in grid space. */
export function distance(a: GridPoint, b: GridPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Linear interpolation between two grid points. */
export function lerpPoint(a: GridPoint, b: GridPoint, t: number): GridPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Screen-space bounding box of the whole grid, used to clamp the camera so the
 * campus can never be panned entirely off-screen.
 */
export function gridBounds(w: number, h: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const corners = [gridToScreen(0, 0), gridToScreen(w, 0), gridToScreen(w, h), gridToScreen(0, h)];
  return {
    minX: Math.min(...corners.map((c) => c.sx)),
    maxX: Math.max(...corners.map((c) => c.sx)),
    minY: Math.min(...corners.map((c) => c.sy)),
    maxY: Math.max(...corners.map((c) => c.sy)),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
