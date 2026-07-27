/**
 * Agent view.
 *
 * The readability contract lives here. At every zoom level the owner must be
 * able to answer "who is that and what are they doing" without clicking, so:
 *
 *   - the figure has a minimum on-screen size and never shrinks past it
 *   - the name plate and status tag are counter-scaled to a constant pixel size
 *   - state is carried by colour *and* by indicator shape
 *   - a progress bar appears whenever the agent holds a task
 *
 * Labels are drawn in a dedicated overlay layer above every building so a
 * agent working on floor 8 is never hidden behind the facade in front of it.
 */

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { gridToScreen } from '@/core/iso';
import { palette, typography } from '@/design/tokens';
import type { AgentConfig, AgentRuntime, CampusSettings } from '@/core/types';
import { AGENT_VISUALS, suitFor, type IndicatorShape } from '../stateVisuals';
import { agentFrames, FIGURE_SCREEN_HEIGHT, WALK_FRAMES } from './agentTextures';
import { contactShadowTexture, glowTexture } from './textures';

/** Minimum on-screen figure height in CSS pixels. */
const MIN_FIGURE_PX = 12;
const MAX_UPSCALE = 2.1;

export type Lod = 'full' | 'reduced' | 'coarse';

export class AgentView {
  readonly id: string;

  /** World-space container: figure, shadow, glow. */
  readonly body = new Container();
  /** Overlay container: label plate, indicator, progress. Drawn above all. */
  readonly overlay = new Container();

  private cfg: AgentConfig;
  private sprite: Sprite;
  private shadow: Sprite;
  private aura: Sprite;
  /** Pool of interior light behind an agent working inside a building. */
  private interior: Sprite;

  private plate = new Graphics();
  private nameText: Text;
  private tagText: Text;
  private indicator = new Graphics();
  private progress = new Graphics();
  private trailText: Text;

  private frames: ReturnType<typeof agentFrames>;
  private frameIndex = 0;
  private frameClock = 0;
  private lastState = '';
  private lastTag = '';
  private lastProgress = -1;
  private selected = false;
  private hovered = false;

  /** Latest world-screen position, exposed for camera follow and hit testing. */
  screen = { sx: 0, sy: 0 };
  private walking = false;

