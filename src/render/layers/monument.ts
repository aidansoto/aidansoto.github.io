/**
 * The plaza monument.
 *
 * A single holographic obelisk above an obsidian plinth at the centre of the
 * campus. It is the one object allowed to be expressive, because it carries
 * the whole ecosystem's state in a glance:
 *
 *   calm white   → normal
 *   drifting blue → active
 *   gold accents  → sustained productivity
 *   red           → serious problems
 *   dimmed        → paused or stopped
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { gridToScreen } from '@/core/iso';
import { palette } from '@/design/tokens';
import { beamTexture, glowTexture, groundGlowTexture } from '../factory/textures';
import { mixColor } from '../geometry';

export type MonumentMood = 'normal' | 'active' | 'productive' | 'alert' | 'paused' | 'stopped';

const MOOD_COLOR: Record<MonumentMood, number> = {
  normal: palette.lightWhite,
  active: palette.blueGlow,
  productive: palette.goldBright,
  alert: palette.redBright,
  paused: palette.silverDim,
  stopped: 0x2b3138,
};

export class Monument {
  readonly container = new Container();

  private plinth = new Graphics();
  private core = new Graphics();
  private beam: Sprite;
  private halo: Sprite;
  private pool: Sprite;
  private orbits: Sprite[] = [];

  private originX = 0;
  private originY = 0;
  private mood: MonumentMood = 'normal';
  private color = MOOD_COLOR.normal;
  private targetColor = MOOD_COLOR.normal;
  private energy = 0.4;
  private targetEnergy = 0.4;
  private spin = 0;

  constructor(gx: number, gy: number) {
    const base = gridToScreen(gx, gy, 0);
    this.originX = base.sx;
    this.originY = base.sy;

    this.pool = new Sprite(groundGlowTexture(256));
    this.pool.anchor.set(0.5);
    this.pool.position.set(base.sx, base.sy);
    this.pool.width = 260;
    this.pool.height = 130;
    this.pool.blendMode = 'add';
    this.pool.alpha = 0.2;

    this.beam = new Sprite(beamTexture(64, 384));
    this.beam.anchor.set(0.5, 1);
    this.beam.position.set(base.sx, base.sy - 8);
    this.beam.width = 54;
    this.beam.height = 210;
    this.beam.blendMode = 'add';
    this.beam.alpha = 0.3;

    this.halo = new Sprite(glowTexture(256));
    this.halo.anchor.set(0.5);
    this.halo.position.set(base.sx, base.sy - 70);
    this.halo.width = 190;
    this.halo.height = 190;
    this.halo.blendMode = 'add';
    this.halo.alpha = 0.28;

    this.container.addChild(this.pool, this.plinth, this.beam, this.core, this.halo);

    for (let i = 0; i < 5; i++) {
      const s = new Sprite(glowTexture(64));
      s.anchor.set(0.5);
      s.width = 12;
      s.height = 12;
      s.blendMode = 'add';
      s.alpha = 0.6;
      this.orbits.push(s);
      this.container.addChild(s);
    }

    this.container.zIndex = (gx + gy) * 1000 + 400;
    this.drawPlinth(gx, gy);
  }

  private drawPlinth(gx: number, gy: number): void {
    const g = this.plinth;
    g.clear();
    // Three stepped obsidian tiers.
    const tiers = [
      { r: 3.0, h: 0.0, top: 0.7 },
      { r: 2.2, h: 0.7, top: 1.4 },
      { r: 1.4, h: 1.4, top: 2.1 },
    ];
    for (const t of tiers) {
      const corners = [
        gridToScreen(gx - t.r, gy - t.r, t.top),
        gridToScreen(gx + t.r, gy - t.r, t.top),
        gridToScreen(gx + t.r, gy + t.r, t.top),
        gridToScreen(gx - t.r, gy + t.r, t.top),
      ];
      const skirtL = gridToScreen(gx - t.r, gy + t.r, t.h);
      const skirtR = gridToScreen(gx + t.r, gy + t.r, t.h);
      const skirtE = gridToScreen(gx + t.r, gy - t.r, t.h);

      // Left face.
      g.poly([
        corners[3].sx, corners[3].sy,
        corners[2].sx, corners[2].sy,
        skirtR.sx, skirtR.sy,
        skirtL.sx, skirtL.sy,
      ]).fill({ color: 0x0b0f14 });
      // Right face.
      g.poly([
        corners[2].sx, corners[2].sy,
        corners[1].sx, corners[1].sy,
        skirtE.sx, skirtE.sy,
        skirtR.sx, skirtR.sy,
      ]).fill({ color: 0x060a0e });
      // Polished top.
      g.poly(corners.flatMap((p) => [p.sx, p.sy]))
        .fill({ color: 0x121820 })
        .stroke({ color: palette.silver, width: 1, alpha: 0.45 });
    }
  }

  setMood(mood: MonumentMood, activity: number): void {
    this.mood = mood;
    this.targetColor = MOOD_COLOR[mood];
    this.targetEnergy =
      mood === 'stopped' ? 0.02 : mood === 'paused' ? 0.12 : 0.32 + Math.min(1, activity) * 0.68;
  }

  update(dtMs: number, timeMs: number, animate: boolean): void {
    this.color = mixColor(this.color, this.targetColor, 0.05);
    this.energy += (this.targetEnergy - this.energy) * 0.04;

    if (animate) this.spin += (dtMs / 1000) * (0.25 + this.energy * 0.55);

    const pulse = animate ? 0.86 + 0.14 * Math.sin(timeMs / 1800) : 1;

    /* Obelisk: a faceted shard, redrawn each frame — one small Graphics. */
    const g = this.core;
    g.clear();
    const topY = this.originY - 24 - 92 * (0.55 + this.energy * 0.45);
    const midY = this.originY - 22 - 40;
    const baseY = this.originY - 22;
    const halfW = 12 + this.energy * 5;

    for (let f = 0; f < 4; f++) {
      const a0 = this.spin + (f * Math.PI) / 2;
      const a1 = a0 + Math.PI / 2;
      const x0 = this.originX + Math.cos(a0) * halfW;
      const x1 = this.originX + Math.cos(a1) * halfW;
      // Facets facing the viewer catch more light.
      const facing = (Math.sin(a0) + Math.sin(a1)) / 2;
      const alpha = (0.16 + Math.max(0, facing) * 0.4) * (0.4 + this.energy * 0.6) * pulse;
      g.poly([
        this.originX, topY,
        x1, midY,
        x1 * 0.5 + this.originX * 0.5, baseY,
        x0 * 0.5 + this.originX * 0.5, baseY,
        x0, midY,
      ]).fill({ color: this.color, alpha });
      g.moveTo(this.originX, topY)
        .lineTo(x0, midY)
        .stroke({ color: this.color, width: 1, alpha: alpha * 1.6 });
    }
    // Bright core line down the axis.
    g.moveTo(this.originX, topY)
      .lineTo(this.originX, baseY)
      .stroke({ color: palette.chrome, width: 1.4, alpha: 0.28 + this.energy * 0.4 });

    /* Light --------------------------------------------------------- */
    this.beam.tint = this.color;
    this.beam.alpha = (0.06 + this.energy * 0.26) * pulse;
    this.beam.height = 150 + this.energy * 140;

    this.halo.tint = this.color;
    this.halo.alpha = (0.08 + this.energy * 0.3) * pulse;
    this.halo.y = topY + 40;

    this.pool.tint = this.color;
    this.pool.alpha = 0.06 + this.energy * 0.22;

    /* Orbiting motes — only when the ecosystem is actually doing work. */
    const showOrbits = this.mood === 'active' || this.mood === 'productive';
    this.orbits.forEach((s, i) => {
      s.visible = showOrbits && animate;
      if (!s.visible) return;
      const a = this.spin * 1.6 + (i / this.orbits.length) * Math.PI * 2;
      const rx = 30 + i * 3;
      const ry = 11 + i * 1.2;
      s.position.set(
        this.originX + Math.cos(a) * rx,
        this.originY - 46 - Math.sin(a * 0.6) * 14 + Math.sin(a) * ry * 0.4,
      );
      s.tint = this.color;
      s.alpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(a));
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
