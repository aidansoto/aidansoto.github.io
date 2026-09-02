/**
 * Application state.
 *
 * Deliberately thin. The simulation and the renderer run outside React at
 * 60 fps; React only needs a coarse mirror of that state at a rate a human can
 * read (about 5 Hz). Pushing every simulation frame into React state would
 * re-render the interface sixty times a second for no benefit.
 */

import { create } from 'zustand';
import type { ProviderStatus } from '@/providers/types';
import type {
  AgentConfig,
  AgentRuntime,
  BuildingConfig,
  BuildingStatus,
  CampusDocument,
  CampusEvent,
  CampusSettings,
  SystemMode,
  TaskRuntime,
} from '@/core/types';

export interface LogEntry {
  id: number;
  at: string;
  severity: 'info' | 'warn' | 'error' | 'good';
  text: string;
}

export interface ChatMessage {
  id: number;
  from: 'owner' | 'manager';
  text: string;
  at: number;
}

export interface RendererStats {
  fps: number;
  buildingsDrawn: number;
  agentsDrawn: number;
}

export type PanelId = 'roster' | 'log' | 'settings' | 'owner' | null;

/** Full-screen surfaces that sit above the campus. */
export type ScreenId = 'campus' | 'dashboard' | 'vault' | 'workflows' | 'results';

interface CampusState {
  ready: boolean;
  loadError: string | null;
  /** True when the desktop backend fell back to in-memory storage. */
  dbDegraded: boolean;
  repairs: string[];
  storageBackend: string;

  doc: CampusDocument | null;
  mode: SystemMode;

  agents: AgentRuntime[];
  tasks: TaskRuntime[];
  approvals: TaskRuntime[];
  buildingStatus: Record<string, BuildingStatus>;
  activityLevel: number;

  selectedAgentId: string | null;
  selectedBuildingId: string | null;
  hoveredAgentId: string | null;
  openPanel: PanelId;
  ownerSuiteOpen: boolean;

  /* -- Mission control ---------------------------------------------- */
  screen: ScreenId;
  newMissionOpen: boolean;
  /** Mission whose result is being viewed, if any. */
  viewingResultId: string | null;
  providerStatuses: ProviderStatus[];
  managerChat: ChatMessage[];

  log: LogEntry[];
  stats: RendererStats;

  setReady(v: boolean): void;
  setLoadError(msg: string | null): void;
  setDbDegraded(v: boolean): void;
  setDoc(doc: CampusDocument): void;
  setStorageBackend(b: string): void;
  setRepairs(r: string[]): void;
  patchSettings(patch: Partial<CampusSettings>): void;
  updateBuilding(id: string, patch: Partial<BuildingConfig>): void;
  updateAgent(id: string, patch: Partial<AgentConfig>): void;

  syncSnapshot(s: {
    mode: SystemMode;
    agents: AgentRuntime[];
    tasks: TaskRuntime[];
    approvals: TaskRuntime[];
    buildingStatus: Record<string, BuildingStatus>;
    activityLevel: number;
  }): void;

  selectAgent(id: string | null): void;
  selectBuilding(id: string | null): void;
  hoverAgent(id: string | null): void;
  setPanel(p: PanelId): void;
  setOwnerSuiteOpen(v: boolean): void;
  setScreen(s: ScreenId): void;
  setNewMissionOpen(v: boolean): void;
  setViewingResult(id: string | null): void;
  setProviderStatuses(list: ProviderStatus[]): void;
  pushChat(msg: Omit<ChatMessage, 'id' | 'at'>): void;
  clearChat(): void;
  pushLog(entry: Omit<LogEntry, 'id' | 'at'>): void;
  clearLog(): void;
  setStats(s: RendererStats): void;
}

let logSeq = 0;
let chatSeq = 0;
const LOG_LIMIT = 300;

