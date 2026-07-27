/**
 * Building view.
 *
 * One `BuildingView` per configured building. Everything is drawn from the
 * config — footprint, height, archetype — so a building that is moved, resized
 * or restyled is simply rebuilt, never special-cased.
 *
 * Material language, applied identically to every archetype:
 *   - graphite mass, near-black, with directional shading
 *   - obsidian glass curtain wall with a fine silver mullion grid
 *   - a brushed silver band at every setback and parapet
 *   - white interior light behind the glass, warm only where people are
 *   - one small cool-blue accent, never more
 */

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { gridToScreen } from '@/core/iso';
import { palette, iso, typography } from '@/design/tokens';
import type { BuildingConfig, BuildingStatus, CampusTheme } from '@/core/types';
import { BUILDING_VISUALS } from '../stateVisuals';
import {
  SHADE,
  type FaceKind,
  type Mass,
  drumEllipse,
  faceQuad,
  facePatch,
  facePoint,
  massesFor,
  mixColor,
  poly,
  shade,
  topQuad,
} from '../geometry';
import { beamTexture, glowTexture, groundGlowTexture } from './textures';

const FLOOR_UNITS = 3;

interface WindowCell {
  mass: number;
  face: FaceKind;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Per-window randomness: base luminance and animation phase. */
  seed: number;
  /** Current luminance, eased toward a target so screens fade, never blink. */
  lum: number;
  target: number;
}

export class BuildingView {
  readonly id: string;
  readonly container = new Container();

  private cfg: BuildingConfig;
  private theme: CampusTheme;

  private structure = new Graphics();
  private glassLayer = new Graphics();
  private trim = new Graphics();
  private windowLayer = new Graphics();
  private detail = new Graphics();
  private bloom = new Container();
  private beacon: Sprite | null = null;
  private beaconBeam: Sprite | null = null;
  private plinth: Sprite;
  private signage: Container;
  private signText: Text;

  private masses: Mass[] = [];
  private cells: WindowCell[] = [];
  private status: BuildingStatus = 'normal';
  private windowClock = 0;
  private lastLod: 'full' | 'reduced' | 'coarse' | null = null;
  private disposed = false;

  /** Screen-space anchor used by the camera when focusing this building. */
  readonly focus: { sx: number; sy: number };
  readonly depth: number;

  constructor(cfg: BuildingConfig, theme: CampusTheme) {
    this.id = cfg.id;
    this.cfg = cfg;
    this.theme = theme;

    const f = cfg.footprint;
    this.depth = (f.x + f.w / 2 + f.y + f.h / 2) * 1000;
    const c = gridToScreen(f.x + f.w / 2, f.y + f.h / 2, cfg.height * 0.45);
    this.focus = { sx: c.sx, sy: c.sy };

    // Ground light wash beneath the mass — the building sits *in* light.
    this.plinth = new Sprite(groundGlowTexture(256));
    this.plinth.anchor.set(0.5, 0.5);
    const ground = gridToScreen(f.x + f.w / 2, f.y + f.h / 2, 0);
    this.plinth.position.set(ground.sx, ground.sy);
    this.plinth.width = Math.max(f.w, f.h) * iso.tileWidth * 1.5;
    this.plinth.height = Math.max(f.w, f.h) * iso.tileHeight * 1.6;
    this.plinth.blendMode = 'add';
    this.plinth.alpha = 0.16;
    this.plinth.tint = palette.lightWhite;

    this.signText = new Text({
      text: cfg.name,
      style: new TextStyle({
        fontFamily: typography.ui,
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 1.6,
        fill: palette.silverBright,
      }),
    });
    this.signText.anchor.set(0.5, 1);
    this.signage = new Container();
    this.signage.addChild(this.signText);

    this.container.addChild(
      this.plinth,
      this.structure,
      this.glassLayer,
      this.windowLayer,
      this.trim,
      this.detail,
      this.bloom,
      this.signage,
    );
    this.container.zIndex = this.depth;

    this.build();
  }

