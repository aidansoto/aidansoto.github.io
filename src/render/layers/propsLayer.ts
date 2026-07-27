/**
 * Landscaping, lighting and street furniture.
 *
 * Restraint is the design rule here: the plaza has to feel expensive and
 * intentional, and the fastest way to lose that is clutter. Props are drawn
 * from the campus document, batched aggressively, and everything except the
 * trees and the monument is completely static.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { gridToScreen } from '@/core/iso';
import { palette, iso } from '@/design/tokens';
import type { CampusDocument, CampusTheme, PropConfig } from '@/core/types';
import { glowTexture, groundGlowTexture } from '../factory/textures';

let treeTexture: Texture | null = null;

/** A columnar evergreen — architectural, not decorative. */
function makeTreeTexture(): Texture {
  if (treeTexture) return treeTexture;
  const W = 28;
  const H = 96;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  // Trunk.
  ctx.fillStyle = '#0e1412';
  ctx.fillRect(W / 2 - 1.5, H - 20, 3, 20);

  // Canopy: a tall taper built from stacked lobes.
  const lobes = 7;
  for (let i = 0; i < lobes; i++) {
    const t = i / (lobes - 1);
    const cy = H - 18 - t * 66;
    const rx = 11 * (1 - t * 0.68) + 2;
    const ry = 12 * (1 - t * 0.35);
    const light = 0.18 + t * 0.2;
    const g = ctx.createLinearGradient(W / 2 - rx, cy, W / 2 + rx, cy);
    g.addColorStop(0, `rgba(52,84,70,${0.55 + light})`);
    g.addColorStop(0.45, `rgba(24,44,36,${0.85})`);
    g.addColorStop(1, 'rgba(9,18,15,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(W / 2, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cool rim light down the lit edge, matching the campus key.
  ctx.strokeStyle = 'rgba(180,208,224,0.22)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 9, H - 22);
  ctx.quadraticCurveTo(W / 2 - 7, H - 60, W / 2 - 2, H - 84);
  ctx.stroke();

  treeTexture = Texture.from(canvas);
  return treeTexture;
}

interface TreeInstance {
  sprite: Sprite;
  phase: number;
}

export class PropsLayer {
  /** Flat, ground-plane geometry. Drawn between the terrain and the buildings. */
  readonly container = new Container();

  private statics = new Graphics();
  private lights = new Container();
  private trees: TreeInstance[] = [];
  private doc: CampusDocument;
  private theme: CampusTheme;
  /**
   * Trees have real height, so they must sort against buildings rather than
   * sit in a flat band beneath them. They are added straight into the scene's
   * depth-sorted root instead of this layer's own container.
   */
  private depthHost: Container;

  constructor(doc: CampusDocument, theme: CampusTheme, depthHost: Container) {
    this.doc = doc;
    this.theme = theme;
    this.depthHost = depthHost;
    this.container.addChild(this.statics, this.lights);
    this.build();
  }

  setDocument(doc: CampusDocument): void {
    this.doc = doc;
    this.build();
  }

  setTheme(theme: CampusTheme): void {
    this.theme = theme;
    this.build();
  }

  private build(): void {
    this.statics.clear();
    this.lights.removeChildren().forEach((c) => c.destroy());
    for (const t of this.trees) t.sprite.destroy();
    this.trees = [];

    for (const prop of this.doc.props) {
      switch (prop.kind) {
        case 'tree':
          this.addTree(prop);
          break;
        case 'lamp':
          this.addLamp(prop);
          break;
        case 'bench':
          this.addBench(prop);
          break;
        case 'sign':
          this.addSign(prop);
          break;
        case 'planter':
          this.addPlanter(prop);
          break;
        case 'bollard':
          this.addBollard(prop);
          break;
        case 'shuttle_stop':
          this.addShuttleStop(prop);
          break;
        case 'monument':
          // Drawn by the dedicated Monument view.
          break;
      }
    }
  }

  private addTree(prop: PropConfig): void {
    const p = gridToScreen(prop.at.x + 0.5, prop.at.y + 0.5, 0);
    const s = new Sprite(makeTreeTexture());
    s.anchor.set(0.5, 1);
    const scale = (prop.scale ?? 1) * 0.62;
    s.scale.set(scale);
    s.position.set(p.sx, p.sy);
    s.zIndex = (prop.at.x + prop.at.y) * 1000 + 20;
    this.depthHost.addChild(s);
    this.trees.push({ sprite: s, phase: (prop.at.x * 13 + prop.at.y * 7) % 100 });

    // Contact shadow keeps the tree planted rather than pasted on.
    this.statics.ellipse(p.sx, p.sy, 8, 3.4).fill({ color: 0x000000, alpha: 0.4 });
  }

  private addLamp(prop: PropConfig): void {
    const base = gridToScreen(prop.at.x + 0.5, prop.at.y + 0.5, 0);
    // Roughly twice the height of a person. Anything taller turns the plaza
    // into a forest of poles and pulls the eye off the buildings.
    const headH = 1.8;
    const head = gridToScreen(prop.at.x + 0.5, prop.at.y + 0.5, headH);

    this.statics
      .moveTo(base.sx, base.sy)
      .lineTo(head.sx, head.sy)
      .stroke({ color: palette.silverDim, width: 1.1, alpha: 0.8 });
    this.statics
      .roundRect(head.sx - 2.4, head.sy - 1.2, 4.8, 1.6, 0.8)
      .fill({ color: palette.silver, alpha: 0.85 });

    const pool = new Sprite(groundGlowTexture(256));
    pool.anchor.set(0.5);
    pool.position.set(base.sx, base.sy);
    pool.width = iso.tileWidth * 1.5;
    pool.height = iso.tileHeight * 1.5;
    pool.blendMode = 'add';
    pool.alpha = 0.09;
    pool.tint = this.theme.pathLight;
    this.lights.addChild(pool);

    const bulb = new Sprite(glowTexture(64));
    bulb.anchor.set(0.5);
    bulb.position.set(head.sx, head.sy - 0.5);
    bulb.width = 15;
    bulb.height = 13;
    bulb.blendMode = 'add';
    bulb.alpha = 0.3;
    bulb.tint = this.theme.pathLight;
    this.lights.addChild(bulb);
  }

  private addBench(prop: PropConfig): void {
    const x = prop.at.x;
    const y = prop.at.y;
    const a = gridToScreen(x + 0.1, y + 0.3, 0.55);
    const b = gridToScreen(x + 0.9, y + 0.3, 0.55);
    const c = gridToScreen(x + 0.9, y + 0.7, 0.55);
    const d = gridToScreen(x + 0.1, y + 0.7, 0.55);
    this.statics
      .poly([a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, d.sx, d.sy])
      .fill({ color: palette.graphiteHigh })
      .stroke({ color: palette.silverDim, width: 0.8, alpha: 0.6 });
    // Front apron, so the seat reads as a solid slab with thickness.
    const e = gridToScreen(x + 0.1, y + 0.7, 0);
    const f = gridToScreen(x + 0.9, y + 0.7, 0);
    this.statics
      .poly([d.sx, d.sy, c.sx, c.sy, f.sx, f.sy, e.sx, e.sy])
      .fill({ color: palette.graphite });
  }

  private addSign(prop: PropConfig): void {
    const x = prop.at.x;
    const y = prop.at.y;
    const bottom = gridToScreen(x + 0.5, y + 0.5, 0);
    const top = gridToScreen(x + 0.5, y + 0.5, 3.6);

    this.statics
      .moveTo(bottom.sx, bottom.sy)
      .lineTo(top.sx, top.sy)
      .stroke({ color: palette.silverDim, width: 2, alpha: 0.8 });
    this.statics
      .roundRect(top.sx - 9, top.sy - 13, 18, 14, 1.5)
      .fill({ color: 0x060a10 })
      .stroke({ color: palette.silver, width: 1, alpha: 0.7 });

    // Illuminated content: abstract data rows, never legible text at this size.
    for (let i = 0; i < 4; i++) {
      this.statics
        .rect(top.sx - 6.5, top.sy - 10.5 + i * 2.6, 9 + ((i * 5) % 4), 1.1)
        .fill({ color: i === 0 ? palette.blueGlow : palette.silver, alpha: i === 0 ? 0.85 : 0.45 });
    }

    const glow = new Sprite(glowTexture(64));
    glow.anchor.set(0.5);
    glow.position.set(top.sx, top.sy - 6);
    glow.width = 40;
    glow.height = 34;
    glow.blendMode = 'add';
    glow.alpha = 0.28;
    glow.tint = palette.blue;
    this.lights.addChild(glow);
  }

  private addPlanter(prop: PropConfig): void {
    const x = prop.at.x;
    const y = prop.at.y;
    const top = [
      gridToScreen(x + 0.05, y + 0.05, 0.7),
      gridToScreen(x + 0.95, y + 0.05, 0.7),
      gridToScreen(x + 0.95, y + 0.95, 0.7),
      gridToScreen(x + 0.05, y + 0.95, 0.7),
    ];
    this.statics
      .poly(top.flatMap((p) => [p.sx, p.sy]))
      .fill({ color: palette.foliageHigh })
      .stroke({ color: palette.silver, width: 1, alpha: 0.55 });
    const fl = gridToScreen(x + 0.05, y + 0.95, 0);
    const fr = gridToScreen(x + 0.95, y + 0.95, 0);
    this.statics
      .poly([top[3].sx, top[3].sy, top[2].sx, top[2].sy, fr.sx, fr.sy, fl.sx, fl.sy])
      .fill({ color: palette.graphite });
  }

  private addBollard(prop: PropConfig): void {
    const base = gridToScreen(prop.at.x + 0.5, prop.at.y + 0.5, 0);
    const top = gridToScreen(prop.at.x + 0.5, prop.at.y + 0.5, 1.1);
    this.statics
      .moveTo(base.sx, base.sy)
      .lineTo(top.sx, top.sy)
      .stroke({ color: palette.silverDim, width: 2.2, alpha: 0.9 });
    this.statics.circle(top.sx, top.sy, 1.5).fill({ color: palette.lightWhite, alpha: 0.75 });
  }

  private addShuttleStop(prop: PropConfig): void {
    const x = prop.at.x;
    const y = prop.at.y;
    const roofH = 3.2;
    const roof = [
      gridToScreen(x - 0.2, y - 0.6, roofH),
      gridToScreen(x + 1.2, y - 0.6, roofH),
      gridToScreen(x + 1.2, y + 1.6, roofH),
      gridToScreen(x - 0.2, y + 1.6, roofH),
    ];
    this.statics
      .poly(roof.flatMap((p) => [p.sx, p.sy]))
      .fill({ color: palette.obsidianGlass, alpha: 0.85 })
      .stroke({ color: palette.silver, width: 1.2, alpha: 0.7 });

    for (const [cx, cy] of [
      [x - 0.1, y + 1.5],
      [x + 1.1, y + 1.5],
    ]) {
      const a = gridToScreen(cx, cy, 0);
      const b = gridToScreen(cx, cy, roofH);
      this.statics.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({
        color: palette.silverDim,
        width: 1.6,
        alpha: 0.9,
      });
    }

    const glow = new Sprite(groundGlowTexture(256));
    glow.anchor.set(0.5);
    const c = gridToScreen(x + 0.5, y + 0.5, 0);
    glow.position.set(c.sx, c.sy);
    glow.width = iso.tileWidth * 2.6;
    glow.height = iso.tileHeight * 2.6;
    glow.blendMode = 'add';
    glow.alpha = 0.16;
    glow.tint = palette.blueGlow;
    this.lights.addChild(glow);
  }

  /** Wind. A degree and a half of sway, on a long period. */
  update(timeMs: number, animate: boolean, windStrength: number): void {
    if (!animate || windStrength <= 0) {
      for (const t of this.trees) t.sprite.rotation = 0;
      return;
    }
    for (const t of this.trees) {
      t.sprite.rotation =
        Math.sin(timeMs / 2600 + t.phase) * 0.016 * windStrength +
        Math.sin(timeMs / 940 + t.phase * 1.7) * 0.005 * windStrength;
    }
  }

  destroy(): void {
    for (const t of this.trees) t.sprite.destroy();
    this.trees = [];
    this.container.destroy({ children: true });
  }
}