export const useCampus = create<CampusState>((set) => ({
  ready: false,
  loadError: null,
  dbDegraded: false,
  repairs: [],
  storageBackend: 'unknown',

  doc: null,
  mode: 'running',

  agents: [],
  tasks: [],
  approvals: [],
  buildingStatus: {},
  activityLevel: 0,

  selectedAgentId: null,
  selectedBuildingId: null,
  hoveredAgentId: null,
  openPanel: 'roster',
  ownerSuiteOpen: false,
  screen: 'campus',
  newMissionOpen: false,
  viewingResultId: null,
  providerStatuses: [],
  managerChat: [],

  log: [],
  stats: { fps: 0, buildingsDrawn: 0, agentsDrawn: 0 },

  setReady: (v) => set({ ready: v }),
  setLoadError: (msg) => set({ loadError: msg }),
  setDbDegraded: (v) => set({ dbDegraded: v }),
  setDoc: (doc) => set({ doc }),
  setStorageBackend: (b) => set({ storageBackend: b }),
  setRepairs: (r) => set({ repairs: r }),

  patchSettings: (patch) =>
    set((s) => (s.doc ? { doc: { ...s.doc, settings: { ...s.doc.settings, ...patch } } } : s)),

  updateBuilding: (id, patch) =>
    set((s) =>
      s.doc
        ? {
            doc: {
              ...s.doc,
              buildings: s.doc.buildings.map((b) => (b.id === id ? { ...b, ...patch } : b)),
            },
          }
        : s,
    ),

  updateAgent: (id, patch) =>
    set((s) =>
      s.doc
        ? {
            doc: {
              ...s.doc,
              agents: s.doc.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
            },
          }
        : s,
    ),

  syncSnapshot: (snapshot) =>
    set({
      mode: snapshot.mode,
      // The renderer mutates runtime objects in place for speed, so the mirror
      // takes shallow copies; React compares these, not the live objects.
      agents: snapshot.agents.map((a) => ({ ...a, pos: { ...a.pos }, trail: [...a.trail] })),
      tasks: snapshot.tasks.map((t) => ({ ...t })),
      approvals: snapshot.approvals.map((t) => ({ ...t })),
      buildingStatus: { ...snapshot.buildingStatus },
      activityLevel: snapshot.activityLevel,
    }),

  // Selecting an agent clears any building selection: the inspector shows one
  // subject at a time.
  selectAgent: (id) => set((s) => ({ selectedAgentId: id, selectedBuildingId: id ? null : s.selectedBuildingId })),
  selectBuilding: (id) => set({ selectedBuildingId: id }),
  hoverAgent: (id) => set({ hoveredAgentId: id }),
  setPanel: (p) => set((s) => ({ openPanel: s.openPanel === p ? null : p })),
  setOwnerSuiteOpen: (v) => set({ ownerSuiteOpen: v }),
  setScreen: (screen) => set({ screen }),
  setNewMissionOpen: (newMissionOpen) => set({ newMissionOpen }),
  setViewingResult: (viewingResultId) => set({ viewingResultId }),
  setProviderStatuses: (providerStatuses) => set({ providerStatuses }),
  pushChat: (msg) =>
    set((s) => {
      const next = [...s.managerChat, { ...msg, id: ++chatSeq, at: Date.now() }];
      if (next.length > 200) next.splice(0, next.length - 200);
      return { managerChat: next };
    }),
  clearChat: () => set({ managerChat: [] }),

  pushLog: (entry) =>
    set((s) => {
      const next = [
        ...s.log,
        {
          ...entry,
          id: ++logSeq,
          at: new Date().toLocaleTimeString([], { hour12: false }),
        },
      ];
      if (next.length > LOG_LIMIT) next.splice(0, next.length - LOG_LIMIT);
      return { log: next };
    }),

  clearLog: () => set({ log: [] }),
  setStats: (stats) => set({ stats }),
}));

/** Turn a raw campus event into a log line. Pure — unit tested. */
export function describeEvent(
  event: CampusEvent,
  names: { agents: Record<string, string>; buildings: Record<string, string> },
): { severity: LogEntry['severity']; text: string } | null {
  const agentName = (id: string | null | undefined): string =>
    id ? (names.agents[id] ?? id) : 'Unknown agent';
  const buildingName = (id: string | null | undefined): string =>
    id ? (names.buildings[id] ?? id) : 'the campus';

  switch (event.event_type) {
    case 'agent_state_changed': {
      const p = event.payload as CampusEvent<'agent_state_changed'>['payload'];
      // Routine churn between working states would bury everything else.
      const noisy = new Set(['using_tool', 'working', 'idle', 'planning', 'receiving_task']);
      if (noisy.has(p.new_state)) return null;
      const severity: LogEntry['severity'] =
        p.new_state === 'failed' ? 'error' : p.new_state === 'blocked' ? 'warn' : p.new_state === 'completed' ? 'good' : 'info';
      return { severity, text: `${agentName(p.agent_id)} → ${label(p.new_state)}` };
    }
    case 'task_created': {
      const p = event.payload as CampusEvent<'task_created'>['payload'];
      return {
        severity: 'info',
        text: `${p.label} received${p.risk !== 'standard' ? ` (${p.risk})` : ''}`,
      };
    }
    case 'task_stage_changed': {
      const p = event.payload as CampusEvent<'task_stage_changed'>['payload'];
      if (p.new_stage === 'routing' || p.new_stage === 'in_progress') return null;
      const severity: LogEntry['severity'] =
        p.new_stage === 'failed' ? 'error' : p.new_stage === 'archived' ? 'good' : 'info';
      return { severity, text: `${p.task_id} → ${p.new_stage.replace(/_/g, ' ')}` };
    }
    case 'approval_requested': {
      const p = event.payload as CampusEvent<'approval_requested'>['payload'];
      return {
        severity: 'warn',
        text: `Approval requested by ${agentName(p.agent_id)} at ${buildingName(p.building_id)}`,
      };
    }
    case 'approval_resolved': {
      const p = event.payload as CampusEvent<'approval_resolved'>['payload'];
      return {
        severity: p.approved ? 'good' : 'warn',
        text: `${p.task_id} ${p.approved ? 'approved' : 'declined'}`,
      };
    }
    case 'building_status_changed': {
      const p = event.payload as CampusEvent<'building_status_changed'>['payload'];
      if (p.new_status === 'normal' || p.new_status === 'active') return null;
      const severity: LogEntry['severity'] =
        p.new_status === 'blocked' ? 'warn' : p.new_status === 'offline' ? 'error' : 'info';
      return { severity, text: `${buildingName(p.building_id)} → ${p.new_status}` };
    }
    case 'system_mode_changed': {
      const p = event.payload as CampusEvent<'system_mode_changed'>['payload'];
      return {
        severity: p.mode === 'stopped' ? 'error' : p.mode === 'paused' ? 'warn' : 'good',
        text: p.reason,
      };
    }
    case 'alert': {
      const p = event.payload as CampusEvent<'alert'>['payload'];
      return { severity: p.severity, text: p.message };
    }
    default:
      return null;
  }
}

function label(state: string): string {
  return state
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
