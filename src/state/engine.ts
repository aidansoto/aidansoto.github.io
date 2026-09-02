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
import { createAutosave, getStore, isTauri, type CampusStore } from '@/persistence/storage';
import { createDefaultCampus } from '@/config/defaultCampus';
import { sound } from '@/audio/sound';
import { ManagerEngine, type StartMissionInput } from '@/orchestration/manager';
import { providers } from '@/providers/registry';
import { notifier } from '@/notify/notifications';
import { useCampus, describeEvent } from './store';

export class CampusEngine {
  sim: CampusSimulation | null = null;
  renderer: CampusRenderer | null = null;
  manager: ManagerEngine | null = null;

  private store: CampusStore = getStore();
  private autosave = createAutosave(getStore());
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private doc: CampusDocument | null = null;
  private booted = false;
  private managerTimer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;

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

    // Desktop only: if the backend fell back to in-memory storage because the
    // on-disk database could not be opened, say so plainly — the campus runs,
    // but nothing from this session will survive a restart.
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const health = await invoke<string>('store_status');
        if (health === 'memory') {
          state.setDbDegraded(true);
          state.pushLog({
            severity: 'error',
            text: 'The campus database could not be opened. The campus is running from memory; changes made in this session will not survive a restart.',
          });
        }
      } catch {
        /* older backend without the command — nothing to report */
      }
    }

    this.sim = new CampusSimulation(doc, bus);
    this.attachEventLog();

    const renderer = new CampusRenderer({
      host,
      doc,
      sim: this.sim,
      onSelectAgent: (id) => useCampus.getState().selectAgent(id),
      onSelectBuilding: (id) => useCampus.getState().selectBuilding(id),
      onHoverAgent: (id) => useCampus.getState().hoverAgent(id),
      onStats: (stats) => useCampus.getState().setStats(stats),
    });

    // If the map cannot start, the rest of the application still can. Report
    // the reason and carry on with the roster, log, settings and owner console
    // rather than leaving the owner staring at a boot screen forever.
    try {
      await renderer.init();
      this.renderer = renderer;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.setLoadError(message);
      state.pushLog({ severity: 'error', text: `Campus map unavailable — ${message}` });
      renderer.destroy();
      this.renderer = null;
    }

    sound.setEnabled(doc.settings.soundEnabled);
    sound.setVolume(doc.settings.soundVolume);

    /* -- Mission control ------------------------------------------- */
    this.manager = new ManagerEngine({
      // The Manager mutates the campus document through the same store the
      // renderer and persistence read, so nothing can drift out of sync.
      commit: (mutate) => {
        const current = useCampus.getState().doc;
        if (!current) return;
        const draft: CampusDocument = { ...current };
        mutate(draft);
        useCampus.getState().setDoc(draft);
      },
      read: () => useCampus.getState().doc,
      notify: (event) => {
        void notifier.send(event);
        useCampus.getState().pushLog({
          severity:
            event.kind === 'mission_failed' || event.kind === 'agent_blocked'
              ? 'error'
              : event.kind === 'approval_needed' || event.kind === 'deadline'
                ? 'warn'
                : 'good',
          text: `${event.title}: ${event.body}`,
        });
        if (event.kind === 'mission_complete') sound.play('task_complete');
        if (event.kind === 'approval_needed') sound.play('approval');
        if (event.kind === 'mission_failed') sound.play('error');
      },
    });

    notifier.setEnabled(doc.settings.notifications);

    // Advance missions on a steady cadence. The engine is re-entrant-guarded,
    // so a slow model simply means the next tick finds work still running.
    this.managerTimer = setInterval(() => {
      const state = useCampus.getState();
      // The owner's pause and emergency stop outrank the Manager.
      if (state.mode !== 'running') {
        // Nothing real is running, so the campus must stop showing mission work.
        this.sim?.applyDirectives([]);
        return;
      }
      void this.manager?.tick();
      // Push real mission state into the campus so the map mirrors the backend
      // rather than inventing activity.
      this.sim?.applyDirectives(this.manager?.directives() ?? []);
    }, 700);

    // Discover which brains are available, then re-check periodically so
    // starting Ollama is picked up without a restart.
    const probe = (): void => {
      const current = useCampus.getState().doc;
      if (!current) return;
      void providers
        .probeAll({ ollamaUrl: current.settings.ollamaUrl })
        .then((list) => useCampus.getState().setProviderStatuses(list));
    };
    probe();
    this.probeTimer = setInterval(probe, 30000);

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
      notifier.setEnabled(next.settings.notifications);
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
    // Pausing or stopping the campus must also stop real mission work, not
    // just the visuals.
    if (mode !== 'running') this.manager?.abortAll();
    else void this.manager?.tick();
  }

  emergencyStop(): void {
    this.manager?.abortAll();
    this.sim?.emergencyStop();
  }

  /* ---------------------------------------------------------------- */
  /* Missions                                                          */
  /* ---------------------------------------------------------------- */

  async startMission(input: StartMissionInput): Promise<string | null> {
    const id = (await this.manager?.startMission(input)) ?? null;
    if (id) {
      useCampus.getState().pushLog({ severity: 'good', text: `Mission started: ${input.goal}` });
    }
    return id;
  }

  cancelMission(missionId: string): void {
    this.manager?.cancelMission(missionId);
  }

  resolveSubtaskApproval(subtaskId: string, approved: boolean): void {
    this.manager?.resolveApproval(subtaskId, approved);
  }

  /** Re-designate which agent acts as Manager. */
  setManagerAgent(agentId: string): void {
    const doc = useCampus.getState().doc;
    if (!doc || !doc.agents.some((a) => a.id === agentId)) return;
    useCampus.getState().setDoc({ ...doc, managerAgentId: agentId });
    const name = doc.agents.find((a) => a.id === agentId)?.name ?? agentId;
    useCampus.getState().pushLog({ severity: 'info', text: `${name} is now the Manager.` });
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
    if (this.managerTimer) clearInterval(this.managerTimer);
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.snapshotTimer = null;
    this.managerTimer = null;
    this.probeTimer = null;
    this.manager?.dispose();
    this.manager = null;
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
