/**
 * Ground layer: terrain, plaza paving, walkways, water and undeveloped land.
 *
 * All static geometry is drawn once into retained Graphics. Only the water
 * specular pass is animated, and it runs on a slow cadence rather than every
 * frame — moving water should be a background note, not a cost centre.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { gridToScreen } from '@/core/iso';
import { palette, iso } from '@/design/tokens';
import type { CampusDocument, CampusTheme, GridRect } from '@/core/types';
import { mixColor } from '../geometry';
import { groundGlowTexture } from './../factory/textures';

export class GroundLayer {
  readonly container = new Container();

  private terrain = new Graphics();
  private plots = new Graphics();
  private paths = new Graphics();
  private waterBase = new Graphics();
  private waterSpec = new Graphics();
  private grid = new Graphics();
  private washes = new Container();

  private doc: CampusDocument;
  private theme: CampusTheme;
  private clock = 0;

  constructor(doc: CampusDocument, theme: CampusTheme) {
    this.doc = doc;
    this.theme = theme;
    this.container.addChild(
      this.terrain,
      this.plots,
      this.waterBase,
      this.waterSpec,
      this.paths,
      this.washes,
      this.grid,
    );
    this.container.zIndex = -1_000_000;
    this.build();
  }

  setTheme(theme: CampusTheme): void {
    this.theme = theme;
    this.build();
  }

  setDocument(doc: CampusDocument): void {
    this.doc = doc;
    this.build();
  }

  setGridVisible(v: boolean): void {
    this.grid.visible = v;
  }

  private build(): void {
    this.terrain.clear();
    this.plots.clear();
    this.paths.clear();
    this.waterBase.clear();
    this.grid.clear();
    this.washes.removeChildren().forEach((c) => c.destroy());

    const { w, h } = this.doc.gridSize;
    const theme = this.theme;

    /* Terrain -------------------------------------------------------- */
    const outer = [
      gridToScreen(0, 0),
      gridToScreen(w, 0),
      gridToScreen(w, h),
      gridToScreen(0, h),
    ];
    this.terrain
      .poly(outer.flatMap((p) => [p.sx, p.sy]))
      .fill({ color: theme.ground })
      .stroke({ color: palette.silverDim, width: 1.5, alpha: 0.18 });

    // Landscaped ground: broad, low-contrast bands so the campus does not read
    // as one flat plane. Deliberately quiet — the buildings are the subject.
    for (let by = 0; by < h; by += 8) {
      for (let bx = 0; bx < w; bx += 8) {
        if ((bx / 8 + by / 8) % 2 !== 0) continue;
        const r: GridRect = { x: bx, y: by, w: 8, h: 8 };
        this.terrain
          .poly(rectPoly(r))
          .fill({ color: mixColor(theme.ground, palette.foliage, 0.35), alpha: 0.35 });
      }
    }

    /* Undeveloped expansion land ------------------------------------- */
    for (const plot of this.doc.plots) {
      this.plots
        .poly(rectPoly(plot))
        .fill({ color: 0x04060a, alpha: 0.92 })
        .stroke({ color: palette.silverDim, width: 1, alpha: 0.28 });
      // Survey hatching marks the plot as reserved, not derelict.
      const step = 2;
      for (let i = 0; i < plot.w; i += step) {
        const a = gridToScreen(plot.x + i, plot.y);
        const b = gridToScreen(plot.x + i, plot.y + plot.h);
        this.plots.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({
          color: palette.silverDim,
          width: 0.6,
          alpha: 0.14,
        });
      }
    }

    /* Water ---------------------------------------------------------- */
    for (const rect of this.doc.water) {
      this.waterBase
        .poly(rectPoly(rect))
        .fill({ color: palette.water })
        .stroke({ color: palette.silver, width: 1.4, alpha: 0.5 });
      // Inner coping line — the detail that makes a pool look built, not painted.
      const innerRect = { x: rect.x + 0.16, y: rect.y + 0.16, w: rect.w - 0.32, h: rect.h - 0.32 };
      this.waterBase.poly(rectPoly(innerRect)).stroke({
        color: palette.silverBright,
        width: 0.7,
        alpha: 0.22,
      });
    }

    /* Paving --------------------------------------------------------- */
    const paveColor = mixColor(theme.ground, palette.stoneLight, 0.85);
    for (const rect of this.doc.paths) {
      this.paths
        .poly(rectPoly(rect))
        .fill({ color: paveColor })
        .stroke({ color: palette.silverDim, width: 1, alpha: 0.32 });

      // Silver expansion joints running with the long axis of the walkway.
      const along = rect.w >= rect.h;
      const count = Math.max(1, Math.floor((along ? rect.h : rect.w) / 3));
      for (let i = 1; i < count; i++) {
        const t = i / count;
        const a = along
          ? gridToScreen(rect.x, rect.y + t * rect.h)
          : gridToScreen(rect.x + t * rect.w, rect.y);
        const b = along
          ? gridToScreen(rect.x + rect.w, rect.y + t * rect.h)
          : gridToScreen(rect.x + t * rect.w, rect.y + rect.h);
        this.paths.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({
          color: palette.silver,
          width: 0.7,
          alpha: 0.16,
        });
      }

      // A cool wash of light pooled on the paving.
      const wash = new Sprite(groundGlowTexture(256));
      wash.anchor.set(0.5);
      const c = gridToScreen(rect.x + rect.w / 2, rect.y + rect.h / 2);
      wash.position.set(c.sx, c.sy);
      wash.width = (rect.w + rect.h) * iso.tileWidth * 0.42;
      wash.height = (rect.w + rect.h) * iso.tileHeight * 0.5;
      wash.blendMode = 'add';
      wash.alpha = 0.055;
      wash.tint = theme.pathLight;
      this.washes.addChild(wash);
    }

    /* Optional debug grid -------------------------------------------- */
    for (let x = 0; x <= w; x += 4) {
      const a = gridToScreen(x, 0);
      const b = gridToScreen(x, h);
      this.grid.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy);
    }
    for (let y = 0; y <= h; y += 4) {
      const a = gridToScreen(0, y);
      const b = gridToScreen(w, y);
      this.grid.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy);
    }
    this.grid.stroke({ color: palette.blue, width: 0.5, alpha: 0.18 });
    this.grid.visible = this.doc.settings.showGrid;

    this.drawWaterSpecular(0);
  }

  /** Slow-moving specular streaks. Redrawn ~6x per second, not per frame. */
  private drawWaterSpecular(t: number): void {
    const g = this.waterSpec;
    g.clear();
    for (let ri = 0; ri < this.doc.water.length; ri++) {
      const rect = this.doc.water[ri];
      const lines = Math.max(2, Math.floor(rect.h / 1.6));
      for (let i = 0; i < lines; i++) {
        const phase = t * 0.28 + i * 0.7 + ri * 1.9;
        const amp = 0.5 + 0.5 * Math.sin(phase);
        const y = rect.y + ((i + 0.5) / lines) * rect.h;
        const inset = 0.25 + 0.25 * Math.sin(phase * 0.7);
        const a = gridToScreen(rect.x + inset, y);
        const b = gridToScreen(rect.x + rect.w - inset, y);
        g.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({
          color: palette.waterHighlight,
          width: 1.1,
          alpha: 0.1 + amp * 0.22,
        });
      }
      // A single bright highlight per pool, drifting slowly.
      const hx = rect.x + rect.w * (0.5 + 0.32 * Math.sin(t * 0.19 + ri));
      const hy = rect.y + rect.h * (0.5 + 0.28 * Math.cos(t * 0.14 + ri));
      const p = gridToScreen(hx, hy);
      g.ellipse(p.sx, p.sy, 16, 4).fill({ color: palette.lightCool, alpha: 0.12 });
    }
  }

  update(dtMs: number, animate: boolean): void {
    if (!animate) return;
    this.clock += dtMs;
    if (this.clock >= 160) {
      this.drawWaterSpecular(performance.now() / 1000);
      this.clock = 0;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

function rectPoly(r: GridRect): number[] {
  const pts = [
    gridToScreen(r.x, r.y),
    gridToScreen(r.x + r.w, r.y),
    gridToScreen(r.x + r.w, r.y + r.h),
    gridToScreen(r.x, r.y + r.h),
  ];
  return pts.flatMap((p) => [p.sx, p.sy]);
}
