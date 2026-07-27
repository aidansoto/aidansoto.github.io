/**
 * Cinematic isometric camera.
 *
 * Pure logic — no PixiJS import — so the easing, clamping and focus behaviour
 * can be unit-tested. The renderer reads `x`, `y` and `zoom` each frame and
 * applies them to the world container.
 *
 * Coordinates: (x, y) is the world-screen point pinned to the centre of the
 * viewport. Zoom is a uniform scale about that centre.
 */

import { easeInOutCubic, damp, motion, zoomLimits } from '@/design/tokens';
import { clamp, gridBounds, gridToScreen } from '@/core/iso';

export interface Viewport {
  width: number;
  height: number;
}

interface Flight {
  fromX: number;
  fromY: number;
  fromZoom: number;
  toX: number;
  toY: number;
  toZoom: number;
  elapsed: number;
  duration: number;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = zoomLimits.default;

  /** Where the camera is easing toward under free (non-flight) movement. */
  targetX = 0;
  targetY = 0;
  targetZoom = zoomLimits.default;

  viewport: Viewport = { width: 1280, height: 800 };

  private flight: Flight | null = null;
  private followFn: (() => { sx: number; sy: number } | null) | null = null;
  private bounds = { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 };
  private reducedMotion = false;

  /** Home pose, restored by `goHome()`. */
  private home = { x: 0, y: 0, zoom: zoomLimits.default };

  setGrid(w: number, h: number): void {
    const b = gridBounds(w, h);
    // Generous margin so the campus can be framed with breathing room, but not
    // so generous that the owner can lose it off-screen.
    const padX = (b.maxX - b.minX) * 0.25;
    const padY = (b.maxY - b.minY) * 0.35;
    this.bounds = {
      minX: b.minX - padX,
      maxX: b.maxX + padX,
      minY: b.minY - padY,
      maxY: b.maxY + padY,
    };
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
  }

  /** Set the pose restored by `goHome()` — normally the plaza. */
  setHome(gx: number, gy: number, zoom: number): void {
    const p = gridToScreen(gx, gy);
    this.home = { x: p.sx, y: p.sy, zoom };
  }

  /** Snap immediately, no easing. Used on first load and on resize. */
  jumpTo(sx: number, sy: number, zoom = this.zoom): void {
    this.flight = null;
    this.followFn = null;
    this.zoom = clamp(zoom, zoomLimits.min, zoomLimits.max);
    this.targetZoom = this.zoom;
    this.x = this.targetX = sx;
    this.y = this.targetY = sy;
    this.clampSelf();
  }

  jumpToGrid(gx: number, gy: number, zoom = this.zoom): void {
    const p = gridToScreen(gx, gy);
    this.jumpTo(p.sx, p.sy, zoom);
  }

  /** Smooth cinematic move. Cancels any follow. */
  flyTo(sx: number, sy: number, zoom = this.targetZoom, durationMs = motion.cameraFlyMs): void {
    this.followFn = null;
    const z = clamp(zoom, zoomLimits.min, zoomLimits.max);
    if (this.reducedMotion) {
      this.jumpTo(sx, sy, z);
      return;
    }
    this.flight = {
      fromX: this.x,
      fromY: this.y,
      fromZoom: this.zoom,
      toX: sx,
      toY: sy,
      toZoom: z,
      elapsed: 0,
      duration: Math.max(1, durationMs),
    };
    this.targetX = sx;
    this.targetY = sy;
    this.targetZoom = z;
  }

  flyToGrid(gx: number, gy: number, zoom?: number, durationMs?: number): void {
    const p = gridToScreen(gx, gy);
    this.flyTo(p.sx, p.sy, zoom ?? this.targetZoom, durationMs);
  }

  /** Return to the plaza overview. */
  goHome(durationMs = motion.cameraFlyMs): void {
    this.flyTo(this.home.x, this.home.y, this.home.zoom, durationMs);
  }