  constructor(cfg: AgentConfig) {
    this.id = cfg.id;
    this.cfg = cfg;

    const suit = suitFor(cfg.presentation, cfg.suitVariant);
    const build = cfg.presentation === 'suit_black' ? 'a' : 'b';
    this.frames = agentFrames(suit, build, hashString(cfg.id) % 5);

    this.shadow = new Sprite(contactShadowTexture(64));
    this.shadow.anchor.set(0.5, 0.5);
    this.shadow.width = 20;
    this.shadow.height = 10;
    this.shadow.alpha = 0.5;

    this.aura = new Sprite(glowTexture(128));
    this.aura.anchor.set(0.5, 0.5);
    this.aura.width = 46;
    this.aura.height = 46;
    this.aura.blendMode = 'add';
    this.aura.alpha = 0;

    this.interior = new Sprite(glowTexture(128));
    this.interior.anchor.set(0.5, 0.5);
    this.interior.width = 40;
    this.interior.height = 30;
    this.interior.y = -12;
    this.interior.blendMode = 'add';
    this.interior.alpha = 0;
    this.interior.visible = false;

    this.sprite = new Sprite(this.frames[0]);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.height = FIGURE_SCREEN_HEIGHT;
    this.sprite.width = (FIGURE_SCREEN_HEIGHT * this.frames[0].width) / this.frames[0].height;

    this.body.addChild(this.shadow, this.interior, this.aura, this.sprite);

    const nameStyle = new TextStyle({
      fontFamily: typography.ui,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.4,
      fill: palette.chrome,
    });
    const tagStyle = new TextStyle({
      fontFamily: typography.ui,
      fontSize: 9,
      fontWeight: '500',
      letterSpacing: 0.5,
      fill: palette.silver,
    });

    this.nameText = new Text({ text: cfg.name, style: nameStyle, resolution: 2 });
    this.tagText = new Text({ text: '', style: tagStyle, resolution: 2 });
    this.trailText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: typography.mono,
        fontSize: 8,
        fill: palette.silverDim,
        lineHeight: 10,
      }),
      resolution: 2,
    });
    this.trailText.visible = false;

    this.nameText.anchor.set(0.5, 1);
    this.tagText.anchor.set(0.5, 0);
    this.trailText.anchor.set(0.5, 0);

    this.overlay.addChild(this.plate, this.nameText, this.tagText, this.indicator, this.progress, this.trailText);
  }

  setConfig(cfg: AgentConfig): void {
    const changedSuit =
      cfg.presentation !== this.cfg.presentation || cfg.suitVariant !== this.cfg.suitVariant;
    this.cfg = cfg;
    if (changedSuit) {
      const suit = suitFor(cfg.presentation, cfg.suitVariant);
      const build = cfg.presentation === 'suit_black' ? 'a' : 'b';
      this.frames = agentFrames(suit, build, hashString(cfg.id) % 5);
      this.sprite.texture = this.frames[this.frameIndex];
    }
    if (this.nameText.text !== cfg.name) {
      this.nameText.text = cfg.name;
      this.lastTag = '';
    }
  }

  setSelected(v: boolean): void {
    this.selected = v;
  }

  setHovered(v: boolean): void {
    this.hovered = v;
  }

  get config(): AgentConfig {
    return this.cfg;
  }

  /* ---------------------------------------------------------------- */

  update(
    rt: AgentRuntime,
    dtMs: number,
    timeMs: number,
    zoom: number,
    lod: Lod,
    settings: CampusSettings,
    taskColorValue: number | null,
    hostDepth: number | null,
  ): void {
    const vis = AGENT_VISUALS[rt.state];

    /* Position ------------------------------------------------------ */
    const p = gridToScreen(rt.pos.x, rt.pos.y, rt.elevation);
    this.screen = { sx: p.sx, sy: p.sy };
    this.body.position.set(p.sx, p.sy);
    this.overlay.position.set(p.sx, p.sy);

    // Depth: ground position decides ordering, elevation only breaks ties.
    // An agent inside a building must sort *just* above that building —
    // otherwise the facade in front of them swallows the figure entirely and
    // the whole "visible activity through the windows" idea collapses.
    this.body.zIndex =
      rt.indoors && hostDepth !== null
        ? hostDepth + 1 + rt.elevation
        : (rt.pos.x + rt.pos.y) * 1000 + rt.elevation + 500;

    /* Figure scale — never smaller than MIN_FIGURE_PX on screen ------ */
    const wanted = MIN_FIGURE_PX / (FIGURE_SCREEN_HEIGHT * Math.max(zoom, 0.01));
    const boost = Math.min(MAX_UPSCALE, Math.max(1, wanted));
    this.body.scale.set(boost);

    /* Walk cycle ---------------------------------------------------- */
    this.walking = rt.path.length > 0;
    if (this.walking && !settings.reducedMotion) {
      this.frameClock += dtMs * (rt.transport === 'walk' || rt.transport === null ? 1 : 1.6);
      const period = 150;
      if (this.frameClock >= period) {
        this.frameClock %= period;
        this.frameIndex = (this.frameIndex + 1) % WALK_FRAMES;
        this.sprite.texture = this.frames[this.frameIndex];
      }
    } else if (this.frameIndex !== 0) {
      this.frameIndex = 0;
      this.sprite.texture = this.frames[0];
    }

    // Face the direction of travel by mirroring the figure.
    if (this.walking) {
      const facingRight = Math.cos(rt.heading) - Math.sin(rt.heading) >= 0;
      this.sprite.scale.x = Math.abs(this.sprite.scale.x) * (facingRight ? 1 : -1);
    }

    // Idle breath — a fraction of a pixel, only enough to stop the figure
    // looking frozen.
    if (!settings.reducedMotion && vis.motion > 0 && !this.walking) {
      const bob = Math.sin(timeMs / 900 + hashString(this.id) % 100) * 0.5 * vis.motion;
      this.sprite.y = bob;
    } else {
      this.sprite.y = 0;
    }

    /* Elevation cues ------------------------------------------------ */
    // Seen through glass: knocked back and cooled, with a warm pool of
    // interior light behind them. Drawn at full opacity an indoor figure looks
    // like it is standing on the roof; this is what sells "inside".
    this.sprite.alpha = rt.indoors ? 0.62 : 1;
    this.sprite.tint = rt.indoors ? 0xaec4d8 : 0xffffff;
    this.shadow.visible = !rt.indoors && rt.elevation < 0.5 && lod !== 'coarse';

    if (rt.indoors) {
      this.interior.visible = true;
      this.interior.tint = vis.color;
      this.interior.alpha = 0.1 + (rt.state === 'working' || rt.state === 'using_tool' ? 0.12 : 0);
    } else {
      this.interior.visible = false;
    }

    // Transport: a soft platform glow under agents riding a shuttle or tram.
    if (rt.transport === 'shuttle' || rt.transport === 'tram') {
      this.aura.alpha = 0.3;
      this.aura.tint = palette.blueGlow;
      this.aura.y = -2;
      this.aura.height = 16;
      this.aura.width = 40;
    } else if (this.selected) {
      this.aura.alpha = 0.34;
      this.aura.tint = palette.lightWhite;
      this.aura.y = -3;
      this.aura.height = 20;
      this.aura.width = 48;
    } else {
      this.aura.alpha += (0 - this.aura.alpha) * 0.15;
    }

    /* Labels + indicator -------------------------------------------- */
    const inv = 1 / Math.max(zoom, 0.01);
    this.overlay.scale.set(inv);

    const figureTopPx = FIGURE_SCREEN_HEIGHT * boost * zoom;
    const anchorY = -(figureTopPx / Math.max(zoom, 0.01)) * zoom * inv;

    const showLabels = settings.showAgentLabels && lod !== 'coarse';
    const showTag = settings.showStatusTags && lod === 'full';
    const compact = lod === 'reduced';

    this.indicator.y = anchorY - 8;
    this.nameText.y = anchorY - 16;
    this.tagText.y = anchorY - 14;
    this.progress.y = anchorY - 4;
    this.trailText.y = anchorY - 46;

    // Indicator: always drawn — this is the one element that must survive
    // every zoom level, so it is never gated on LOD.
    const pulse =
      vis.pulse === 0
        ? 1
        : 0.62 + 0.38 * Math.sin((timeMs / (vis.pulse === 2 ? 520 : 1500)) * Math.PI * 2);
    if (this.lastState !== rt.state) {
      this.lastState = rt.state;
      drawIndicator(this.indicator, vis.shape, vis.color);
    }
    this.indicator.alpha = settings.reducedMotion ? 1 : pulse;
    this.indicator.scale.set(this.selected || this.hovered ? 1.35 : 1);

    // Name plate.
    this.nameText.visible = showLabels || this.selected || this.hovered;
    this.tagText.visible = (showTag || this.selected || this.hovered) && !compact;
    this.plate.visible = this.nameText.visible;

    const tag = taskColorValue !== null && rt.tool ? `${vis.label} · ${rt.tool}` : vis.label;
    if (this.lastTag !== tag) {
      this.lastTag = tag;
      this.tagText.text = tag;
      this.tagText.style.fill = vis.color;
    }

    if (this.plate.visible) {
      const w = Math.max(this.nameText.width, this.tagText.visible ? this.tagText.width : 0) + 12;
      const h = this.tagText.visible ? 26 : 14;
      this.plate.clear();
      this.plate
        .roundRect(-w / 2, anchorY - 27, w, h, 3)
        .fill({ color: 0x05070b, alpha: this.selected ? 0.9 : 0.66 })
        .stroke({
          color: this.selected ? palette.silverBright : palette.silverDim,
          width: 1,
          alpha: this.selected ? 0.85 : 0.35,
        });
      this.nameText.y = anchorY - 16;
      this.tagText.y = anchorY - 15;
    }

    // Progress bar — only when the agent actually holds work.
    const showProgress = rt.taskId !== null && rt.progress > 0 && lod !== 'coarse';
    this.progress.visible = showProgress;
    if (showProgress && Math.abs(this.lastProgress - rt.progress) > 0.01) {
      this.lastProgress = rt.progress;
      const w = 22;
      this.progress.clear();
      this.progress
        .roundRect(-w / 2, 0, w, 3, 1.5)
        .fill({ color: 0x05070b, alpha: 0.8 })
        .stroke({ color: palette.silverDim, width: 0.6, alpha: 0.5 });
      this.progress
        .roundRect(-w / 2 + 0.6, 0.6, (w - 1.2) * rt.progress, 1.8, 1)
        .fill({ color: taskColorValue ?? palette.lightWhite, alpha: 0.95 });
    }

    // Activity trail: the last three actions, opt-in and close-zoom only.
    const showTrail = settings.showActivityTrails && lod === 'full' && rt.trail.length > 0;
    this.trailText.visible = showTrail;
    if (showTrail) {
      const text = rt.trail.map((t) => `· ${t.label}`).join('\n');
      if (this.trailText.text !== text) this.trailText.text = text;
    }
  }

  destroy(): void {
    this.body.destroy({ children: true });
    this.overlay.destroy({ children: true });
  }
}

/** Distinct silhouette per state, so colour is never the only signal. */
function drawIndicator(g: Graphics, shape: IndicatorShape, color: number): void {
  g.clear();
  const r = 3.2;
  switch (shape) {
    case 'dot':
      g.circle(0, 0, r * 0.75).fill({ color });
      break;
    case 'ring':
      g.circle(0, 0, r).stroke({ color, width: 1.6 });
      break;
    case 'bar':
      g.roundRect(-r * 1.4, -1.1, r * 2.8, 2.2, 1).fill({ color });
      break;
    case 'chevron':
      g.moveTo(-r, r * 0.6)
        .lineTo(0, -r * 0.7)
        .lineTo(r, r * 0.6)
        .stroke({ color, width: 1.7 });
      break;
    case 'square':
      g.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6).fill({ color });
      break;
    case 'diamond':
      g.moveTo(0, -r * 1.2)
        .lineTo(r, 0)
        .lineTo(0, r * 1.2)
        .lineTo(-r, 0)
        .closePath()
        .fill({ color });
      break;
    case 'cross':
      g.moveTo(-r, -r).lineTo(r, r).moveTo(r, -r).lineTo(-r, r).stroke({ color, width: 1.9 });
      break;
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
