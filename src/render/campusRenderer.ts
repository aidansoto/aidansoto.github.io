/**
 * Campus renderer.
 *
 * Owns the PixiJS application, the scene graph and all input. It reads the
 * campus document (what exists) and the simulation snapshot (what is happening)
 * and draws them. It never writes back — no decision about agent behaviour is
 * ever made here.
 *
 * Scene graph:
 *
 *   stage
 *   ├── atmosphere.backdrop      screen space — sky, stars
 *   ├── world                    camera transform applied here
 *   │   ├── scene                depth-sorted: ground, props, buildings,
 *   │   │                        bridges, vehicles, agents, monument, tasks
 *   │   └── labels               agent name plates, always on top
 *   └── atmosphere.foreground    screen space — weather, haze, lightning
 */

import { Application, Container } from 'pixi.js';
import type {
  AgentRuntime,
  CampusDocument,
  CampusSettings,
  CampusTheme,
  GridPoint,
} from '@/core/types';
import type { CampusSimulation, SimSnapshot } from '@/sim/simulation';
import { screenToGrid, rectContains, clamp } from '@/core/iso';
import { zoomLimits } from '@/design/tokens';
import { resolveTheme } from '@/config/themes';
import { taskColor } from './stateVisuals';
import { Camera } from './camera';
import { BuildingView } from './factory/buildingView';
import { AgentView, type Lod } from './factory/agentView';
import { GroundLayer } from './layers/groundLayer';
import { PropsLayer } from './layers/propsLayer';
import { AmbientLayer } from './layers/ambientLayer';
import { TaskLayer } from './layers/taskLayer';
import { Monument, type MonumentMood } from './layers/monument';
import { AtmosphereLayer } from './layers/atmosphereLayer';

export interface RendererCallbacks {
  onSelectAgent?: (agentId: string | null) => void;
  onSelectBuilding?: (buildingId: string | null) => void;
  onHoverAgent?: (agentId: string | null) => void;
  onStats?: (stats: { fps: number; buildingsDrawn: number; agentsDrawn: number }) => void;
}

export interface RendererOptions extends RendererCallbacks {
  host: HTMLElement;
  doc: CampusDocument;
  sim: CampusSimulation;
}

const WIND_BY_WEATHER = { clear: 0.6, rain: 1.5, fog: 0.25, snow: 0.5 } as const;

export class CampusRenderer {
  readonly camera = new Camera();

  private app = new Application();
  private world = new Container();
  private scene = new Container();
  private labels = new Container();

  private ground!: GroundLayer;
  private props!: PropsLayer;
  private ambient!: AmbientLayer;
  private tasks!: TaskLayer;
  private monument: Monument | null = null;
  private atmosphere!: AtmosphereLayer;

  private buildings = new Map<string, BuildingView>();
  private agents = new Map<string, AgentView>();

  private doc: CampusDocument;
  private sim: CampusSimulation;
  private theme!: CampusTheme;
  private callbacks: RendererCallbacks;
  private host: HTMLElement;

  private selectedAgentId: string | null = null;
  private selectedBuildingId: string | null = null;
  private hoveredAgentId: string | null = null;

  private dragging = false;
  private dragMoved = 0;
  private lastPointer = { x: 0, y: 0 };
  private pressedKeys = new Set<string>();

  private statsClock = 0;
  private frameCount = 0;
  private lastLod: Lod = 'full';
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private detachFns: Array<() => void> = [];

