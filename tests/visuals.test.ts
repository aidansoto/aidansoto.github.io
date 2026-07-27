import { describe, it, expect } from 'vitest';
import {
  AGENT_VISUALS,
  BUILDING_VISUALS,
  SUIT_ALT,
  SUIT_BLACK,
  TASK_STAGE_LABEL,
  suitFor,
  taskColor,
} from '@/render/stateVisuals';
import { massesFor, inset, shade, mixColor, facePoint, topQuad, faceQuad } from '@/render/geometry';
import { moodFor } from '@/render/campusRenderer';
import { AGENT_STATES, type AgentRuntime, type BuildingStyle } from '@/core/types';
import { describeEvent } from '@/state/store';
import { Rng } from '@/sim/rng';

const ALL_STYLES: BuildingStyle[] = [
  'tower',
  'slab',
  'lab',
  'bunker',
  'vault',
  'studio',
  'cylinder',
  'suite',
  'hub',
  'annex',
];

describe('agent state visuals', () => {
  it('covers every declared state', () => {
    for (const state of AGENT_STATES) {
      expect(AGENT_VISUALS[state]).toBeDefined();
    }
  });

  it('gives every state a readable label', () => {
    for (const state of AGENT_STATES) {
      expect(AGENT_VISUALS[state].label.length).toBeGreaterThan(2);
    }
  });

  it('never relies on colour alone: states that share a colour differ in shape', () => {
    const byColor = new Map<number, Set<string>>();
    for (const state of AGENT_STATES) {
      const v = AGENT_VISUALS[state];
      const set = byColor.get(v.color) ?? new Set<string>();
      set.add(v.shape);
      byColor.set(v.color, set);
    }
    for (const [color, shapes] of byColor) {
      const states = AGENT_STATES.filter((s) => AGENT_VISUALS[s].color === color);
      if (states.length > 1) {
        expect(shapes.size, `states sharing colour ${color} share a shape`).toBe(states.length);
      }
    }
  });

  it('keeps inert states visually still', () => {
    expect(AGENT_VISUALS.offline.motion).toBe(0);
    expect(AGENT_VISUALS.paused.motion).toBe(0);
    expect(AGENT_VISUALS.offline.pulse).toBe(0);
  });

  it('flags trouble states with an urgent pulse', () => {
    expect(AGENT_VISUALS.blocked.pulse).toBe(2);
    expect(AGENT_VISUALS.failed.pulse).toBe(2);
    expect(AGENT_VISUALS.waiting_for_approval.pulse).toBe(2);
  });
});

describe('building status visuals', () => {
  it('darkens progressively from productive to offline', () => {
    expect(BUILDING_VISUALS.productive.intensity).toBeGreaterThan(BUILDING_VISUALS.active.intensity);
    expect(BUILDING_VISUALS.active.intensity).toBeGreaterThan(BUILDING_VISUALS.normal.intensity);
    expect(BUILDING_VISUALS.normal.intensity).toBeGreaterThan(BUILDING_VISUALS.paused.intensity);
    expect(BUILDING_VISUALS.paused.intensity).toBeGreaterThan(BUILDING_VISUALS.offline.intensity);
  });

  it('shows no rooftop beacon in the resting states', () => {
    expect(BUILDING_VISUALS.normal.beacon).toBeNull();
    expect(BUILDING_VISUALS.paused.beacon).toBeNull();
    expect(BUILDING_VISUALS.offline.beacon).toBeNull();
  });

  it('never strobes: no beacon pulses at the fastest rate', () => {
    for (const vis of Object.values(BUILDING_VISUALS)) {
      expect(vis.beaconPulse).toBeLessThan(2);
    }
  });
});

