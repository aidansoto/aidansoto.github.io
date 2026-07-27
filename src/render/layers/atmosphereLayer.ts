/**
 * Sky, stars, weather and the overall grade.
 *
 * This layer lives in screen space rather than world space: particle fields
 * that follow the viewport cost a fraction of what world-space weather costs,
 * and at isometric scale the difference is invisible. A small parallax offset
 * driven by the camera keeps it from feeling pasted on.
 *
 * Every effect here is subordinate to readability. Rain never obscures an
 * agent label; fog never touches the plaza.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { palette } from '@/design/tokens';
import type { CampusTheme, WeatherKind } from '@/core/types';
import { rainTexture, skyTexture, softDotTexture } from '../factory/textures';

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  drift: number;
  phase: number;
}

export class AtmosphereLayer {
  /** Behind the campus. */
  readonly backdrop = new Container();
  /** In front of the campus, behind the interface. */
  readonly foreground = new Container();

  private sky: Sprite;
  private stars = new Graphics();
  private haze: Sprite;
  private flash: Graphics;
  private particles: Particle[] = [];
  private particleHost = new Container();

  private weather: WeatherKind = 'clear';
  private theme: CampusTheme;
  private width = 1280;
  private height = 800;
  private lightningIn = 9 + Math.random() * 22;
  private flashLevel = 0;
  private enabled = true;
  private density = 1;

  constructor(theme: CampusTheme) {
    this.theme = theme;

    this.sky = new Sprite(skyTexture(theme.skyTop, theme.skyBottom));
    this.backdrop.addChild(this.sky, this.stars);

    this.haze = new Sprite(Texture.WHITE);
    this.haze.alpha = 0;
    this.haze.tint = 0x0a1119;

    this.flash = new Graphics();
    this.flash.alpha = 0;

    this.foreground.addChild(this.haze, this.particleHost, this.flash);
    this.foreground.eventMode = 'none';
    this.backdrop.eventMode = 'none';
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.sky.width = width;
    this.sky.height = height;
    this.haze.width = width;
    this.haze.height = height;
    this.flash.clear();
    this.flash.rect(0, 0, width, height).fill({ color: 0xdcecff });
    this.drawStars();
    this.rebuildParticles();
  }

  setTheme(theme: CampusTheme): void {
    this.theme = theme;
    this.sky.texture = skyTexture(theme.skyTop, theme.skyBottom);
    this.sky.width = this.width;
    this.sky.height = this.height;
    this.drawStars();
  }

  setWeather(weather: WeatherKind): void {
    if (this.weather === weather) return;
    this.weather = weather;
    this.rebuildParticles();
  }

  /** Performance mode scales particle counts without changing the look. */
  setDensity(density: number): void {
    if (this.density === density) return;
    this.density = density;
    this.rebuildParticles();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.particleHost.visible = v;
  }

  private drawStars(): void {
    this.stars.clear();
    // Stars belong to the night grade only.
    if (this.theme.ambientLight > 0.5) return;
    let seed = 1337;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const count = Math.round((this.width * this.height) / 9000);
    for (let i = 0; i < count; i++) {
      const x = rand() * this.width;
      const y = rand() * this.height * 0.55;
      const r = rand() * 0.9 + 0.25;
      this.stars.circle(x, y, r).fill({ color: palette.lightCool, alpha: rand() * 0.5 + 0.08 });
    }
  }

  private rebuildParticles(): void {
    for (const p of this.particles) p.sprite.destroy();
    this.particles = [];
    this.particleHost.removeChildren();

    const area = (this.width * this.height) / (1280 * 800);
    let count = 0;
    let texture: Texture = rainTexture();

    switch (this.weather) {
      case 'rain':
        count = Math.round(260 * area * this.density);
        texture = rainTexture();
        break;
      case 'snow':
        count = Math.round(190 * area * this.density);
        texture = softDotTexture(16);
        break;
      case 'fog':
        count = Math.round(26 * area * this.density);
        texture = softDotTexture(64);
        break;
      case 'clear':
        count = 0;
        break;
    }

    for (let i = 0; i < count; i++) {
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      s.position.set(Math.random() * this.width, Math.random() * this.height);

      if (this.weather === 'rain') {
        s.alpha = 0.18 + Math.random() * 0.3;
        s.scale.set(0.8 + Math.random() * 0.8, 1.1 + Math.random() * 1.4);
        s.rotation = 0.16;
        s.tint = palette.lightCool;
        this.particles.push({ sprite: s, vx: 90, vy: 620 + Math.random() * 340, drift: 0, phase: 0 });
      } else if (this.weather === 'snow') {
        const size = 2 + Math.random() * 3.4;
        s.width = size;
        s.height = size;
        s.alpha = 0.25 + Math.random() * 0.45;
        s.tint = palette.chrome;
        this.particles.push({
          sprite: s,
          vx: 0,
          vy: 22 + Math.random() * 34,
          drift: 12 + Math.random() * 24,
          phase: Math.random() * Math.PI * 2,
        });
      } else {
        const size = 180 + Math.random() * 320;
        s.width = size;
        s.height = size * 0.5;
        s.alpha = 0.03 + Math.random() * 0.05;
        s.tint = 0x9fb4c8;
        this.particles.push({
          sprite: s,
          vx: 6 + Math.random() * 10,
          vy: 0,
          drift: 5,
          phase: Math.random() * Math.PI * 2,
        });
      }
      this.particleHost.addChild(s);
    }

    // A gentle atmospheric haze accompanies fog and rain, never clear skies.
    this.haze.alpha = this.weather === 'fog' ? 0.2 : this.weather === 'rain' ? 0.09 : 0;
  }

  /**
   * `cameraX/Y` provide the parallax offset. `reducedMotion` freezes the
   * particle field and disables lightning entirely.
   */
  update(dtMs: number, cameraX: number, cameraY: number, zoom: number, reducedMotion: boolean): void {
    const parallax = 0.06;
    this.backdrop.position.set(-cameraX * zoom * parallax, -cameraY * zoom * parallax * 0.5);

    if (!this.enabled || reducedMotion) {
      this.flash.alpha = 0;
      return;
    }

    const dt = Math.min(dtMs, 100) / 1000;
    const t = performance.now() / 1000;

    for (const p of this.particles) {
      const s = p.sprite;
      if (this.weather === 'snow') {
        s.x += Math.sin(t * 0.7 + p.phase) * p.drift * dt;
        s.y += p.vy * dt;
      } else if (this.weather === 'fog') {
        s.x += p.vx * dt;
        s.y += Math.sin(t * 0.2 + p.phase) * p.drift * dt;
      } else {
        s.x += p.vx * dt;
        s.y += p.vy * dt;
      }

      if (s.y > this.height + 40) {
        s.y = -40;
        s.x = Math.random() * this.width;
      }
      if (s.x > this.width + 200) s.x = -200;
      if (s.x < -220) s.x = this.width + 180;
    }

    // Distant lightning — rare, low amplitude, rain only.
    if (this.weather === 'rain') {
      this.lightningIn -= dt;
      if (this.lightningIn <= 0) {
        this.lightningIn = 14 + Math.random() * 34;
        this.flashLevel = 0.14 + Math.random() * 0.12;
      }
    }
    if (this.flashLevel > 0) {
      this.flashLevel = Math.max(0, this.flashLevel - dt * 0.9);
    }
    this.flash.alpha = this.flashLevel;
  }

  destroy(): void {
    this.backdrop.destroy({ children: true });
    this.foreground.destroy({ children: true });
  }
}
