import { describe, it, expect, beforeEach } from 'vitest';
import { Camera } from '@/render/camera';
import { zoomLimits } from '@/design/tokens';
import { gridToScreen } from '@/core/iso';

function makeCamera(): Camera {
  const cam = new Camera();
  cam.viewport = { width: 1280, height: 800 };
  cam.setGrid(96, 96);
  return cam;
}

/** Run the camera forward by `ms` in 16ms steps, like the real ticker. */
function advance(cam: Camera, ms: number): void {
  for (let t = 0; t < ms; t += 16) cam.update(16);
}

describe('Camera', () => {
  let cam: Camera;
  beforeEach(() => {
    cam = makeCamera();
  });

  it('starts at the default zoom', () => {
    expect(cam.zoom).toBe(zoomLimits.default);
  });

  it('jumps without easing', () => {
    cam.jumpTo(100, 200, 1.2);
    expect(cam.x).toBe(100);
    expect(cam.y).toBe(200);
    expect(cam.zoom).toBe(1.2);
  });

  it('converts between screen and world consistently', () => {
    cam.jumpTo(120, -60, 0.85);
    const world = cam.screenToWorld(400, 300);
    const back = cam.worldToScreen(world.sx, world.sy);
    expect(back.x).toBeCloseTo(400, 6);
    expect(back.y).toBeCloseTo(300, 6);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    cam.jumpTo(0, 0, 0.6);
    const cursor = { x: 940, y: 220 };
    const before = cam.screenToWorld(cursor.x, cursor.y);

    cam.zoomAt(1.5, cursor.x, cursor.y);
    // zoomAt solves against the target pose; settle the easing first.
    advance(cam, 900);

    const after = cam.screenToWorld(cursor.x, cursor.y);
    expect(after.sx).toBeCloseTo(before.sx, 1);
    expect(after.sy).toBeCloseTo(before.sy, 1);
  });

  it('never exceeds the zoom envelope', () => {
    for (let i = 0; i < 60; i++) cam.zoomStep(1.4);
    advance(cam, 1200);
    expect(cam.zoom).toBeLessThanOrEqual(zoomLimits.max);

    for (let i = 0; i < 80; i++) cam.zoomStep(0.7);
    advance(cam, 1200);
    expect(cam.zoom).toBeGreaterThanOrEqual(zoomLimits.min);
  });

  it('clamps panning so the campus cannot be lost off-screen', () => {
    for (let i = 0; i < 400; i++) cam.panBy(-500, -500);
    const b = gridBoundsForTest();
    expect(cam.x).toBeLessThanOrEqual(b.maxX + 1);
    expect(cam.y).toBeLessThanOrEqual(b.maxY + 1);

    for (let i = 0; i < 800; i++) cam.panBy(500, 500);
    expect(cam.x).toBeGreaterThanOrEqual(b.minX - 1);
    expect(cam.y).toBeGreaterThanOrEqual(b.minY - 1);
  });

  it('eases into a flight and arrives exactly', () => {
    cam.jumpTo(0, 0, 0.6);
    cam.flyTo(600, 400, 1.2, 800);

    cam.update(80);
    const early = { x: cam.x, y: cam.y };
    // Cubic ease-in: barely moved after 10% of the flight.
    expect(early.x).toBeLessThan(600 * 0.15);

    advance(cam, 900);
    expect(cam.x).toBeCloseTo(600, 3);
    expect(cam.y).toBeCloseTo(400, 3);
    expect(cam.zoom).toBeCloseTo(1.2, 3);
  });

  it('snaps instead of easing when reduced motion is on', () => {
    cam.setReducedMotion(true);
    cam.jumpTo(0, 0, 0.6);
    cam.flyTo(500, 300, 1.1, 800);
    expect(cam.x).toBe(500);
    expect(cam.y).toBe(300);
    expect(cam.zoom).toBe(1.1);
  });

  it('returns home to the configured plaza pose', () => {
    cam.setHome(48, 48, 0.9);
    cam.jumpTo(-900, 1400, 2.0);
    cam.goHome(600);
    advance(cam, 700);

    const plaza = gridToScreen(48, 48);
    expect(cam.x).toBeCloseTo(plaza.sx, 3);
    expect(cam.y).toBeCloseTo(plaza.sy, 3);
    expect(cam.zoom).toBeCloseTo(0.9, 3);
  });

  it('follows a moving target and releases when it disappears', () => {
    let pos: { sx: number; sy: number } | null = { sx: 300, sy: 120 };
    cam.follow(() => pos, 1.2);
    expect(cam.isFollowing).toBe(true);

    advance(cam, 1500);
    expect(cam.x).toBeCloseTo(300, 0);
    expect(cam.y).toBeCloseTo(120, 0);

    pos = { sx: -260, sy: 480 };
    advance(cam, 1500);
    expect(cam.x).toBeCloseTo(-260, 0);

    pos = null;
    cam.update(16);
    expect(cam.isFollowing).toBe(false);
  });

  it('drops follow as soon as the owner pans', () => {
    cam.follow(() => ({ sx: 0, sy: 0 }));
    cam.panBy(20, 20);
    expect(cam.isFollowing).toBe(false);
  });

  it('frames the whole campus inside the viewport', () => {
    cam.fitAll(96, 96, 400);
    advance(cam, 500);

    const corners = [
      gridToScreen(0, 0),
      gridToScreen(96, 0),
      gridToScreen(96, 96),
      gridToScreen(0, 96),
    ];
    for (const c of corners) {
      const s = cam.worldToScreen(c.sx, c.sy);
      expect(s.x).toBeGreaterThanOrEqual(-2);
      expect(s.x).toBeLessThanOrEqual(cam.viewport.width + 2);
      expect(s.y).toBeGreaterThanOrEqual(-2);
      expect(s.y).toBeLessThanOrEqual(cam.viewport.height + 2);
    }
  });

  it('reports visible bounds that contain the viewport', () => {
    cam.jumpTo(0, 0, 1);
    const b = cam.visibleBounds(0);
    expect(b.minX).toBeCloseTo(-640);
    expect(b.maxX).toBeCloseTo(640);
    expect(b.minY).toBeCloseTo(-400);
    expect(b.maxY).toBeCloseTo(400);
  });
});

/** Mirror of the padding Camera.setGrid applies, for assertion purposes. */
function gridBoundsForTest(): { minX: number; maxX: number; minY: number; maxY: number } {
  const corners = [
    gridToScreen(0, 0),
    gridToScreen(96, 0),
    gridToScreen(96, 96),
    gridToScreen(0, 96),
  ];
  const minX = Math.min(...corners.map((c) => c.sx));
  const maxX = Math.max(...corners.map((c) => c.sx));
  const minY = Math.min(...corners.map((c) => c.sy));
  const maxY = Math.max(...corners.map((c) => c.sy));
  const padX = (maxX - minX) * 0.25;
  const padY = (maxY - minY) * 0.35;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}
