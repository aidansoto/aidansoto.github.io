/**
 * Task visualisation.
 *
 * Work in transit is drawn as a small luminous data packet that arcs between
 * buildings. Risk changes the container, not the amount of effect:
 *
 *   standard → an open glass shard
 *   elevated → a ribbed capsule
 *   secure   → a sealed silver container with a locked seam
 *
 * The intent is legibility, not spectacle. If you can't tell where a task came
 * from and where it is going, the effect has failed.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { gridToScreen } from '@/core/iso';
import { palette } from '@/design/tokens';
import type { TaskRuntime } from '@/core/types';
import { taskColor } from '../stateVisuals';
import { glowTexture } from '../factory/textures';

interface PacketView {
  container: Container;
  shape: Graphics;
  glow: Sprite;
  trail: Graphics;
  history: Array<{ x: number; y: number }>;
  risk: TaskRuntime['risk'];
  color: number;
}

export class TaskLayer {
  readonly container = new Container();
  private views = new Map<string, PacketView>();
  private visible = true;

  constructor() {
    this.container.sortableChildren = true;
    this.container.zIndex = 900_000;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.container.visible = v;
  }

  private create(task: TaskRuntime): PacketView {
    const container = new Container();
    const color = taskColor(task.hue, task.risk);

    const trail = new Graphics();
    const shape = new Graphics();
    drawPacket(shape, task.risk, color);

    const glow = new Sprite(glowTexture(128));
    glow.anchor.set(0.5);
    glow.width = 44;
    glow.height = 44;
    glow.blendMode = 'add';
    glow.alpha = 0.5;
    glow.tint = color;

    container.addChild(glow, shape);
    this.container.addChild(trail, container);

    const view: PacketView = { container, shape, glow, trail, history: [], risk: task.risk, color };
    this.views.set(task.id, view);
    return view;
  }

  update(tasks: TaskRuntime[], timeMs: number, animate: boolean): void {
    if (!this.visible) return;

    const live = new Set<string>();

    for (const task of tasks) {
      if (!task.packet) continue;
      live.add(task.id);
      const view = this.views.get(task.id) ?? this.create(task);

      const t = task.packet.t;
      const from = task.packet.from;
      const to = task.packet.to;
      const gx = from.x + (to.x - from.x) * t;
      const gy = from.y + (to.y - from.y) * t;

      // Arc: packets rise as they cross the campus, so their route reads
      // clearly over rooftops instead of disappearing behind them.
      const lift = 3.2 + Math.sin(t * Math.PI) * 7.5;
      const p = gridToScreen(gx, gy, lift);

      view.container.position.set(p.sx, p.sy);
      view.container.zIndex = 900_000 + (gx + gy) * 10;
      view.shape.rotation = animate ? timeMs / 700 : 0;

      const bob = animate ? Math.sin(timeMs / 320) * 1.4 : 0;
      view.shape.y = bob;
      view.glow.y = bob;
      view.glow.alpha = 0.35 + (animate ? 0.2 * (0.5 + 0.5 * Math.sin(timeMs / 420)) : 0.15);

      // Light trail: a short decaying ribbon behind the packet.
      view.history.push({ x: p.sx, y: p.sy + bob });
      if (view.history.length > 14) view.history.shift();
      view.trail.clear();
      if (animate && view.history.length > 2) {
        for (let i = 1; i < view.history.length; i++) {
          const a = view.history[i - 1];
          const b = view.history[i];
          const k = i / view.history.length;
          view.trail
            .moveTo(a.x, a.y)
            .lineTo(b.x, b.y)
            .stroke({ color: view.color, width: 1 + k * 1.6, alpha: k * 0.32 });
        }
      }
      view.trail.zIndex = 899_999;
    }

    for (const [id, view] of [...this.views.entries()]) {
      if (live.has(id)) continue;
      view.container.destroy({ children: true });
      view.trail.destroy();
      this.views.delete(id);
    }
  }

  clear(): void {
    for (const view of this.views.values()) {
      view.container.destroy({ children: true });
      view.trail.destroy();
    }
    this.views.clear();
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}

function drawPacket(g: Graphics, risk: TaskRuntime['risk'], color: number): void {
  g.clear();
  if (risk === 'secure') {
    // Sealed container: a silver box with a locked seam.
    g.rect(-5, -5, 10, 10).fill({ color: 0x0a0e13 }).stroke({ color: palette.silver, width: 1.2 });
    g.moveTo(-5, 0).lineTo(5, 0).stroke({ color: palette.gold, width: 1.2, alpha: 0.9 });
    g.circle(0, 0, 1.6).fill({ color: palette.goldBright });
    return;
  }
  if (risk === 'elevated') {
    // Ribbed capsule.
    g.roundRect(-6, -3.4, 12, 6.8, 3.4)
      .fill({ color: 0x0a0e13, alpha: 0.9 })
      .stroke({ color, width: 1.2 });
    for (const x of [-2.4, 0, 2.4]) {
      g.moveTo(x, -3).lineTo(x, 3).stroke({ color, width: 0.9, alpha: 0.7 });
    }
    return;
  }
  // Standard: an open glass shard.
  g.moveTo(0, -6).lineTo(5, 0).lineTo(0, 6).lineTo(-5, 0).closePath().fill({ color, alpha: 0.5 });
  g.moveTo(0, -6)
    .lineTo(5, 0)
    .lineTo(0, 6)
    .lineTo(-5, 0)
    .closePath()
    .stroke({ color: palette.chrome, width: 1, alpha: 0.7 });
}