  /* ---------------------------------------------------------------- */
  /* Construction                                                      */
  /* ---------------------------------------------------------------- */

  private build(): void {
    const cfg = this.cfg;
    this.masses = massesFor(cfg.style, cfg.footprint, cfg.height);
    this.structure.clear();
    this.glassLayer.clear();
    this.trim.clear();
    this.detail.clear();

    if (cfg.locked) {
      this.drawLockedPlot();
      this.buildSignage();
      return;
    }

    if (cfg.style === 'cylinder') this.drawDrum();
    else this.drawMasses();

    this.buildWindowCells();
    this.drawRoofDetail();
    this.drawEntrance();
    this.buildBeacon();
    this.buildSignage();
    this.redrawWindows(1);
  }

  private baseColor(): number {
    const base = this.theme.buildingBase;
    switch (this.cfg.accent) {
      case 'blue':
        return mixColor(base, palette.blueDeep, 0.1);
      case 'gold':
        // Gold is a *light* on this campus, not a material. Keep the mass dark.
        return mixColor(base, palette.gold, 0.025);
      case 'silver':
        return mixColor(base, palette.silver, 0.07);
      default:
        return base;
    }
  }

  private drawMasses(): void {
    const base = this.baseColor();
    const glass = this.theme.glass;
    const g = this.structure;
    const gl = this.glassLayer;
    const t = this.trim;

    for (const m of this.masses) {
      const top = poly(topQuad(m));
      const left = poly(faceQuad(m, 'left'));
      const right = poly(faceQuad(m, 'right'));

      // Solid mass first — this is the graphite body.
      g.poly(right).fill({ color: shade(base, SHADE.right) });
      g.poly(left).fill({ color: shade(base, SHADE.left) });

      // Obsidian glass curtain wall laid over the body, inset slightly from the
      // structural edges so the silver frame reads as a separate plane.
      gl.poly(facePatch(m, 'left', 0.035, 0.965, 0.02, 0.985)).fill({
        color: shade(glass, SHADE.left),
        alpha: 0.94,
      });
      gl.poly(facePatch(m, 'right', 0.035, 0.965, 0.02, 0.985)).fill({
        color: shade(glass, SHADE.right),
        alpha: 0.94,
      });

      // Roof plate — lighter, with a faint sheen toward the light.
      g.poly(top).fill({ color: shade(base, SHADE.top * 1.06) });
      g.poly(top).stroke({ color: palette.silverDim, width: 1, alpha: 0.5 });

      // Brushed silver band capping the mass.
      this.drawParapet(t, m);

      // Corner columns: the vertical silver structure that ties the campus
      // architecture together.
      for (const face of ['left', 'right'] as FaceKind[]) {
        t.poly(facePatch(m, face, 0, 0.035, 0, 1)).fill({ color: palette.silverDim, alpha: 0.55 });
        t.poly(facePatch(m, face, 0.965, 1, 0, 1)).fill({ color: palette.silverDim, alpha: 0.55 });
      }
    }

    this.drawStyleSignature();
  }

  private drawParapet(t: Graphics, m: Mass): void {
    const capH = Math.min(0.06, 1.2 / Math.max(1, m.top - m.base));
    for (const face of ['left', 'right'] as FaceKind[]) {
      const factor = face === 'left' ? 0.9 : 0.62;
      t.poly(facePatch(m, face, 0, 1, 1 - capH, 1)).fill({
        color: shade(palette.silver, factor),
        alpha: 0.85,
      });
    }
  }