describe('dress system', () => {
  it('gives black suits to suit_black agents regardless of variant', () => {
    for (let v = 0; v < 8; v++) {
      expect(suitFor('suit_black', v)).toBe(SUIT_BLACK);
    }
  });

  it('never gives a suit_alt agent the black suit', () => {
    for (let v = 0; v < 20; v++) {
      const suit = suitFor('suit_alt', v);
      expect(suit).not.toBe(SUIT_BLACK);
      expect(suit.jacket).not.toBe(SUIT_BLACK.jacket);
    }
  });

  it('keeps alternate palettes meaningfully lighter than obsidian black', () => {
    const luminance = (c: number): number =>
      0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff);
    for (const suit of SUIT_ALT) {
      expect(luminance(suit.jacket)).toBeGreaterThan(luminance(SUIT_BLACK.jacket));
    }
  });

  it('names every alternate palette', () => {
    for (const suit of SUIT_ALT) {
      expect(suit.name.length).toBeGreaterThan(0);
    }
  });
});

describe('task visuals', () => {
  it('marks elevated and secure work with dedicated colours', () => {
    const standard = taskColor(0, 'standard');
    expect(taskColor(0, 'secure')).not.toBe(standard);
    expect(taskColor(0, 'elevated')).not.toBe(standard);
    // Risk overrides hue entirely, so secure work always looks the same.
    expect(taskColor(3, 'secure')).toBe(taskColor(0, 'secure'));
  });

  it('wraps hue indices safely', () => {
    expect(() => taskColor(999, 'standard')).not.toThrow();
    expect(taskColor(999, 'standard')).toBeTypeOf('number');
  });

  it('labels every task stage', () => {
    for (const label of Object.values(TASK_STAGE_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('building geometry', () => {
  const footprint = { x: 10, y: 10, w: 12, h: 12 };

  it('produces at least one mass for every archetype', () => {
    for (const style of ALL_STYLES) {
      const masses = massesFor(style, footprint, 20);
      expect(masses.length, style).toBeGreaterThan(0);
    }
  });

  it('never produces an inverted or zero-height mass', () => {
    for (const style of ALL_STYLES) {
      for (const m of massesFor(style, footprint, 20)) {
        expect(m.top, style).toBeGreaterThan(m.base);
        expect(m.rect.w).toBeGreaterThan(0);
        expect(m.rect.h).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every mass inside the footprint', () => {
    for (const style of ALL_STYLES) {
      for (const m of massesFor(style, footprint, 20)) {
        expect(m.rect.x).toBeGreaterThanOrEqual(footprint.x);
        expect(m.rect.y).toBeGreaterThanOrEqual(footprint.y);
        expect(m.rect.x + m.rect.w).toBeLessThanOrEqual(footprint.x + footprint.w + 1e-9);
        expect(m.rect.y + m.rect.h).toBeLessThanOrEqual(footprint.y + footprint.h + 1e-9);
      }
    }
  });

  it('steps the tower inward as it rises', () => {
    const masses = massesFor('tower', footprint, 30);
    for (let i = 1; i < masses.length; i++) {
      expect(masses[i].rect.w).toBeLessThanOrEqual(masses[i - 1].rect.w);
      expect(masses[i].base).toBeGreaterThanOrEqual(masses[i - 1].base);
    }
  });

  it('lifts the owner suite on a narrower core', () => {
    const masses = massesFor('suite', footprint, 21);
    expect(masses[0].rect.w).toBeLessThan(masses[1].rect.w);
    expect(masses[1].base).toBeGreaterThan(masses[0].base);
  });

  it('never insets below a single tile', () => {
    const tiny = inset({ x: 0, y: 0, w: 2, h: 2 }, 5);
    expect(tiny.w).toBe(1);
    expect(tiny.h).toBe(1);
  });

  it('projects face points that rise with v', () => {
    const m = { rect: footprint, base: 0, top: 10 };
    const low = facePoint(m, 'left', 0.5, 0);
    const high = facePoint(m, 'left', 0.5, 1);
    // Screen y decreases upward.
    expect(high.sy).toBeLessThan(low.sy);
  });

  it('produces four corners for tops and faces', () => {
    const m = { rect: footprint, base: 0, top: 10 };
    expect(topQuad(m)).toHaveLength(4);
    expect(faceQuad(m, 'left')).toHaveLength(4);
    expect(faceQuad(m, 'right')).toHaveLength(4);
  });
});

describe('colour maths', () => {
  it('darkens and never overflows a channel', () => {
    expect(shade(0xffffff, 0.5)).toBe(0x808080);
    expect(shade(0xffffff, 4)).toBe(0xffffff);
    expect(shade(0x000000, 2)).toBe(0x000000);
  });

  it('mixes endpoints exactly', () => {
    expect(mixColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});

describe('monument mood', () => {
  const agent = (state: AgentRuntime['state']): AgentRuntime =>
    ({
      id: 'a',
      state,
      pos: { x: 0, y: 0 },
      elevation: 0,
      indoors: false,
      heading: 0,
      buildingId: null,
      locationId: null,
      taskId: null,
      progress: 0,
      tool: null,
      path: [],
      pathIndex: 0,
      stateTimer: 0,
      trail: [],
      transport: null,
    }) as AgentRuntime;

  const snapshot = (agents: AgentRuntime[], activityLevel: number, mode: 'running' | 'paused' | 'stopped' = 'running') => ({
    mode,
    agents,
    tasks: [],
    buildingStatus: {},
    approvals: [],
    simTime: 0,
    activityLevel,
  });

  it('reflects system mode first', () => {
    expect(moodFor(snapshot([], 1, 'stopped'))).toBe('stopped');
    expect(moodFor(snapshot([], 1, 'paused'))).toBe('paused');
  });

  it('raises an alert when several agents are in trouble', () => {
    expect(moodFor(snapshot([agent('failed'), agent('blocked')], 0.9))).toBe('alert');
  });

  it('shows productivity on sustained output', () => {
    expect(moodFor(snapshot([agent('completed'), agent('completed')], 0.3))).toBe('productive');
    expect(moodFor(snapshot([agent('working')], 0.8))).toBe('productive');
  });

  it('rests at normal when the campus is quiet', () => {
    expect(moodFor(snapshot([agent('idle')], 0))).toBe('normal');
    expect(moodFor(snapshot([agent('working')], 0.3))).toBe('active');
  });
});

describe('describeEvent', () => {
  const names = { agents: { agent_001: 'Agent 01' }, buildings: { building_002: 'Operations' } };
  const wrap = <T extends Record<string, unknown>>(type: string, payload: T) =>
    ({ event_type: type, timestamp: new Date().toISOString(), payload }) as never;

  it('suppresses routine state churn', () => {
    const result = describeEvent(
      wrap('agent_state_changed', {
        agent_id: 'agent_001',
        previous_state: 'idle',
        new_state: 'working',
        task_id: null,
        building_id: null,
        location_id: null,
      }),
      names,
    );
    expect(result).toBeNull();
  });

  it('reports failures as errors and uses the agent display name', () => {
    const result = describeEvent(
      wrap('agent_state_changed', {
        agent_id: 'agent_001',
        previous_state: 'blocked',
        new_state: 'failed',
        task_id: null,
        building_id: null,
        location_id: null,
      }),
      names,
    );
    expect(result?.severity).toBe('error');
    expect(result?.text).toContain('Agent 01');
  });

  it('names the building in an approval request', () => {
    const result = describeEvent(
      wrap('approval_requested', {
        task_id: 't1',
        agent_id: 'agent_001',
        building_id: 'building_002',
      }),
      names,
    );
    expect(result?.severity).toBe('warn');
    expect(result?.text).toContain('Operations');
  });

  it('falls back to raw ids for unknown subjects', () => {
    const result = describeEvent(
      wrap('approval_requested', { task_id: 't1', agent_id: 'ghost', building_id: 'nowhere' }),
      names,
    );
    expect(result?.text).toContain('ghost');
  });

  it('passes alerts through verbatim', () => {
    const result = describeEvent(wrap('alert', { severity: 'error', message: 'Stop engaged' }), names);
    expect(result).toEqual({ severity: 'error', text: 'Stop engaged' });
  });
});

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('stays inside its declared ranges', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const r = rng.range(4, 9);
      expect(r).toBeGreaterThanOrEqual(4);
      expect(r).toBeLessThan(9);
      const n = rng.int(1, 3);
      expect([1, 2, 3]).toContain(n);
    }
  });

  it('returns undefined when picking from an empty list', () => {
    expect(new Rng(1).pick([])).toBeUndefined();
  });
});