  /** Frame the whole campus in the viewport. */
  fitAll(gridW: number, gridH: number, durationMs = motion.cameraFlyMs): void {
    const b = gridBounds(gridW, gridH);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const zoom = clamp(
      Math.min(this.viewport.width / (w * 1.06), this.viewport.height / (h * 1.35)),
      zoomLimits.min,
      zoomLimits.max,
    );
    this.flyTo((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, zoom, durationMs);
  }

  /**
   * Continuously track a moving world-screen point (an agent, a task packet).
   * The supplier returns null when the target is gone, which releases follow.
   */
  follow(supplier: () => { sx: number; sy: number } | null, zoom?: number): void {
    this.flight = null;
    this.followFn = supplier;
    if (zoom !== undefined) this.targetZoom = clamp(zoom, zoomLimits.min, zoomLimits.max);
  }

  stopFollow(): void {
    this.followFn = null;
  }

  get isFollowing(): boolean {
    return this.followFn !== null;
  }

  /** Drag-pan by a screen-space delta (already in device pixels). */
  panBy(dxScreen: number, dyScreen: number): void {
    this.flight = null;
    this.followFn = null;
    this.targetX -= dxScreen / this.zoom;
    this.targetY -= dyScreen / this.zoom;
    // Dragging should feel direct, so move the live position too.
    this.x = this.targetX;
    this.y = this.targetY;
    this.clampSelf();
  }

  /**
   * Zoom about a screen point so the world under the cursor stays put.
   * `factor` > 1 zooms in.
   */
  zoomAt(factor: number, screenX: number, screenY: number): void {
    this.flight = null;
    const before = this.screenToWorld(screenX, screenY);
    this.targetZoom = clamp(this.targetZoom * factor, zoomLimits.min, zoomLimits.max);
    // Solve for the pan that keeps `before` under the same screen point at the
    // new zoom. Uses the *target* zoom so repeated wheel ticks stay anchored.
    const cx = this.viewport.width / 2;
    const cy = this.viewport.height / 2;
    this.targetX = before.sx - (screenX - cx) / this.targetZoom;
    this.targetY = before.sy - (screenY - cy) / this.targetZoom;
    this.clampSelf();
  }

  /** Discrete zoom, centred on the viewport. Used by the on-screen buttons. */
  zoomStep(factor: number): void {
    this.zoomAt(factor, this.viewport.width / 2, this.viewport.height / 2);
  }

  setZoom(zoom: number): void {
    this.flight = null;
    this.targetZoom = clamp(zoom, zoomLimits.min, zoomLimits.max);
  }

  update(dtMs: number): void {
    if (this.flight) {
      this.flight.elapsed += dtMs;
      const t = clamp(this.flight.elapsed / this.flight.duration, 0, 1);
      const e = easeInOutCubic(t);
      this.x = this.flight.fromX + (this.flight.toX - this.flight.fromX) * e;
      this.y = this.flight.fromY + (this.flight.toY - this.flight.fromY) * e;
      this.zoom = this.flight.fromZoom + (this.flight.toZoom - this.flight.fromZoom) * e;
      this.targetX = this.x;
      this.targetY = this.y;
      this.targetZoom = this.zoom;
      if (t >= 1) this.flight = null;
      this.clampSelf();
      return;
    }

    if (this.followFn) {
      const target = this.followFn();
      if (target) {
        this.targetX = target.sx;
        this.targetY = target.sy;
      } else {
        this.followFn = null;
      }
    }

    if (this.reducedMotion) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.zoom = this.targetZoom;
    } else {
      const kPos = damp(this.followFn ? 6 : 12, dtMs);
      const kZoom = damp(10, dtMs);
      this.x += (this.targetX - this.x) * kPos;
      this.y += (this.targetY - this.y) * kPos;
      this.zoom += (this.targetZoom - this.zoom) * kZoom;
    }
    this.clampSelf();
  }

  private clampSelf(): void {
    this.zoom = clamp(this.zoom, zoomLimits.min, zoomLimits.max);
    this.targetZoom = clamp(this.targetZoom, zoomLimits.min, zoomLimits.max);
    this.x = clamp(this.x, this.bounds.minX, this.bounds.maxX);
    this.y = clamp(this.y, this.bounds.minY, this.bounds.maxY);
    this.targetX = clamp(this.targetX, this.bounds.minX, this.bounds.maxX);
    this.targetY = clamp(this.targetY, this.bounds.minY, this.bounds.maxY);
  }

  /** World-screen → viewport pixels. */
  worldToScreen(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.x) * this.zoom + this.viewport.width / 2,
      y: (sy - this.y) * this.zoom + this.viewport.height / 2,
    };
  }

  /** Viewport pixels → world-screen. */
  screenToWorld(px: number, py: number): { sx: number; sy: number } {
    return {
      sx: (px - this.viewport.width / 2) / this.zoom + this.x,
      sy: (py - this.viewport.height / 2) / this.zoom + this.y,
    };
  }

  /** World-screen rectangle currently visible, with a margin for culling. */
  visibleBounds(marginPx = 220): { minX: number; maxX: number; minY: number; maxY: number } {
    const halfW = this.viewport.width / 2 / this.zoom + marginPx / this.zoom;
    const halfH = this.viewport.height / 2 / this.zoom + marginPx / this.zoom;
    return {
      minX: this.x - halfW,
      maxX: this.x + halfW,
      minY: this.y - halfH,
      maxY: this.y + halfH,
    };
  }
}