  /** Per-archetype flourishes that give each building its own silhouette. */
  private drawStyleSignature(): void {
    const d = this.detail;
    const cfg = this.cfg;
    const f = cfg.footprint;
    const topMass = this.masses[this.masses.length - 1];

    switch (cfg.style) {
      case 'tower': {
        // Illuminated crown mast — the single tallest point on the campus.
        const c = gridToScreen(f.x + f.w / 2, f.y + f.h / 2, cfg.height);
        const tipY = c.sy - iso.heightUnit * 3.2;
        d.moveTo(c.sx, c.sy).lineTo(c.sx, tipY).stroke({ color: palette.silver, width: 2, alpha: 0.9 });
        d.circle(c.sx, tipY, 2.4).fill({ color: palette.lightWhite });
        // Vertical silver spine running the height of the shaft.
        for (const face of ['left', 'right'] as FaceKind[]) {
          d.poly(facePatch(this.masses[1], face, 0.48, 0.52, 0, 1)).fill({
            color: palette.silver,
            alpha: 0.4,
          });
        }
        break;
      }

      case 'suite': {
        // Cantilever soffit picked out in light, plus a slim silver underside
        // rib — this is the detail that makes the box read as *lifted*.
        const podium = this.masses[0];
        const box = this.masses[1];
        for (const face of ['left', 'right'] as FaceKind[]) {
          d.poly(facePatch(box, face, 0, 1, 0, 0.05)).fill({ color: palette.goldBright, alpha: 0.13 });
        }
        d.poly(poly(topQuad({ ...podium, top: podium.top }))).fill({
          color: palette.graphiteEdge,
          alpha: 0.6,
        });
        break;
      }

      case 'lab': {
        // Clerestory band glazed edge-to-edge and lit from within.
        const cler = this.masses[1];
        for (const face of ['left', 'right'] as FaceKind[]) {
          d.poly(facePatch(cler, face, 0.04, 0.96, 0.15, 0.85)).fill({
            color: palette.lightCool,
            alpha: 0.14,
          });
        }
        break;
      }

      case 'bunker': {
        // Angled buttresses at each visible corner.
        const m = this.masses[0];
        for (const face of ['left', 'right'] as FaceKind[]) {
          for (const u of [0.12, 0.5, 0.88]) {
            const a = facePoint(m, face, u - 0.05, 0);
            const b = facePoint(m, face, u + 0.05, 0);
            const c = facePoint(m, face, u, 1);
            d.poly([a.sx, a.sy, b.sx, b.sy, c.sx, c.sy]).fill({
              color: shade(this.baseColor(), face === 'left' ? 0.82 : 0.5),
            });
          }
        }
        break;
      }

      case 'vault': {
        // Deep silver ribs instead of windows. The archive shows nothing.
        const m = this.masses[0];
        for (const face of ['left', 'right'] as FaceKind[]) {
          const cols = Math.max(4, Math.round((face === 'left' ? f.w : f.h) * 1.1));
          for (let i = 0; i < cols; i++) {
            const u = (i + 0.5) / cols;
            d.poly(facePatch(m, face, u - 0.014, u + 0.014, 0.03, 0.97)).fill({
              color: shade(palette.silverDim, face === 'left' ? 0.95 : 0.6),
              alpha: 0.75,
            });
          }
        }
        break;
      }

      case 'studio': {
        // Sawtooth north-light roof.
        const m = this.masses[0];
        const teeth = Math.max(3, Math.round(f.h / 3));
        for (let i = 0; i < teeth; i++) {
          const y0 = f.y + (i / teeth) * f.h;
          const y1 = f.y + ((i + 0.62) / teeth) * f.h;
          const peak = cfg.height;
          const a = gridToScreen(f.x, y0, m.top);
          const b = gridToScreen(f.x + f.w, y0, m.top);
          const c = gridToScreen(f.x + f.w, y1, peak);
          const e = gridToScreen(f.x, y1, peak);
          d.poly([a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, e.sx, e.sy]).fill({
            color: shade(this.baseColor(), 0.92),
          });
          // Glazed face of each tooth, angled to catch the light.
          const g0 = gridToScreen(f.x, y1, peak);
          const g1 = gridToScreen(f.x + f.w, y1, peak);
          const g2 = gridToScreen(f.x + f.w, y1, m.top);
          const g3 = gridToScreen(f.x, y1, m.top);
          d.poly([g0.sx, g0.sy, g1.sx, g1.sy, g2.sx, g2.sy, g3.sx, g3.sy]).fill({
            color: palette.obsidianGlass,
            alpha: 0.95,
          });
        }
        break;
      }

      case 'hub': {
        // Slender columns lifting the canopy, and a lit platform edge.
        const roof = this.masses[1];
        const cols = 5;
        for (let i = 0; i <= cols; i++) {
          const u = i / cols;
          const gx = f.x + u * f.w;
          const a = gridToScreen(gx, f.y + f.h, 0);
          const b = gridToScreen(gx, f.y + f.h, roof.base);
          d.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({ color: palette.silverDim, width: 2, alpha: 0.8 });
          const c = gridToScreen(f.x + f.w, f.y + u * f.h, 0);
          const e = gridToScreen(f.x + f.w, f.y + u * f.h, roof.base);
          d.moveTo(c.sx, c.sy).lineTo(e.sx, e.sy).stroke({ color: palette.silverDim, width: 2, alpha: 0.8 });
        }
        break;
      }

      case 'annex': {
        // Rooftop plant and a service gantry.
        const roof = topMass.top;
        for (let i = 0; i < 3; i++) {
          const rx = f.x + 1.5 + i * ((f.w - 3) / 3);
          const a = gridToScreen(rx, f.y + 2, roof);
          const b = gridToScreen(rx, f.y + f.h - 2, roof);
          d.moveTo(a.sx, a.sy)
            .lineTo(b.sx, b.sy)
            .stroke({ color: palette.silverDim, width: 3, alpha: 0.7 });
        }
        break;
      }

      default:
        break;
    }
  }

