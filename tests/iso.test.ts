import { describe, it, expect } from 'vitest';
import {
  gridToScreen,
  screenToGrid,
  depthKey,
  rectCenter,
  rectContains,
  rectsOverlap,
  gridBounds,
  distance,
  lerpPoint,
  clamp,
  tileOf,
} from '@/core/iso';
import { iso } from '@/design/tokens';

describe('isometric projection', () => {
  it('places the grid origin at the screen origin', () => {
    expect(gridToScreen(0, 0)).toEqual({ sx: 0, sy: 0 });
  });

  it('projects the x axis down-right and the y axis down-left', () => {
    const x = gridToScreen(1, 0);
    const y = gridToScreen(0, 1);
    expect(x.sx).toBeGreaterThan(0);
    expect(x.sy).toBeGreaterThan(0);
    expect(y.sx).toBeLessThan(0);
    expect(y.sy).toBeGreaterThan(0);
    // A 2:1 diamond: one tile step moves half a tile width horizontally.
    expect(x.sx).toBe(iso.tileWidth / 2);
    expect(x.sy).toBe(iso.tileHeight / 2);
  });

  it('lifts geometry straight up the screen with height', () => {
    const ground = gridToScreen(4, 7, 0);
    const raised = gridToScreen(4, 7, 3);
    expect(raised.sx).toBe(ground.sx);
    expect(raised.sy).toBe(ground.sy - 3 * iso.heightUnit);
  });

  it('round-trips grid → screen → grid at ground level', () => {
    for (const [x, y] of [
      [0, 0],
      [12, 5],
      [48.5, 48.5],
      [95, 3],
      [-7, 22],
    ]) {
      const s = gridToScreen(x, y);
      const back = screenToGrid(s.sx, s.sy);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });

  it('orders depth so nearer tiles draw later', () => {
    // Larger x + y is nearer the camera in this projection.
    expect(depthKey(5, 5)).toBeGreaterThan(depthKey(4, 5));
    expect(depthKey(4, 6)).toBeGreaterThan(depthKey(4, 5));
    // Height only breaks ties; it never overrides ground position.
    expect(depthKey(4, 5, 30)).toBeLessThan(depthKey(5, 5, 0));
  });

  it('rounds fractional positions down to the containing tile', () => {
    expect(tileOf({ x: 4.9, y: 7.1 })).toEqual({ x: 4, y: 7 });
    expect(tileOf({ x: -0.2, y: 0 })).toEqual({ x: -1, y: 0 });
  });
});

describe('rectangles', () => {
  const r = { x: 10, y: 20, w: 4, h: 6 };

  it('finds the centre', () => {
    expect(rectCenter(r)).toEqual({ x: 12, y: 23 });
  });

  it('tests containment on a half-open interval', () => {
    expect(rectContains(r, { x: 10, y: 20 })).toBe(true);
    expect(rectContains(r, { x: 13.9, y: 25.9 })).toBe(true);
    // The far edge is exclusive, so adjacent rects never both claim a tile.
    expect(rectContains(r, { x: 14, y: 20 })).toBe(false);
    expect(rectContains(r, { x: 10, y: 26 })).toBe(false);
    expect(rectContains(r, { x: 9.99, y: 22 })).toBe(false);
  });

  it('detects overlap but not mere adjacency', () => {
    expect(rectsOverlap(r, { x: 13, y: 25, w: 2, h: 2 })).toBe(true);
    expect(rectsOverlap(r, { x: 14, y: 20, w: 2, h: 2 })).toBe(false);
    expect(rectsOverlap(r, { x: 0, y: 0, w: 4, h: 4 })).toBe(false);
  });
});

describe('helpers', () => {
  it('measures euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('interpolates between points', () => {
    expect(lerpPoint({ x: 0, y: 10 }, { x: 10, y: 0 }, 0.25)).toEqual({ x: 2.5, y: 7.5 });
  });

  it('clamps', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('bounds the whole grid in screen space', () => {
    const b = gridBounds(96, 96);
    // A square grid produces a diamond: widest at the east/west corners.
    expect(b.minX).toBe(-96 * (iso.tileWidth / 2));
    expect(b.maxX).toBe(96 * (iso.tileWidth / 2));
    expect(b.minY).toBe(0);
    expect(b.maxY).toBe(96 * iso.tileHeight);
  });
});
