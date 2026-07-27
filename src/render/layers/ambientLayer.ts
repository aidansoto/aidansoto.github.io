/**
 * Ambient campus life: skybridges, autonomous shuttles and delivery drones.
 *
 * This is what keeps the campus alive when nothing is happening. The rule is
 * that ambient motion must be noticeable only in peripheral vision — if it
 * pulls your eye away from an agent or a task, it is too strong.
 *
 * Shuttle routes are derived from the campus walkway configuration, so moving
 * or adding a path automatically reroutes traffic. Nothing is hard-coded to a
 * particular campus layout.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { gridToScreen } from '@/core/iso';
import { palette } from '@/design/tokens';
import type { BuildingConfig, CampusDocument, GridPoint } from '@/core/types';
import { glowTexture } from '../factory/textures';

interface Route {
  a: GridPoint;
  b: GridPoint;
  length: number;
}

interface Shuttle {
  view: Container;
  glow: Sprite;
  route: Route;
  t: number;
  dir: 1 | -1;
  speed: number;
  dwell: number;
}

interface Drone {
  view: Container;
  glow: Sprite;
  from: GridPoint;
  to: GridPoint;
  t: number;
  speed: number;
  height: number;
}

export class AmbientLayer {
  /**
   * Bridges and vehicles all have real height and must sort against the
   * buildings, so everything this layer creates is added straight into the
   * scene's depth-sorted root.
   */
  private depthHost: Container;

  private bridgeParts: Graphics[] = [];
  private shuttles: Shuttle[] = [];
  private drones: Drone[] = [];
  private doc: CampusDocument;
  private enabled = true;

  constructor(doc: CampusDocument, depthHost: Container) {
    this.doc = doc;
    this.depthHost = depthHost;
    this.build();
  }

  setDocument(doc: CampusDocument): void {
    this.doc = doc;
    this.build();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    for (const s of this.shuttles) s.view.visible = v;
    for (const d of this.drones) d.view.visible = v;
  }

  private build(): void {
    for (const g of this.bridgeParts) g.destroy();
    this.bridgeParts = [];
    for (const s of this.shuttles) s.view.destroy({ children: true });
    for (const d of this.drones) d.view.destroy({ children: true });
    this.shuttles = [];
    this.drones = [];

    this.drawBridges();

    /* Shuttle routes from the longest walkways ----------------------- */
    const routes: Route[] = [];
    for (const rect of this.doc.paths) {
      const along = Math.max(rect.w, rect.h);
      if (along < 9) continue;
      const horizontal = rect.w >= rect.h;
      const a = horizontal
        ? { x: rect.x + 0.5, y: rect.y + rect.h / 2 }
        : { x: rect.x + rect.w / 2, y: rect.y + 0.5 };
      const b = horizontal
        ? { x: rect.x + rect.w - 0.5, y: rect.y + rect.h / 2 }
        : { x: rect.x + rect.w / 2, y: rect.y + rect.h - 0.5 };
      routes.push({ a, b, length: Math.hypot(b.x - a.x, b.y - a.y) });
    }
    routes.sort((p, q) => q.length - p.length);

    for (const route of routes.slice(0, 4)) {
      const view = makeShuttle();
      const glow = new Sprite(glowTexture(128));
      glow.anchor.set(0.5);
      glow.width = 54;
      glow.height = 26;
      glow.blendMode = 'add';
      glow.alpha = 0.24;
      glow.tint = palette.blueGlow;
      view.addChildAt(glow, 0);
      view.visible = this.enabled;
      this.depthHost.addChild(view);
      this.shuttles.push({
        view,
        glow,
        route,
        t: Math.random(),
        dir: Math.random() > 0.5 ? 1 : -1,
        speed: 0.055 + Math.random() * 0.03,
        dwell: 0,
      });
    }

    /* Delivery drones ------------------------------------------------ */
    const targets = this.doc.buildings.filter((b) => !b.locked);
    const count = Math.min(4, Math.max(0, targets.length - 1));
    for (let i = 0; i < count; i++) {
      const view = makeDrone();
      const glow = new Sprite(glowTexture(64));
      glow.anchor.set(0.5);
      glow.width = 26;
      glow.height = 26;
      glow.blendMode = 'add';
      glow.alpha = 0.4;
      glow.tint = palette.cyanData;
      view.addChildAt(glow, 0);
      view.visible = this.enabled;
      this.depthHost.addChild(view);
      const [from, to] = pickPair(targets, i);
      this.drones.push({
        view,
        glow,
        from,
        to,
        t: Math.random(),
        speed: 0.055 + Math.random() * 0.045,
        height: 13 + Math.random() * 7,
      });
    }
  }

  private drawBridges(): void {
    const byId = new Map(this.doc.buildings.map((b) => [b.id, b]));
    for (const bridge of this.doc.bridges) {
      const from = byId.get(bridge.fromBuildingId);
      const to = byId.get(bridge.toBuildingId);
      if (!from || !to) continue;

      // One Graphics per bridge so each sorts at its own depth rather than all
      // bridges sharing a single z-band.
      const g = new Graphics();
      this.bridgeParts.push(g);
      this.depthHost.addChild(g);

      const a = centre(from);
      const b = centre(to);
      const h = Math.min(bridge.height, Math.min(from.height, to.height) - 1);
      if (h <= 0) continue;

      // Perpendicular offset gives the tube its width in plan.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = (-dy / len) * bridge.width;
      const py = (dx / len) * bridge.width;

      const deck = [
        gridToScreen(a.x + px, a.y + py, h),
        gridToScreen(b.x + px, b.y + py, h),
        gridToScreen(b.x - px, b.y - py, h),
        gridToScreen(a.x - px, a.y - py, h),
      ];
      const roof = [
        gridToScreen(a.x + px, a.y + py, h + 1.6),
        gridToScreen(b.x + px, b.y + py, h + 1.6),
        gridToScreen(b.x - px, b.y - py, h + 1.6),
        gridToScreen(a.x - px, a.y - py, h + 1.6),
      ];

      // Glass side wall facing the camera.
      g.poly([
        deck[2].sx, deck[2].sy,
        deck[3].sx, deck[3].sy,
        roof[3].sx, roof[3].sy,
        roof[2].sx, roof[2].sy,
      ])
        .fill({ color: palette.obsidianGlass, alpha: 0.88 })
        .stroke({ color: palette.silver, width: 1, alpha: 0.55 });

      // Deck underside and silver soffit rib.
      g.poly(deck.flatMap((p) => [p.sx, p.sy])).fill({ color: palette.graphite, alpha: 0.95 });
      g.poly(roof.flatMap((p) => [p.sx, p.sy])).fill({ color: palette.graphiteHigh, alpha: 0.9 });

      // Interior light line running the length of the tube.
      const m0 = gridToScreen(a.x, a.y, h + 0.9);
      const m1 = gridToScreen(b.x, b.y, h + 0.9);
      g.moveTo(m0.sx, m0.sy)
        .lineTo(m1.sx, m1.sy)
        .stroke({ color: palette.lightWhite, width: 1.4, alpha: 0.32 });

      // Depth: the bridge's midpoint on the ground plane, lifted by its height
      // so it draws in front of anything it genuinely passes over.
      g.zIndex = ((a.x + a.y + b.x + b.y) / 2) * 1000 + h * 2;
    }
  }

  update(dtMs: number, animate: boolean): void {
    if (!this.enabled || !animate) return;
    const dt = Math.min(dtMs, 120) / 1000;

    for (const s of this.shuttles) {
      if (s.dwell > 0) {
        s.dwell -= dt;
        continue;
      }
      s.t += s.speed * dt * s.dir;
      if (s.t >= 1) {
        s.t = 1;
        s.dir = -1;
        s.dwell = 2.4;
      } else if (s.t <= 0) {
        s.t = 0;
        s.dir = 1;
        s.dwell = 2.4;
      }
      const gx = s.route.a.x + (s.route.b.x - s.route.a.x) * s.t;
      const gy = s.route.a.y + (s.route.b.y - s.route.a.y) * s.t;
      const p = gridToScreen(gx, gy, 0.55);
      s.view.position.set(p.sx, p.sy);
      s.view.zIndex = (gx + gy) * 1000 + 300;
      // Vehicles face their direction of travel.
      const goingRight = (s.route.b.x - s.route.a.x) * s.dir - (s.route.b.y - s.route.a.y) * s.dir >= 0;
      s.view.scale.x = goingRight ? 1 : -1;
    }

    for (const d of this.drones) {
      d.t += d.speed * dt;
      if (d.t >= 1) {
        d.t = 0;
        const targets = this.doc.buildings.filter((b) => !b.locked);
        const [from, to] = pickPair(targets, Math.floor(Math.random() * 97));
        d.from = from;
        d.to = to;
        d.height = 13 + Math.random() * 7;
      }
      const gx = d.from.x + (d.to.x - d.from.x) * d.t;
      const gy = d.from.y + (d.to.y - d.from.y) * d.t;
      const lift = d.height * Math.sin(d.t * Math.PI) + 6;
      const p = gridToScreen(gx, gy, lift);
      d.view.position.set(p.sx, p.sy + Math.sin(performance.now() / 260 + d.height) * 1.2);
      d.view.zIndex = 800_000 + (gx + gy) * 10;
      d.glow.alpha = 0.25 + 0.2 * Math.sin(performance.now() / 300 + d.height);
    }
  }

  destroy(): void {
    for (const g of this.bridgeParts) g.destroy();
    for (const s of this.shuttles) s.view.destroy({ children: true });
    for (const d of this.drones) d.view.destroy({ children: true });
    this.bridgeParts = [];
    this.shuttles = [];
    this.drones = [];
  }
}

