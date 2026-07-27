/**
 * Engine: the wiring between persistence, simulation, renderer and interface.
 *
 * This is the only module that knows about all four. Keeping the joins in one
 * place is what makes the simulation swappable later — when a real agent
 * backend arrives it replaces `CampusSimulation` here and nothing else moves.
 */

import type { CampusDocument, CampusSettings, SystemMode } from '@/core/types';
import { bus } from '@/core/events';
import { CampusSimulation } from '@/sim/simulation';
import { CampusRenderer } from '@/render/campusRenderer';
import { createAutosave, getStore, type CampusStore } from '@/persistence/storage';
import { createDefaultCampus } from '@/config/defaultCampus';
import { sound } from '@/audio/sound';
import { useCampus, describeEvent } from './store';

export class CampusEngine {
  sim: CampusSimulation | null = null;
  renderer: CampusRenderer | null = null;

  private store: CampusStore = getStore();
  private autosave = createAutosave(getStore());
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private doc: CampusDocument | null = null;
  private booted = false;

  /** Load persisted state, build the simulation, mount the renderer. */
  async boot(host: HTMLElement): Promise<void> {
    if (this.booted) return;
    this.booted = true;

    const state = useCampus.getState();
    state.setStorageBackend(this.store.backend);

    let doc: CampusDocument;
    let repairs: string[] = [];
    try {
      const loaded = await this.store.load();
      doc = loaded.doc;
      repairs = loaded.repairs;
    } catch (err) {
      state.setLoadError(err instanceof Error ? err.message : String(err));
      doc = createDefaultCampus();
    }

    this.doc = doc;
    state.setDoc(doc);
    state.setRepairs(repairs);
    for (const r of repairs) state.pushLog({ severity: 'warn', text: r });

    this.sim = new CampusSimulation(doc, bus);
    this.attachEventLog();

    this.renderer = new CampusRenderer({
      host,
      doc,
      sim: this.sim,
      onSelectAgent: (id) => useCampus.getState().selectAgent(id),
      onSelectBuilding: (id) => useCampus.getState().selectBuilding(id),
      onHoverAgent: (id) => useCampus.getState().hoverAgent(id),
      onStats: (stats) => useCampus.getState().setStats(stats),
    });
    await this.renderer.init();

    sound.setEnabled(doc.settings.soundEnabled);
    sound.setVolume(doc.settings.soundVolume);

    // Mirror the simulation into React at a human-readable rate.
    this.snapshotTimer = setInterval(() => {
      if (!this.sim) return;
      useCampus.getState().syncSnapshot(this.sim.snapshot());
    }, 200);

    // Persist and propagate document changes made from the interface.
    this.unsubscribeStore = useCampus.subscribe((s, prev) => {
      if (!s.doc || s.doc === prev.doc) return;
      this.onDocumentChanged(s.doc, prev.doc);
    });

    state.pushLog({ severity: 'good', text: `Campus loaded from ${this.store.backend}.` });
    state.setReady(true);
  }

  private onDocumentChanged(next: CampusDocument, prev: CampusDocument | null): void {
    this.doc = next;
    this.autosave.schedule(next);

    const structural =
      !prev ||
      prev.buildings !== next.buildings ||
      prev.props !== next.props ||
      prev.paths !== next.paths ||
      prev.water !== next.water ||
      prev.plots !== next.plots ||
      prev.bridges !== next.bridges ||
      prev.themeId !== next.themeId ||
      prev.settings.timeOfDay !== next.settings.timeOfDay ||
      prev.gridSize.w !== next.gridSize.w ||
      prev.gridSize.h !== next.gridSize.h;

    if (structural) this.sim?.rebuild(next);
    this.renderer?.setDocument(next, structural);

    if (!prev || prev.settings !== next.settings) {
      sound.setEnabled(next.settings.soundEnabled);
      sound.setVolume(next.settings.soundVolume);
      if (next.settings.soundEnabled && next.settings.ambientActivity) sound.startAmbient();
      else sound.stopAmbient();
    }
  }

  private attachEventLog(): void {
    this.unsubscribeBus = bus.onAny((event) => {
      const state = useCampus.getState();
      const doc = this.doc;
      if (!doc) return;

      const names = {
        agents: Object.fromEntries(doc.agents.map((a) => [a.id, a.name])),
        buildings: Object.fromEntries(doc.buildings.map((b) => [b.id, b.name])),
      };
      const described = describeEvent(event, names);
      if (described) state.pushLog(described);

      switch (event.event_type) {
        case 'task_created':
          sound.play('task_notify');
          break;
        case 'approval_requested':
          sound.play('approval');
          break;
        case 'system_mode_changed':
          if ((event.payload as { mode: SystemMode }).mode === 'stopped') sound.play('emergency');
          break;
        case 'agent_state_changed': {
          const p = event.payload as { new_state: string };
          if (p.new_state === 'failed') sound.play('error');
          if (p.new_state === 'completed') sound.play('task_complete');
          break;
        }
        default:
          break;
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Owner controls                                                    */
  /* ---------------------------------------------------------------- */

  setMode(mode: SystemMode, reason: string): void {
    this.sim?.setMode(mode, reason);
  }

  emergencyStop(): void {
    this.sim?.emergencyStop();
  }

  resolveApproval(taskId: string, approved: boolean): void {
    this.sim?.resolveApproval(taskId, approved);
  }

  patchSettings(patch: Partial<CampusSettings>): void {
    useCampus.getState().patchSettings(patch);
  }

  async resetCampus(): Promise<void> {
    const doc = await this.store.reset();
    useCampus.getState().setDoc(doc);
    useCampus.getState().pushLog({ severity: 'warn', text: 'Campus configuration reset to defaults.' });
  }

  /** Force a synchronous-ish save. Called before the window closes. */
  async flush(): Promise<void> {
    await this.autosave.flush();
  }

  shutdown(): void {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
    this.unsubscribeBus?.();
    this.unsubscribeStore?.();
    this.unsubscribeBus = null;
    this.unsubscribeStore = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.sim = null;
    sound.destroy();
    this.booted = false;
  }
}

export const engine = new CampusEngine();
