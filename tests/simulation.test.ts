import { describe, it, expect } from 'vitest';
import { CampusSimulation, humanState } from '@/sim/simulation';
import { EventBus } from '@/core/events';
import { createDefaultCampus } from '@/config/defaultCampus';
import { AGENT_STATES, type CampusDocument } from '@/core/types';

function makeSim(doc: CampusDocument = createDefaultCampus()): {
  sim: CampusSimulation;
  bus: EventBus;
  doc: CampusDocument;
} {
  const bus = new EventBus();
  const sim = new CampusSimulation(doc, bus, { seed: 42, taskInterval: [2, 4] });
  return { sim, bus, doc };
}

/** Advance the simulation by `seconds`, in the ticker's own step size. */
function run(sim: CampusSimulation, seconds: number): void {
  const step = 100;
  for (let t = 0; t < seconds * 1000; t += step) sim.tick(step);
}

describe('CampusSimulation setup', () => {
  it('creates a runtime for every configured agent', () => {
    const { sim, doc } = makeSim();
    expect(sim.agents.size).toBe(doc.agents.length);
    for (const cfg of doc.agents) {
      const rt = sim.agents.get(cfg.id);
      expect(rt).toBeDefined();
      expect(rt!.buildingId).toBe(cfg.homeBuildingId);
    }
  });

  it('seats agents inside their assigned building', () => {
    const { sim, doc } = makeSim();
    for (const cfg of doc.agents) {
      const rt = sim.agents.get(cfg.id)!;
      const b = doc.buildings.find((x) => x.id === cfg.homeBuildingId)!;
      expect(rt.pos.x).toBeGreaterThanOrEqual(b.footprint.x);
      expect(rt.pos.x).toBeLessThanOrEqual(b.footprint.x + b.footprint.w);
      expect(rt.pos.y).toBeGreaterThanOrEqual(b.footprint.y);
      expect(rt.pos.y).toBeLessThanOrEqual(b.footprint.y + b.footprint.h);
    }
  });

  it('assigns a status to every building', () => {
    const { sim, doc } = makeSim();
    for (const b of doc.buildings) {
      expect(sim.buildingStatus.get(b.id)).toBeDefined();
    }
  });

  it('starts running', () => {
    const { sim } = makeSim();
    expect(sim.mode).toBe('running');
  });
});

describe('task lifecycle', () => {
  it('spawns inbound tasks over time', () => {
    const { sim } = makeSim();
    expect(sim.tasks.size).toBe(0);
    run(sim, 20);
    expect(sim.tasks.size).toBeGreaterThan(0);
  });

  it('routes tasks to agents and moves them off the inbound stage', () => {
    const { sim } = makeSim();
    run(sim, 60);
    const assigned = [...sim.tasks.values()].filter((t) => t.assignedAgentId !== null);
    expect(assigned.length).toBeGreaterThan(0);
    for (const task of assigned) {
      expect(task.stage).not.toBe('inbound');
      const agent = sim.agents.get(task.assignedAgentId!);
      expect(agent).toBeDefined();
    }
  });

  it('never assigns one agent two tasks at once', () => {
    const { sim } = makeSim();
    run(sim, 200);
    const holders = [...sim.tasks.values()]
      .filter((t) => t.assignedAgentId && t.stage !== 'archived' && t.stage !== 'failed')
      .map((t) => t.assignedAgentId);
    expect(new Set(holders).size).toBe(holders.length);
  });

  it('drives agents through the working states and accumulates progress', () => {
    const { sim, bus } = makeSim();

    // Sample over the whole run rather than at one instant: which state a
    // given agent happens to occupy at t=240s is not the property under test.
    const seen = new Set<string>();
    bus.on('agent_state_changed', (e) => seen.add(e.payload.new_state));
    let sawProgress = false;

    for (let i = 0; i < 24; i++) {
      run(sim, 10);
      if ([...sim.agents.values()].some((a) => a.taskId && a.progress > 0)) sawProgress = true;
      for (const a of sim.agents.values()) {
        expect(a.progress).toBeGreaterThanOrEqual(0);
        expect(a.progress).toBeLessThanOrEqual(1);
      }
    }

    expect(seen.has('working')).toBe(true);
    expect(seen.has('planning')).toBe(true);
    expect(sawProgress).toBe(true);
  });

  it('caps the number of live tasks', () => {
    const bus = new EventBus();
    const sim = new CampusSimulation(createDefaultCampus(), bus, {
      seed: 7,
      taskInterval: [0.2, 0.3],
      maxActiveTasks: 5,
    });
    run(sim, 300);
    const live = [...sim.tasks.values()].filter(
      (t) => t.stage !== 'archived' && t.stage !== 'failed',
    );
    expect(live.length).toBeLessThanOrEqual(5);
  });

  it('eventually archives completed work', () => {
    const { sim } = makeSim();
    run(sim, 600);
    const reachedEnd = [...sim.tasks.values()].some(
      (t) => t.stage === 'archived' || t.stage === 'failed',
    );
    expect(reachedEnd).toBe(true);
  });
});