  constructor(opts: RendererOptions) {
    this.host = opts.host;
    this.doc = opts.doc;
    this.sim = opts.sim;
    this.callbacks = opts;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  async init(): Promise<void> {
    const settings = this.doc.settings;
    this.theme = resolveTheme(this.doc.themeId, settings.timeOfDay);

    await this.app.init({
      background: this.theme.skyBottom,
      antialias: settings.performanceMode !== 'efficient',
      resolution: this.resolutionFor(settings),
      autoDensity: true,
      powerPreference: 'high-performance',
      resizeTo: this.host,
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }

    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    this.host.appendChild(this.app.canvas);

    this.scene.sortableChildren = true;
    this.world.addChild(this.scene, this.labels);

    this.atmosphere = new AtmosphereLayer(this.theme);
    this.app.stage.addChild(this.atmosphere.backdrop, this.world, this.atmosphere.foreground);

    this.buildScene();

    this.camera.setGrid(this.doc.gridSize.w, this.doc.gridSize.h);
    const plaza = this.plazaCentre();
    this.camera.setHome(plaza.x, plaza.y, zoomLimits.default);
    this.camera.jumpToGrid(plaza.x, plaza.y, zoomLimits.default);
    this.camera.setReducedMotion(settings.reducedMotion);

    this.attachInput();
    this.syncViewport();

    this.app.ticker.maxFPS = settings.performanceMode === 'efficient' ? 30 : 0;
    this.app.ticker.add((ticker) => this.frame(ticker.deltaMS));
  }

  private resolutionFor(settings: CampusSettings): number {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    switch (settings.performanceMode) {
      case 'efficient':
        return 1;
      case 'balanced':
        return Math.min(dpr, 1.5);
      default:
        return Math.min(dpr, 2);
    }
  }

  private buildScene(): void {
    this.ground = new GroundLayer(this.doc, this.theme);
    this.props = new PropsLayer(this.doc, this.theme, this.scene);
    this.ambient = new AmbientLayer(this.doc, this.scene);
    this.tasks = new TaskLayer();

    this.ground.container.zIndex = -1_000_000;
    this.props.container.zIndex = -900_000;

    this.scene.addChild(this.ground.container, this.props.container, this.tasks.container);

    for (const cfg of this.doc.buildings) {
      const view = new BuildingView(cfg, this.theme);
      this.buildings.set(cfg.id, view);
      this.scene.addChild(view.container);
    }

    const monumentProp = this.doc.props.find((p) => p.kind === 'monument');
    if (monumentProp) {
      this.monument = new Monument(monumentProp.at.x + 0.5, monumentProp.at.y + 0.5);
      this.scene.addChild(this.monument.container);
    }

    for (const cfg of this.doc.agents) {
      const view = new AgentView(cfg);
      this.agents.set(cfg.id, view);
      this.scene.addChild(view.body);
      this.labels.addChild(view.overlay);
    }

    this.ambient.setEnabled(this.doc.settings.ambientActivity);
    this.tasks.setVisible(this.doc.settings.showTaskPackets);
    this.atmosphere.setWeather(this.doc.settings.weather);
    this.atmosphere.setDensity(this.doc.settings.performanceMode === 'high' ? 1 : 0.5);
  }

  private teardownScene(): void {
    for (const view of this.buildings.values()) view.destroy();
    this.buildings.clear();
    for (const view of this.agents.values()) view.destroy();
    this.agents.clear();
    this.monument?.destroy();
    this.monument = null;
    this.ambient?.destroy();
    this.props?.destroy();
    this.tasks?.destroy();
    this.ground?.destroy();
    this.scene.removeChildren();
    this.labels.removeChildren();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.teardownScene();
    this.atmosphere?.destroy();
    // `destroy` on an Application that never finished init throws; guard it.
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* already gone */
    }
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */

  /** Apply a new campus document — rebuilds anything structural that changed. */
  setDocument(doc: CampusDocument, structural: boolean): void {
    this.doc = doc;
    const nextTheme = resolveTheme(doc.themeId, doc.settings.timeOfDay);
    const themeChanged = nextTheme.id !== this.theme.id;
    this.theme = nextTheme;

    if (structural || themeChanged) {
      this.teardownScene();
      this.buildScene();
      this.camera.setGrid(doc.gridSize.w, doc.gridSize.h);
      this.app.renderer.background.color = this.theme.skyBottom;
      this.atmosphere.setTheme(this.theme);
      this.syncViewport();
    } else {
      for (const cfg of doc.buildings) {
        const view = this.buildings.get(cfg.id);
        if (view) view.setConfig(cfg);
      }
      for (const cfg of doc.agents) {
        this.agents.get(cfg.id)?.setConfig(cfg);
      }
    }

    this.applySettings(doc.settings);
  }

  applySettings(settings: CampusSettings): void {
    this.camera.setReducedMotion(settings.reducedMotion);
    this.ambient.setEnabled(settings.ambientActivity);
    this.tasks.setVisible(settings.showTaskPackets);
    this.ground.setGridVisible(settings.showGrid);
    this.atmosphere.setWeather(settings.weather);
    this.atmosphere.setDensity(settings.performanceMode === 'high' ? 1 : 0.5);
    this.atmosphere.setEnabled(!settings.reducedMotion || settings.weather !== 'clear');
    this.app.ticker.maxFPS = settings.performanceMode === 'efficient' ? 30 : 0;
  }

  focusBuilding(buildingId: string): void {
    const view = this.buildings.get(buildingId);
    if (!view) return;
    this.selectedBuildingId = buildingId;
    const f = view.config.footprint;
    const span = Math.max(f.w, f.h);
    // Frame the building with its immediate surroundings, not just its facade.
    const zoom = clamp(15 / span, 0.45, 1.1);
    this.camera.flyTo(view.focus.sx, view.focus.sy, zoom);
  }

  focusAgent(agentId: string): void {
    const view = this.agents.get(agentId);
    if (!view) return;
    this.selectAgent(agentId);
    this.camera.follow(() => {
      const v = this.agents.get(agentId);
      return v ? { sx: v.screen.sx, sy: v.screen.sy - 12 } : null;
    }, 1.0);
  }

  /** Fly to a task's current carrier or its packet. */
  focusTask(taskId: string): void {
    const task = this.sim.tasks.get(taskId);
    if (!task) return;
    if (task.assignedAgentId) {
      this.focusAgent(task.assignedAgentId);
      return;
    }
    if (task.buildingId) this.focusBuilding(task.buildingId);
  }

  goHome(): void {
    this.selectedBuildingId = null;
    this.camera.stopFollow();
    this.camera.goHome();
  }

  fitCampus(): void {
    this.camera.stopFollow();
    this.camera.fitAll(this.doc.gridSize.w, this.doc.gridSize.h);
  }

  zoomBy(factor: number): void {
    this.camera.zoomStep(factor);
  }

  selectAgent(agentId: string | null): void {
    if (this.selectedAgentId === agentId) return;
    if (this.selectedAgentId) this.agents.get(this.selectedAgentId)?.setSelected(false);
    this.selectedAgentId = agentId;
    if (agentId) this.agents.get(agentId)?.setSelected(true);
    this.callbacks.onSelectAgent?.(agentId);
  }

  selectBuilding(buildingId: string | null): void {
    this.selectedBuildingId = buildingId;
    this.callbacks.onSelectBuilding?.(buildingId);
  }

  get canvas(): HTMLCanvasElement | null {
    return this.app.canvas ?? null;
  }

  /** Current selection, for callers that need to avoid redundant camera moves. */
  get selection(): { agentId: string | null; buildingId: string | null } {
    return { agentId: this.selectedAgentId, buildingId: this.selectedBuildingId };
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private attachInput(): void {
    const canvas = this.app.canvas;

    const onPointerDown = (e: PointerEvent): void => {
      this.dragging = true;
      this.dragMoved = 0;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      if (this.dragging) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.dragMoved += Math.abs(dx) + Math.abs(dy);
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.camera.panBy(dx, dy);
        canvas.style.cursor = 'grabbing';
      } else {
        const hit = this.hitTestAgent(e.clientX - rect.left, e.clientY - rect.top);
        if (hit !== this.hoveredAgentId) {
          if (this.hoveredAgentId) this.agents.get(this.hoveredAgentId)?.setHovered(false);
          this.hoveredAgentId = hit;
          if (hit) this.agents.get(hit)?.setHovered(true);
          this.callbacks.onHoverAgent?.(hit);
          canvas.style.cursor = hit ? 'pointer' : 'grab';
        }
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      const wasDragging = this.dragging;
      this.dragging = false;
      canvas.style.cursor = 'grab';
      canvas.releasePointerCapture?.(e.pointerId);
      // A click is a press that barely moved. 6px of slop covers trackpads.
      if (!wasDragging || this.dragMoved > 6) return;

      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const agentId = this.hitTestAgent(px, py);
      if (agentId) {
        this.selectAgent(agentId);
        return;
      }
      const buildingId = this.hitTestBuilding(px, py);
      this.selectAgent(null);
      this.selectBuilding(buildingId);
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // Trackpad pinch arrives as ctrlKey + wheel; give it a finer step.
      const scale = e.ctrlKey ? 0.012 : 0.0022;
      const factor = Math.exp(-e.deltaY * scale);
      this.camera.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      this.pressedKeys.add(e.key.toLowerCase());
      if (e.key === '0') this.goHome();
      if (e.key.toLowerCase() === 'f') this.fitCampus();
      if (e.key === '+' || e.key === '=') this.camera.zoomStep(1.25);
      if (e.key === '-' || e.key === '_') this.camera.zoomStep(0.8);
      if (e.key === 'Escape') {
        this.selectAgent(null);
        this.selectBuilding(null);
        this.camera.stopFollow();
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      this.pressedKeys.delete(e.key.toLowerCase());
    };
    const onBlur = (): void => this.pressedKeys.clear();

    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    this.detachFns.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });

    this.resizeObserver = new ResizeObserver(() => this.syncViewport());
    this.resizeObserver.observe(this.host);
  }

  private syncViewport(): void {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.camera.viewport = { width, height };
    this.atmosphere.resize(width, height);
  }

  /** Nearest agent within a generous screen-space radius. */
  private hitTestAgent(px: number, py: number): string | null {
    const world = this.camera.screenToWorld(px, py);
    let best: string | null = null;
    let bestDist = Infinity;
    const radius = 26 / Math.max(this.camera.zoom, 0.05);

    for (const [id, view] of this.agents) {
      if (!view.body.visible) continue;
      const dx = view.screen.sx - world.sx;
      // Bias upward: the clickable target is the figure, not the ground point.
      const dy = view.screen.sy - 14 - world.sy;
      const d = Math.hypot(dx, dy * 1.4);
      if (d < radius && d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  private hitTestBuilding(px: number, py: number): string | null {
    const world = this.camera.screenToWorld(px, py);
    const ground = screenToGrid(world.sx, world.sy);

    // Test tall buildings first: a click near the top of a tower resolves to
    // the tower, not to whatever tile lies behind it on the ground plane.
    const sorted = [...this.doc.buildings].sort((a, b) => b.height - a.height);
    for (const b of sorted) {
      // Un-project the click as if it landed on the building's roof.
      const lifted = screenToGrid(world.sx, world.sy + b.height * 22);
      if (rectContains(b.footprint, lifted)) return b.id;
    }
    for (const b of this.doc.buildings) {
      if (rectContains(b.footprint, ground)) return b.id;
    }
    return null;
  }

  private plazaCentre(): GridPoint {
    const monument = this.doc.props.find((p) => p.kind === 'monument');
    if (monument) return { x: monument.at.x + 0.5, y: monument.at.y + 0.5 };
    return { x: this.doc.gridSize.w / 2, y: this.doc.gridSize.h / 2 };
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                             */
  /* ---------------------------------------------------------------- */

  private frame(dtMs: number): void {
    if (this.destroyed) return;
    const settings = this.doc.settings;
    const speed = settings.reducedMotion ? 0 : settings.animationSpeed;

    /* Simulation ---------------------------------------------------- */
    // Reduced motion stops animation, not the simulation: agents still work,
    // they simply teleport between states instead of walking there.
    this.sim.tick(dtMs * (settings.animationSpeed || 1));
    const snapshot = this.sim.snapshot();

    /* Camera -------------------------------------------------------- */
    this.applyKeyboardPan(dtMs);
    this.camera.update(dtMs);
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(
      this.camera.viewport.width / 2 - this.camera.x * this.camera.zoom,
      this.camera.viewport.height / 2 - this.camera.y * this.camera.zoom,
    );

    const zoom = this.camera.zoom;
    const lod: Lod =
      zoom >= zoomLimits.lodDetail ? 'full' : zoom >= zoomLimits.lodCoarse ? 'reduced' : 'coarse';
    this.lastLod = lod;

    const bounds = this.camera.visibleBounds();
    const timeMs = performance.now();
    const animate = speed > 0 && snapshot.mode !== 'stopped';

    /* Buildings ----------------------------------------------------- */
    let buildingsDrawn = 0;
    for (const [id, view] of this.buildings) {
      const status = snapshot.buildingStatus[id] ?? 'normal';
      view.setStatus(status);
      const onScreen =
        view.focus.sx > bounds.minX - 400 &&
        view.focus.sx < bounds.maxX + 400 &&
        view.focus.sy > bounds.minY - 500 &&
        view.focus.sy < bounds.maxY + 400;
      view.update(dtMs, timeMs, lod, onScreen);
      if (onScreen) buildingsDrawn++;
    }

    /* Agents -------------------------------------------------------- */
    const runtimeById = new Map<string, AgentRuntime>();
    for (const rt of snapshot.agents) runtimeById.set(rt.id, rt);

    let agentsDrawn = 0;
    for (const [id, view] of this.agents) {
      const rt = runtimeById.get(id);
      if (!rt) {
        view.body.visible = false;
        view.overlay.visible = false;
        continue;
      }
      const onScreen =
        view.screen.sx > bounds.minX - 200 &&
        view.screen.sx < bounds.maxX + 200 &&
        view.screen.sy > bounds.minY - 300 &&
        view.screen.sy < bounds.maxY + 200;

      // Off-screen agents still advance their position (the simulation owns
      // that) but stop paying for animation and label layout.
      view.body.visible = true;
      view.overlay.visible = onScreen;

      const task = rt.taskId ? this.sim.tasks.get(rt.taskId) : null;
      const host = rt.buildingId ? this.buildings.get(rt.buildingId) : null;
      view.update(
        rt,
        onScreen ? dtMs : 0,
        timeMs,
        zoom,
        lod,
        settings,
        task ? taskColor(task.hue, task.risk) : null,
        host ? host.depth : null,
      );
      if (onScreen) agentsDrawn++;
    }

    /* Everything else ----------------------------------------------- */
    this.ground.update(dtMs, animate && settings.ambientActivity);
    this.props.update(timeMs, animate && settings.ambientActivity, WIND_BY_WEATHER[settings.weather]);
    this.ambient.update(dtMs * (settings.animationSpeed || 1), animate);
    this.tasks.update(snapshot.tasks, timeMs, animate);

    if (this.monument) {
      this.monument.setMood(moodFor(snapshot), snapshot.activityLevel);
      this.monument.update(dtMs, timeMs, animate);
    }

    this.atmosphere.update(dtMs, this.camera.x, this.camera.y, zoom, settings.reducedMotion);

    /* Stats --------------------------------------------------------- */
    this.frameCount++;
    this.statsClock += dtMs;
    if (this.statsClock >= 500) {
      this.callbacks.onStats?.({
        fps: Math.round((this.frameCount * 1000) / this.statsClock),
        buildingsDrawn,
        agentsDrawn,
      });
      this.frameCount = 0;
      this.statsClock = 0;
    }
  }

  private applyKeyboardPan(dtMs: number): void {
    const k = this.pressedKeys;
    if (k.size === 0) return;
    let dx = 0;
    let dy = 0;
    if (k.has('arrowleft') || k.has('a')) dx += 1;
    if (k.has('arrowright') || k.has('d')) dx -= 1;
    if (k.has('arrowup') || k.has('w')) dy += 1;
    if (k.has('arrowdown') || k.has('s')) dy -= 1;
    if (dx === 0 && dy === 0) return;
    const speed = (900 * dtMs) / 1000;
    this.camera.panBy(dx * speed, dy * speed);
  }

  get currentLod(): Lod {
    return this.lastLod;
  }
}

/** Map the simulation snapshot onto the monument's expressive range. */
export function moodFor(snapshot: SimSnapshot): MonumentMood {
  if (snapshot.mode === 'stopped') return 'stopped';
  if (snapshot.mode === 'paused') return 'paused';

  const trouble = snapshot.agents.filter((a) => a.state === 'failed' || a.state === 'blocked').length;
  if (trouble >= 2) return 'alert';

  const completed = snapshot.agents.filter((a) => a.state === 'completed').length;
  if (completed >= 2 || snapshot.activityLevel > 0.62) return 'productive';
  if (snapshot.activityLevel > 0.12) return 'active';
  return 'normal';
}