  /** Communications drum — a true cylinder rather than a boxed prism. */
  private drawDrum(): void {
    const cfg = this.cfg;
    const f = cfg.footprint;
    const h = cfg.height;
    const g = this.structure;
    const t = this.trim;
    const base = this.baseColor();

    const bottom = drumEllipse(f, 0);
    const top = drumEllipse(f, h);

    // Barrel: the ellipse sweep between the two rings.
    const pts: number[] = [];
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI * (i / steps);
      pts.push(top.cx + Math.cos(a) * top.rx, top.cy + Math.sin(a) * top.ry);
    }
    for (let i = steps; i >= 0; i--) {
      const a = Math.PI * (i / steps);
      pts.push(bottom.cx + Math.cos(a) * bottom.rx, bottom.cy + Math.sin(a) * bottom.ry);
    }
    g.poly(pts).fill({ color: shade(base, 0.58) });

    // Curvature: a vertical gradient faked with a few overlaid slices.
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI * (i / 8);
      const a1 = Math.PI * ((i + 1) / 8);
      const lit = 1 - Math.abs(i - 2.2) / 6;
      const slice = [
        top.cx + Math.cos(a0) * top.rx,
        top.cy + Math.sin(a0) * top.ry,
        top.cx + Math.cos(a1) * top.rx,
        top.cy + Math.sin(a1) * top.ry,
        bottom.cx + Math.cos(a1) * bottom.rx,
        bottom.cy + Math.sin(a1) * bottom.ry,
        bottom.cx + Math.cos(a0) * bottom.rx,
        bottom.cy + Math.sin(a0) * bottom.ry,
      ];
      g.poly(slice).fill({ color: palette.lightCool, alpha: Math.max(0, lit) * 0.05 });
    }

    // Glazed bands wrapping the drum.
    const bands = Math.max(3, Math.round(h / FLOOR_UNITS));
    for (let b = 0; b < bands; b++) {
      const v0 = (b + 0.22) / bands;
      const v1 = (b + 0.78) / bands;
      const e0 = drumEllipse(f, h * v0);
      const e1 = drumEllipse(f, h * v1);
      const band: number[] = [];
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI * (i / steps);
        band.push(e1.cx + Math.cos(a) * e1.rx, e1.cy + Math.sin(a) * e1.ry);
      }
      for (let i = steps; i >= 0; i--) {
        const a = Math.PI * (i / steps);
        band.push(e0.cx + Math.cos(a) * e0.rx, e0.cy + Math.sin(a) * e0.ry);
      }
      this.glassLayer.poly(band).fill({ color: this.theme.glass, alpha: 0.9 });
    }

    // Silver cap ring and roof disc.
    g.ellipse(top.cx, top.cy, top.rx, top.ry).fill({ color: shade(base, 1.1) });
    t.ellipse(top.cx, top.cy, top.rx, top.ry).stroke({ color: palette.silver, width: 2, alpha: 0.8 });
    t.ellipse(top.cx, top.cy, top.rx * 0.55, top.ry * 0.55).stroke({
      color: palette.silverDim,
      width: 1,
      alpha: 0.6,
    });

    // Antenna array.
    const tipY = top.cy - iso.heightUnit * 2.6;
    this.detail
      .moveTo(top.cx, top.cy)
      .lineTo(top.cx, tipY)
      .stroke({ color: palette.silver, width: 2, alpha: 0.9 });
    for (const dx of [-6, 6]) {
      this.detail
        .moveTo(top.cx, tipY + 8)
        .lineTo(top.cx + dx, tipY - 2)
        .stroke({ color: palette.silverDim, width: 1.4, alpha: 0.8 });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Windows                                                           */
  /* ---------------------------------------------------------------- */

  private buildWindowCells(): void {
    this.cells = [];
    const cfg = this.cfg;
    if (cfg.style === 'vault' || cfg.style === 'hub' || cfg.style === 'cylinder') return;

    let seedState = hashString(cfg.id);
    const rand = (): number => {
      seedState = (seedState * 1664525 + 1013904223) >>> 0;
      return seedState / 4294967296;
    };

    this.masses.forEach((m, mi) => {
      const span = m.top - m.base;
      const floors = Math.max(1, Math.round(span / FLOOR_UNITS));
      if (floors < 1) return;

      for (const face of ['left', 'right'] as FaceKind[]) {
        const widthTiles = face === 'left' ? m.rect.w : m.rect.h;
        const cols = Math.max(2, Math.round(widthTiles * 0.8));
        for (let fl = 0; fl < floors; fl++) {
          for (let c = 0; c < cols; c++) {
            // Ribbon glazing: wide, shallow lights separated by slim mullions.
            // A square grid reads as a game asset; a horizontal band reads as
            // a curtain wall.
            const u0 = (c + 0.1) / cols;
            const u1 = (c + 0.9) / cols;
            const v0 = (fl + 0.3) / floors;
            const v1 = (fl + 0.74) / floors;
            const seed = rand();
            this.cells.push({
              mass: mi,
              face,
              u0,
              u1,
              v0,
              v1,
              seed,
              lum: seed * 0.5,
              target: seed * 0.5,
            });
          }
        }
      }
    });
  }

  /**
   * Redraw the emissive window layer. Called on a slow cadence, not per frame:
   * office lights change over seconds, and a per-frame redraw of ~400 quads
   * across ten buildings is exactly the kind of cost that ruins a 60 fps budget.
   */
  private redrawWindows(blend: number): void {
    const g = this.windowLayer;
    g.clear();
    if (this.cells.length === 0) return;

    const vis = BUILDING_VISUALS[this.status];
    const warm = mixColor(vis.glow, palette.lightWarm, 0.35);

    for (const cell of this.cells) {
      cell.lum += (cell.target - cell.lum) * blend;
      const m = this.masses[cell.mass];
      if (!m) continue;
      const faceFactor = cell.face === 'left' ? 1 : 0.7;
      const a = cell.lum * vis.intensity * faceFactor;
      if (a < 0.015) continue;
      // A minority of floors run warm interior light; the rest stay white.
      const color = cell.seed > 0.82 ? warm : vis.glow;
      g.poly(facePatch(m, cell.face, cell.u0, cell.u1, cell.v0, cell.v1)).fill({
        color,
        alpha: Math.min(0.92, a),
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Details                                                           */
  /* ---------------------------------------------------------------- */

  private drawRoofDetail(): void {
    const cfg = this.cfg;
    if (cfg.style === 'cylinder' || cfg.style === 'hub' || cfg.locked) return;
    const topMass = this.masses[this.masses.length - 1];
    const r = topMass.rect;
    const h = topMass.top;
    const d = this.detail;

    // Roof edge lighting — a thin cool line tracing the parapet.
    const edge = topQuad(topMass);
    d.poly(poly(edge)).stroke({ color: palette.lightCool, width: 1, alpha: 0.28 });

    // Service boxes, kept small and off-centre so roofs never look symmetrical.
    const boxes = cfg.style === 'tower' ? 1 : 2;
    for (let i = 0; i < boxes; i++) {
      const bx = r.x + r.w * (0.28 + i * 0.34);
      const by = r.y + r.h * (0.3 + i * 0.22);
      const bw = Math.max(0.8, r.w * 0.16);
      const bh = Math.max(0.8, r.h * 0.16);
      const bhh = 1.1;
      const box: Mass = { rect: { x: bx, y: by, w: bw, h: bh }, base: h, top: h + bhh };
      d.poly(poly(faceQuad(box, 'right'))).fill({ color: shade(palette.graphite, 0.5) });
      d.poly(poly(faceQuad(box, 'left'))).fill({ color: shade(palette.graphite, 0.8) });
      d.poly(poly(topQuad(box))).fill({ color: palette.graphiteHigh });
    }
  }

  private drawEntrance(): void {
    const cfg = this.cfg;
    const e = cfg.entrance;
    const d = this.detail;

    // Lit threshold on the ground at the door.
    const a = gridToScreen(e.x, e.y, 0);
    const b = gridToScreen(e.x + 1, e.y, 0);
    const c = gridToScreen(e.x + 1, e.y + 1, 0);
    const f = gridToScreen(e.x, e.y + 1, 0);
    d.poly([a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, f.sx, f.sy]).fill({
      color: palette.lightWhite,
      alpha: 0.16,
    });

    const glow = new Sprite(glowTexture(128));
    glow.anchor.set(0.5);
    const centre = gridToScreen(e.x + 0.5, e.y + 0.5, 0.6);
    glow.position.set(centre.sx, centre.sy);
    glow.width = 74;
    glow.height = 44;
    glow.blendMode = 'add';
    glow.alpha = 0.34;
    glow.tint = palette.lightWhite;
    this.bloom.addChild(glow);
  }

  private buildBeacon(): void {
    const cfg = this.cfg;
    const f = cfg.footprint;
    const top = gridToScreen(f.x + f.w / 2, f.y + f.h / 2, cfg.height + 0.6);

    const beam = new Sprite(beamTexture(48, 320));
    beam.anchor.set(0.5, 1);
    beam.position.set(top.sx, top.sy);
    beam.blendMode = 'add';
    beam.alpha = 0;
    beam.height = 130;
    beam.width = 44;
    this.bloom.addChild(beam);
    this.beaconBeam = beam;

    const light = new Sprite(glowTexture(128));
    light.anchor.set(0.5);
    light.position.set(top.sx, top.sy);
    light.width = 56;
    light.height = 56;
    light.blendMode = 'add';
    light.alpha = 0;
    this.bloom.addChild(light);
    this.beacon = light;
  }

  private buildSignage(): void {
    const f = this.cfg.footprint;
    // Signage stands clear of the near facade so the mass never covers it.
    const p = gridToScreen(f.x + f.w * 0.5, f.y + f.h + 2.2, 0);
    this.signage.position.set(p.sx, p.sy);
    this.signText.text = this.cfg.name.toUpperCase();
    this.signText.alpha = 0.86;
  }

  private drawLockedPlot(): void {
    const f = this.cfg.footprint;
    const g = this.structure;
    const corners = [
      gridToScreen(f.x, f.y, 0),
      gridToScreen(f.x + f.w, f.y, 0),
      gridToScreen(f.x + f.w, f.y + f.h, 0),
      gridToScreen(f.x, f.y + f.h, 0),
    ];
    g.poly(poly(corners)).fill({ color: 0x05070a, alpha: 0.9 });
    g.poly(poly(corners)).stroke({ color: palette.silverDim, width: 1, alpha: 0.35 });
    this.plinth.alpha = 0.04;
  }

  /* ---------------------------------------------------------------- */
  /* State                                                             */
  /* ---------------------------------------------------------------- */

  setStatus(status: BuildingStatus): void {
    if (this.status === status) return;
    this.status = status;
    // Re-roll window targets so a status change visibly ripples through the
    // facade instead of snapping.
    const vis = BUILDING_VISUALS[status];
    for (const cell of this.cells) {
      const occupancy = status === 'offline' ? 0 : status === 'paused' ? 0.25 : 1;
      cell.target = Math.min(1, cell.seed * 1.3 * occupancy * (0.5 + vis.intensity));
    }
    this.redrawWindows(0.35);
  }

  setTheme(theme: CampusTheme): void {
    this.theme = theme;
    this.build();
    this.setStatus(this.status);
  }

  /** Rebuild after a config edit (moved, resized, renamed, restyled). */
  setConfig(cfg: BuildingConfig): void {
    this.cfg = cfg;
    this.bloom.removeChildren().forEach((c) => c.destroy());
    this.beacon = null;
    this.beaconBeam = null;
    this.build();
    this.setStatus(this.status);
  }

  get config(): BuildingConfig {
    return this.cfg;
  }

  /**
   * Per-frame update. `lod` gates how much the building is allowed to animate;
   * `onScreen` false means skip everything but the cheapest work.
   */
  update(dtMs: number, timeMs: number, lod: 'full' | 'reduced' | 'coarse', onScreen: boolean): void {
    if (this.disposed) return;

    if (this.lastLod !== lod) {
      this.lastLod = lod;
      this.detail.visible = lod !== 'coarse';
      this.trim.visible = lod !== 'coarse';
      this.signage.visible = lod === 'full';
      // Lit windows are never dropped. They are the only thing that separates
      // one dark mass from another when the whole campus is in frame, so LOD
      // freezes their animation rather than hiding them.
      this.windowLayer.visible = true;
    }

    if (!onScreen) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    const vis = BUILDING_VISUALS[this.status];

    // Beacon: a slow architectural breath, never a strobe.
    if (this.beacon && this.beaconBeam) {
      if (vis.beacon === null) {
        this.beacon.alpha += (0 - this.beacon.alpha) * 0.08;
        this.beaconBeam.alpha += (0 - this.beaconBeam.alpha) * 0.08;
      } else {
        const period = vis.beaconPulse === 2 ? 1400 : 3200;
        const wave = 0.5 + 0.5 * Math.sin((timeMs / period) * Math.PI * 2);
        this.beacon.tint = vis.beacon;
        this.beaconBeam.tint = vis.beacon;
        const targetA = 0.35 + wave * 0.45;
        this.beacon.alpha += (targetA - this.beacon.alpha) * 0.12;
        this.beaconBeam.alpha += (targetA * 0.34 - this.beaconBeam.alpha) * 0.12;
      }
    }

    this.plinth.tint = vis.glow;
    this.plinth.alpha = 0.05 + vis.intensity * 0.16;

    if (lod === 'coarse' || this.cells.length === 0) return;

    // Slow screen churn: a handful of windows retarget every cycle.
    this.windowClock += dtMs;
    const cadence = lod === 'full' ? 420 : 900;
    if (this.windowClock >= cadence) {
      this.windowClock = 0;
      const churn = this.status === 'offline' ? 0 : Math.ceil(this.cells.length * 0.05);
      for (let i = 0; i < churn; i++) {
        const cell = this.cells[Math.floor(Math.random() * this.cells.length)];
        const occupancy = this.status === 'paused' ? 0.25 : 1;
        cell.target = Math.min(1, (0.25 + Math.random() * 0.9) * occupancy);
      }
      this.redrawWindows(0.5);
    }
  }

  destroy(): void {
    this.disposed = true;
    this.container.destroy({ children: true });
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