describe('agent state machine', () => {
  it('emits a state-change event carrying the previous and new states', () => {
    const { sim, bus } = makeSim();
    const events: Array<{ previous: string; next: string }> = [];
    bus.on('agent_state_changed', (e) =>
      events.push({ previous: e.payload.previous_state, next: e.payload.new_state }),
    );

    run(sim, 60);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.previous).not.toBe(e.next);
  });

  it('only ever produces states from the declared vocabulary', () => {
    const { sim } = makeSim();
    run(sim, 400);
    for (const rt of sim.agents.values()) {
      expect(AGENT_STATES).toContain(rt.state);
    }
  });

  it('records a bounded trail of recent actions', () => {
    const { sim } = makeSim();
    run(sim, 300);
    for (const rt of sim.agents.values()) {
      expect(rt.trail.length).toBeLessThanOrEqual(3);
    }
  });

  it('clears the tool label when leaving the using-tool state', () => {
    const { sim } = makeSim();
    run(sim, 300);
    for (const rt of sim.agents.values()) {
      if (rt.state !== 'using_tool') expect(rt.tool).toBeNull();
    }
  });

  it('lets the owner force a single agent offline and back', () => {
    const { sim, doc } = makeSim();
    const id = doc.agents[0].id;
    sim.setAgentState(id, 'offline');
    expect(sim.agents.get(id)!.state).toBe('offline');

    run(sim, 30);
    // Offline agents are inert: the simulation must not wake them.
    expect(sim.agents.get(id)!.state).toBe('offline');

    sim.setAgentState(id, 'idle');
    expect(sim.agents.get(id)!.state).toBe('idle');
  });
});

describe('approvals', () => {
  it('emits approval_requested and exposes a queue', () => {
    const bus = new EventBus();
    const doc = createDefaultCampus();
    doc.settings.autoResolveApprovals = false;
    const sim = new CampusSimulation(doc, bus, { seed: 11, taskInterval: [2, 4] });

    let requested = 0;
    bus.on('approval_requested', () => requested++);

    run(sim, 400);
    expect(requested).toBeGreaterThan(0);
    expect(sim.approvals().length).toBeGreaterThan(0);
    for (const task of sim.approvals()) expect(task.stage).toBe('approval');
  });

  it('archives a task the owner approves', () => {
    const { sim, bus } = makeSim();
    run(sim, 40);

    const task = [...sim.tasks.values()][0];
    const agent = [...sim.agents.values()].find((a) => a.taskId === task.id) ?? [...sim.agents.values()][0];
    task.assignedAgentId = agent.id;
    agent.taskId = task.id;
    task.stage = 'approval';

    let resolved: boolean | null = null;
    bus.on('approval_resolved', (e) => (resolved = e.payload.approved));

    sim.resolveApproval(task.id, true);
    expect(resolved).toBe(true);
    expect(task.stage).toBe('archived');
    expect(agent.state).toBe('completed');
  });

  it('fails a task the owner declines', () => {
    const { sim } = makeSim();
    run(sim, 40);

    const task = [...sim.tasks.values()][0];
    const agent = [...sim.agents.values()][0];
    task.assignedAgentId = agent.id;
    agent.taskId = task.id;
    task.stage = 'approval';

    sim.resolveApproval(task.id, false);
    expect(task.stage).toBe('failed');
    expect(agent.state).toBe('failed');
  });

  it('ignores approval calls for tasks that are not awaiting approval', () => {
    const { sim } = makeSim();
    run(sim, 40);
    const task = [...sim.tasks.values()][0];
    task.stage = 'in_progress';
    sim.resolveApproval(task.id, true);
    expect(task.stage).toBe('in_progress');
  });
});