function centre(b: BuildingConfig): GridPoint {
  return { x: b.footprint.x + b.footprint.w / 2, y: b.footprint.y + b.footprint.h / 2 };
}

function pickPair(buildings: BuildingConfig[], salt: number): [GridPoint, GridPoint] {
  if (buildings.length < 2) {
    const p = { x: 48, y: 48 };
    return [p, p];
  }
  const i = salt % buildings.length;
  let j = (salt * 7 + 3) % buildings.length;
  if (j === i) j = (j + 1) % buildings.length;
  return [centre(buildings[i]), centre(buildings[j])];
}

/** A low autonomous pod: graphite shell, silver waistline, blue underglow. */
function makeShuttle(): Container {
  const c = new Container();
  const g = new Graphics();
  g.roundRect(-13, -7, 26, 9, 3.5).fill({ color: palette.graphiteHigh });
  g.roundRect(-13, -7, 26, 4.5, 3).fill({ color: palette.obsidianGlass, alpha: 0.95 });
  g.roundRect(-13, -3.2, 26, 1.1, 0.5).fill({ color: palette.silver, alpha: 0.8 });
  g.roundRect(-10, 2, 20, 1.6, 0.8).fill({ color: palette.blueGlow, alpha: 0.55 });
  g.moveTo(9, -6).lineTo(12, -3).stroke({ color: palette.lightWhite, width: 1, alpha: 0.7 });
  c.addChild(g);
  return c;
}

/** A small delivery drone carrying a lit parcel. */
function makeDrone(): Container {
  const c = new Container();
  const g = new Graphics();
  g.roundRect(-3.5, -2, 7, 4, 1.4).fill({ color: palette.graphiteHigh });
  g.moveTo(-6, -2).lineTo(6, -2).stroke({ color: palette.silverDim, width: 1 });
  g.circle(-6, -2, 1.4).fill({ color: palette.silver, alpha: 0.8 });
  g.circle(6, -2, 1.4).fill({ color: palette.silver, alpha: 0.8 });
  g.rect(-1.8, 2, 3.6, 3).fill({ color: palette.cyanData, alpha: 0.75 });
  c.addChild(g);
  return c;
}
