/**
 * The visual vocabulary for agent and building state.
 *
 * Readability is the hard requirement: at any zoom the owner must be able to
 * tell what an agent is doing. Each state therefore gets a distinct indicator
 * colour *and* a distinct indicator shape, so the two channels reinforce each
 * other and nothing depends on colour alone.
 */

import { palette } from '@/design/tokens';
import type { AgentState, BuildingStatus, TaskRisk, TaskStage } from '@/core/types';

export type IndicatorShape = 'dot' | 'ring' | 'bar' | 'chevron' | 'square' | 'diamond' | 'cross';

export interface StateVisual {
  color: number;
  shape: IndicatorShape;
  /** 0 = static, 1 = slow pulse, 2 = fast pulse. */
  pulse: 0 | 1 | 2;
  /** Multiplier on the figure's idle bob amplitude. */
  motion: number;
  label: string;
}

export const AGENT_VISUALS: Record<AgentState, StateVisual> = {
  idle: { color: palette.silverDim, shape: 'dot', pulse: 0, motion: 0.4, label: 'Idle' },
  receiving_task: { color: palette.cyanData, shape: 'chevron', pulse: 2, motion: 0.8, label: 'Receiving' },
  planning: { color: palette.blueGlow, shape: 'ring', pulse: 1, motion: 0.5, label: 'Planning' },
  working: { color: palette.lightWhite, shape: 'bar', pulse: 0, motion: 1, label: 'Working' },
  using_tool: { color: palette.blue, shape: 'square', pulse: 2, motion: 1.2, label: 'Using Tool' },
  collaborating: { color: palette.silverBright, shape: 'diamond', pulse: 1, motion: 0.9, label: 'Collaborating' },
  reviewing: { color: palette.goldBright, shape: 'ring', pulse: 1, motion: 0.6, label: 'Reviewing' },
  waiting: { color: palette.silver, shape: 'dot', pulse: 1, motion: 0.3, label: 'Waiting' },
  waiting_for_approval: { color: palette.gold, shape: 'diamond', pulse: 2, motion: 0.2, label: 'Awaiting Approval' },
  paused: { color: palette.silverDim, shape: 'bar', pulse: 0, motion: 0, label: 'Paused' },
  blocked: { color: palette.amber, shape: 'cross', pulse: 2, motion: 0.15, label: 'Blocked' },
  failed: { color: palette.redBright, shape: 'cross', pulse: 2, motion: 0.1, label: 'Failed' },
  completed: { color: palette.green, shape: 'ring', pulse: 1, motion: 0.7, label: 'Completed' },
  offline: { color: 0x39404a, shape: 'dot', pulse: 0, motion: 0, label: 'Offline' },
};

export interface BuildingVisual {
  /** Emissive colour for window mullions and interior glow. */
  glow: number;
  /** 0..1 window luminance. */
  intensity: number;
  /** Rooftop beacon colour, or null for no beacon. */
  beacon: number | null;
  beaconPulse: 0 | 1 | 2;
  label: string;
}

export const BUILDING_VISUALS: Record<BuildingStatus, BuildingVisual> = {
  normal: { glow: palette.lightWhite, intensity: 0.42, beacon: null, beaconPulse: 0, label: 'Normal' },
  active: { glow: palette.lightCool, intensity: 0.68, beacon: palette.blue, beaconPulse: 1, label: 'Active' },
  productive: { glow: palette.lightWarm, intensity: 0.86, beacon: palette.gold, beaconPulse: 1, label: 'Productive' },
  blocked: { glow: 0xffb9a8, intensity: 0.55, beacon: palette.red, beaconPulse: 1, label: 'Blocked' },
  paused: { glow: palette.lightWhite, intensity: 0.16, beacon: null, beaconPulse: 0, label: 'Paused' },
  offline: { glow: 0x2a3038, intensity: 0.04, beacon: null, beaconPulse: 0, label: 'Offline' },
  approval: { glow: palette.goldBright, intensity: 0.78, beacon: palette.goldBright, beaconPulse: 1, label: 'Approval Needed' },
};

/** Task indicator hues, indexed by `TaskRuntime.hue`. */
export const TASK_HUES = [
  palette.cyanData,
  palette.blueGlow,
  palette.silverBright,
  palette.goldBright,
  palette.green,
  palette.lightWhite,
] as const;

export function taskColor(hue: number, risk: TaskRisk): number {
  if (risk === 'secure') return palette.gold;
  if (risk === 'elevated') return palette.amber;
  return TASK_HUES[hue % TASK_HUES.length];
}

export const TASK_STAGE_LABEL: Record<TaskStage, string> = {
  inbound: 'Inbound',
  routing: 'Routing',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'In Review',
  approval: 'Awaiting Approval',
  archived: 'Archived',
  failed: 'Failed',
};

/**
 * Suit palettes. Male agents wear black with silver accents; female agents wear
 * an equally formal alternate palette that is never black. Both are data —
 * the owner can retune them later without touching the renderer.
 */
export interface SuitPalette {
  jacket: number;
  jacketShadow: number;
  shirt: number;
  accent: number;
  legs: number;
  name: string;
}

export const SUIT_BLACK: SuitPalette = {
  jacket: 0x101318,
  jacketShadow: 0x070a0d,
  shirt: 0xd8e2ee,
  accent: palette.silverBright,
  legs: 0x0b0e12,
  name: 'Obsidian Black',
};

export const SUIT_ALT: SuitPalette[] = [
  { jacket: 0x1b2a41, jacketShadow: 0x101a2a, shirt: 0xdbe6f2, accent: 0x9fc0e4, legs: 0x16233a, name: 'Deep Navy' },
  { jacket: 0x24313d, jacketShadow: 0x161f28, shirt: 0xd6e2ec, accent: 0xa8bccd, legs: 0x1d2833, name: 'Charcoal Blue' },
  { jacket: 0x2a3138, jacketShadow: 0x1a1f24, shirt: 0xd9e0e7, accent: 0xb3bec8, legs: 0x232930, name: 'Graphite Blue' },
  { jacket: 0x12312a, jacketShadow: 0x0a201b, shirt: 0xd7e8e0, accent: 0x8fc9b4, legs: 0x0f2a24, name: 'Dark Emerald' },
];

export function suitFor(presentation: 'suit_black' | 'suit_alt', variant: number): SuitPalette {
  if (presentation === 'suit_black') return SUIT_BLACK;
  return SUIT_ALT[variant % SUIT_ALT.length];
}