describe('system mode', () => {
  it('pauses every agent', () => {
    const { sim } = makeSim();
    run(sim, 60);
    sim.setMode('paused', 'test');

    expect(sim.mode).toBe('paused');
    for (const rt of sim.agents.values()) {
      expect(['paused', 'offline']).toContain(rt.state);
    }
  });

  it('freezes the world while paused', () => {
    const { sim } = makeSim();
    run(sim, 60);
    sim.setMode('paused', 'test');

    const before = [...sim.agents.values()].map((a) => ({ ...a.pos }));
    const taskCount = sim.tasks.size;
    run(sim, 60);
    const after = [...sim.agents.values()].map((a) => ({ ...a.pos }));

    expect(after).toEqual(before);
    expect(sim.tasks.size).toBe(taskCount);
  });

  it('resumes from paused', () => {
    const { sim } = makeSim();
    run(sim, 60);
    sim.setMode('paused', 'test');
    sim.setMode('running', 'test');
    expect(sim.mode).toBe('running');
    for (const rt of sim.agents.values()) {
      expect(rt.state).not.toBe('paused');
    }
  });

  it('emergency stop takes every agent offline and clears packets', () => {
    const { sim, bus } = makeSim();
    run(sim, 120);

    let alerted = false;
    bus.on('alert', (e) => {
      if (e.payload.severity === 'error') alerted = true;
    });

    sim.emergencyStop();

    expect(sim.mode).toBe('stopped');
    expect(alerted).toBe(true);
    for (const rt of sim.agents.values()) {
      expect(rt.state).toBe('offline');
      expect(rt.path).toEqual([]);
      expect(rt.transport).toBeNull();
    }
    for (const task of sim.tasks.values()) {
      expect(task.packet).toBeNull();
    }
  });

  it('marks every building offline during an emergency stop', () => {
    const { sim, doc } = makeSim();
    run(sim, 60);
    sim.emergencyStop();
    // Status is recalculated on mode change, not only on the next tick.
    for (const b of doc.buildings) {
      expect(sim.buildingStatus.get(b.id)).toBe('offline');
    }
  });

  it('recovers when the emergency stop is cleared', () => {
    const { sim } = makeSim();
    run(sim, 60);
    sim.emergencyStop();
    sim.setMode('running', 'cleared');
    run(sim, 30);

    expect(sim.mode).toBe('running');
    const offline = [...sim.agents.values()].filter((a) => a.state === 'offline');
    expect(offline.length).toBe(0);
  });
});

describe('building status', () => {
  it('reports blocked when an agent in the building is blocked', () => {
    const { sim, doc } = makeSim();
    const agent = [...sim.agents.values()][0];
    const buildingId = agent.buildingId!;
    sim.setAgentState(agent.id, 'blocked');
    run(sim, 1);
    expect(sim.buildingStatus.get(buildingId)).toBe('blocked');
    expect(doc.buildings.some((b) => b.id === buildingId)).toBe(true);
  });

  it('reports approval when an agent is awaiting the owner', () => {
    const { sim } = makeSim();
    // Isolate one building so no other agent's state outranks the assertion.
    const agent = [...sim.agents.values()].find((a) => a.buildingId === 'building_archive')!;
    for (const other of sim.agents.values()) {
      if (other.id !== agent.id) sim.setAgentState(other.id, 'idle');
    }
    sim.setAgentState(agent.id, 'waiting_for_approval');
    run(sim, 1);
    expect(sim.buildingStatus.get('building_archive')).toBe('approval');
  });

  it('emits building_status_changed on transitions', () => {
    const { sim, bus } = makeSim();
    const changes: string[] = [];
    bus.on('building_status_changed', (e) => changes.push(e.payload.new_status));
    run(sim, 120);
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe('rebuild', () => {
  it('rescues agents stranded inside a newly placed building', () => {
    const { sim } = makeSim();
    run(sim, 30);

    const agent = [...sim.agents.values()][0];
    // Drop the agent into a reflecting pool, which is never walkable.
    const doc = createDefaultCampus();
    const pool = doc.water[0];
    agent.pos = { x: pool.x + 1.5, y: pool.y + 1.5 };

    sim.rebuild(doc);

    const stillInWater =
      agent.pos.x >= pool.x &&
      agent.pos.x < pool.x + pool.w &&
      agent.pos.y >= pool.y &&
      agent.pos.y < pool.y + pool.h;
    expect(stillInWater).toBe(false);
  });

  it('drops runtimes for agents removed from the document', () => {
    const doc = createDefaultCampus();
    const { sim } = makeSim(doc);
    const removedId = doc.agents[0].id;

    const next = createDefaultCampus();
    next.agents = next.agents.filter((a) => a.id !== removedId);
    sim.rebuild(next);

    expect(sim.agents.has(removedId)).toBe(false);
    expect(sim.agents.size).toBe(next.agents.length);
  });
});

describe('snapshot', () => {
  it('reports an activity level inside 0..1', () => {
    const { sim } = makeSim();
    for (let i = 0; i < 40; i++) {
      run(sim, 10);
      const s = sim.snapshot();
      expect(s.activityLevel).toBeGreaterThanOrEqual(0);
      expect(s.activityLevel).toBeLessThanOrEqual(1);
    }
  });

  it('mirrors mode, agents, tasks and approvals', () => {
    const { sim } = makeSim();
    run(sim, 90);
    const s = sim.snapshot();
    expect(s.mode).toBe('running');
    expect(s.agents.length).toBe(sim.agents.size);
    expect(s.tasks.length).toBe(sim.tasks.size);
    expect(s.approvals.every((t) => t.stage === 'approval')).toBe(true);
  });
});

describe('humanState', () => {
  it('labels every declared state', () => {
    for (const state of AGENT_STATES) {
      const label = humanState(state);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain('_');
    }
  });
});
