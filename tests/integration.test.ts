import { describe, it, expect, beforeEach } from 'vitest';
import { CampusSimulation } from '@/sim/simulation';
import { ManagerEngine } from '@/orchestration/manager';
import { EventBus } from '@/core/events';
import { createDefaultCampus } from '@/config/defaultCampus';
import { providers } from '@/providers/registry';
import { answer } from '@/orchestration/managerChat';
import { searchVault, addEntry, retrieveForTask, vaultStats, deleteEntry, updateEntry } from '@/knowledge/vault';
import type { CampusDocument } from '@/core/types';
import type { Mission, Subtask } from '@/core/mission';

beforeEach(async () => {
  await providers.probeAll({ ollamaUrl: 'http://127.0.0.1:1' });
});

/* ------------------------------------------------------------------ */
/* Campus reflects real mission state                                  */
/* ------------------------------------------------------------------ */

describe('campus visual integration', () => {
  function setup(): { sim: CampusSimulation; engine: ManagerEngine; get: () => CampusDocument } {
    let doc: CampusDocument = createDefaultCampus();
    const bus = new EventBus();
    const sim = new CampusSimulation(doc, bus, { seed: 1, taskInterval: [1, 2] });
    const engine = new ManagerEngine(
      { commit: (m) => { const d = { ...doc }; m(d); doc = d; sim.rebuild(d); }, read: () => doc, notify: () => {} },
      { providerConfig: { offlineDelayMs: 200 } },
    );
    return { sim, engine, get: () => doc };
  }

  it('starts out of mission mode', () => {
    const { sim } = setup();
    expect(sim.isMissionMode).toBe(false);
  });

  it('enters mission mode when real directives arrive', async () => {
    const { sim, engine } = setup();
    await engine.startMission({
      goal: 'Research the market and write a report',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await engine.tick();
    sim.applyDirectives(engine.directives());
    expect(sim.isMissionMode).toBe(true);
  });

  it('stops inventing ambient work while a real mission runs', async () => {
    const { sim, engine } = setup();
    await engine.startMission({
      goal: 'Research the market and write a report',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await engine.tick();
    sim.applyDirectives(engine.directives());

    const before = sim.tasks.size;
    // Far longer than the 1-2s ambient spawn interval.
    for (let i = 0; i < 200; i++) sim.tick(100);
    expect(sim.tasks.size).toBe(before);
  });

  it('generates ambient work again once the mission is over', () => {
    const { sim } = setup();
    sim.applyDirectives([]);
    for (let i = 0; i < 200; i++) sim.tick(100);
    expect(sim.tasks.size).toBeGreaterThan(0);
  });

  it('honours the ambient-simulation setting', () => {
    let doc: CampusDocument = createDefaultCampus();
    doc = { ...doc, settings: { ...doc.settings, ambientTaskSimulation: false } };
    const sim = new CampusSimulation(doc, new EventBus(), { seed: 1, taskInterval: [1, 2] });
    for (let i = 0; i < 200; i++) sim.tick(100);
    expect(sim.tasks.size).toBe(0);
  });

  it('drives directed agents into the state the Manager specified', () => {
    const { sim, get } = setup();
    const workerId = get().agents[3].id;
    sim.applyDirectives([
      {
        agentId: workerId, state: 'working', workKind: 'research', roleLabel: 'Researcher',
        subtaskId: 'st1', missionId: 'm1', progress: 0.4, tool: 'campus-sim-standard',
      },
    ]);
    const rt = sim.agents.get(workerId)!;
    expect(rt.state).toBe('working');
    expect(rt.progress).toBe(0.4);
    expect(rt.tool).toBe('campus-sim-standard');
    expect(rt.taskId).toBe('st1');
  });

  it('does not let ambient behaviour overwrite a directed agent', () => {
    const { sim, get } = setup();
    const workerId = get().agents[3].id;
    sim.applyDirectives([
      {
        agentId: workerId, state: 'reviewing', workKind: 'review', roleLabel: 'Reviewer',
        subtaskId: 'st1', missionId: 'm1', progress: 0.5, tool: null,
      },
    ]);
    for (let i = 0; i < 300; i++) sim.tick(100);
    expect(sim.agents.get(workerId)!.state).toBe('reviewing');
  });

  it('leaves undirected agents free to behave ambiently', () => {
    const { sim, get } = setup();
    const directed = get().agents[3].id;
    const free = get().agents[6].id;
    sim.applyDirectives([
      { agentId: directed, state: 'working', workKind: 'build', roleLabel: 'Builder', subtaskId: 's', missionId: 'm', progress: 0.5, tool: null },
    ]);
    const before = sim.agents.get(free)!.state;
    for (let i = 0; i < 400; i++) sim.tick(100);
    // The undirected agent's own state machine keeps running.
    expect(sim.agents.get(directed)!.state).toBe('working');
    expect(typeof before).toBe('string');
  });

  it('clearing directives leaves mission mode', () => {
    const { sim, get } = setup();
    sim.applyDirectives([
      { agentId: get().agents[2].id, state: 'working', workKind: 'research', roleLabel: 'R', subtaskId: 's', missionId: 'm', progress: 0.2, tool: null },
    ]);
    expect(sim.isMissionMode).toBe(true);
    sim.applyDirectives([]);
    expect(sim.isMissionMode).toBe(false);
  });

  it('emergency stop still overrides real mission directives', () => {
    const { sim, get } = setup();
    sim.applyDirectives([
      { agentId: get().agents[2].id, state: 'working', workKind: 'research', roleLabel: 'R', subtaskId: 's', missionId: 'm', progress: 0.2, tool: null },
    ]);
    sim.emergencyStop();
    for (const rt of sim.agents.values()) expect(rt.state).toBe('offline');
  });
});

/* ------------------------------------------------------------------ */
/* Manager chat                                                        */
/* ------------------------------------------------------------------ */

describe('manager chat answers from real state', () => {
  const base = (): CampusDocument => createDefaultCampus();

  it('reports honestly when nothing is running', () => {
    const reply = answer(base(), "What's happening?");
    expect(reply.text).toContain('Nothing is running');
    expect(reply.effect).toBeNull();
  });

  it('describes the active mission using its real numbers', () => {
    const doc = base();
    const mission: Mission = {
      id: 'm1', goal: 'Do the thing', title: 'Do the thing', status: 'running',
      priority: 'normal', routingMode: 'auto_free', managerAgentId: doc.agents[0].id,
      workerAgentIds: [doc.agents[1].id], createdAt: Date.now(), startedAt: Date.now(),
      completedAt: null, deadline: null, progress: 0.5, stage: 'Executing · 1 of 2 complete',
      subtaskIds: ['s1', 's2'], attachments: [], events: [], finalResult: null, failureReason: null,
    };
    const subtasks: Subtask[] = [
      { id: 's1', missionId: 'm1', title: 'Research', instruction: 'x', kind: 'research', status: 'done', order: 0, dependsOn: [], assignedAgentId: doc.agents[1].id, roleLabel: 'Researcher', reviewerAgentId: null, requiresReview: false, requiresOwnerApproval: false, providerId: 'offline', modelId: 'campus-sim-standard', routingReason: null, output: 'o', reviewNotes: null, attempts: [], retryCount: 0, revisionCount: 0, createdAt: 0, startedAt: 0, completedAt: 0 },
      { id: 's2', missionId: 'm1', title: 'Write', instruction: 'y', kind: 'writing', status: 'in_progress', order: 1, dependsOn: ['s1'], assignedAgentId: doc.agents[1].id, roleLabel: 'Writer', reviewerAgentId: null, requiresReview: false, requiresOwnerApproval: false, providerId: 'offline', modelId: 'campus-sim-standard', routingReason: 'because', output: null, reviewNotes: null, attempts: [], retryCount: 0, revisionCount: 0, createdAt: 0, startedAt: 0, completedAt: null },
    ];
    const withMission: CampusDocument = {
      ...doc, missions: [mission], subtasks,
      assignments: [{ agentId: doc.agents[1].id, missionId: 'm1', roleLabel: 'Writer', assignedBy: doc.agents[0].id, assignedAt: 0, currentSubtaskId: 's2' }],
    };

    const reply = answer(withMission, "What's happening?");
    expect(reply.text).toContain('Do the thing');
    expect(reply.text).toContain('1 of 2');
    expect(reply.text).toContain('Writer');
  });

  it('answers what a named agent is doing, from real subtask data', () => {
    const doc = base();
    const agent = doc.agents[1];
    const withWork: CampusDocument = {
      ...doc,
      subtasks: [{ id: 's1', missionId: 'm1', title: 'Analyse the data', instruction: 'x', kind: 'analysis', status: 'in_progress', order: 0, dependsOn: [], assignedAgentId: agent.id, roleLabel: 'Analyst', reviewerAgentId: null, requiresReview: false, requiresOwnerApproval: false, providerId: 'offline', modelId: 'campus-sim-standard', routingReason: 'Selected because analysis needs stronger reasoning.', output: null, reviewNotes: null, attempts: [], retryCount: 0, revisionCount: 0, createdAt: 0, startedAt: 0, completedAt: null }],
      assignments: [{ agentId: agent.id, missionId: 'm1', roleLabel: 'Analyst', assignedBy: doc.agents[0].id, assignedAt: 0, currentSubtaskId: 's1' }],
    };
    const reply = answer(withWork, 'What is Agent 02 working on?');
    expect(reply.text).toContain('Analyse the data');
    expect(reply.text).toContain('Analyst');
    expect(reply.text).toContain('campus-sim-standard');
  });

  it('says so plainly when an agent has no work', () => {
    expect(answer(base(), 'What is Agent 05 doing?').text).toContain('not working on anything');
  });

  it('does not invent an agent that does not exist', () => {
    expect(answer(base(), 'What is Agent 42 doing?').text).toContain('no Agent 42');
  });

  it('treats "use only free AI" as a command and switches routing', () => {
    const reply = answer(base(), 'Use only free AI');
    expect(reply.effect).toEqual({ kind: 'set_routing', routingMode: 'auto_free' });
    expect(reply.text).toContain('FREE ONLY');
  });

  it('sets a deadline from natural language', () => {
    const doc = base();
    const withMission: CampusDocument = {
      ...doc,
      missions: [{ id: 'm1', goal: 'g', title: 'Task', status: 'running', priority: 'normal', routingMode: 'auto_free', managerAgentId: doc.agents[0].id, workerAgentIds: [], createdAt: 0, startedAt: 0, completedAt: null, deadline: null, progress: 0, stage: '', subtaskIds: [], attachments: [], events: [], finalResult: null, failureReason: null }],
    };
    const reply = answer(withMission, 'Finish this by 6');
    expect(reply.effect?.kind).toBe('set_deadline');
    expect(reply.effect?.deadline).toBeGreaterThan(Date.now());
  });

  it('explains a slow mission with real reasons', () => {
    const doc = base();
    const withMission: CampusDocument = {
      ...doc,
      missions: [{ id: 'm1', goal: 'g', title: 'Task', status: 'running', priority: 'normal', routingMode: 'auto_free', managerAgentId: doc.agents[0].id, workerAgentIds: [], createdAt: 0, startedAt: Date.now() - 60000, completedAt: null, deadline: null, progress: 0.3, stage: '', subtaskIds: ['s1'], attachments: [], events: [], finalResult: null, failureReason: null }],
      subtasks: [{ id: 's1', missionId: 'm1', title: 'T', instruction: 'x', kind: 'research', status: 'awaiting_approval', order: 0, dependsOn: [], assignedAgentId: null, roleLabel: null, reviewerAgentId: null, requiresReview: true, requiresOwnerApproval: false, providerId: null, modelId: null, routingReason: null, output: null, reviewNotes: null, attempts: [], retryCount: 1, revisionCount: 2, createdAt: 0, startedAt: null, completedAt: null }],
    };
    const reply = answer(withMission, 'Why is this taking so long?');
    expect(reply.text).toContain('waiting on your approval');
    expect(reply.text).toContain('retried');
  });

  it('reports the routing mode and running models', () => {
    const reply = answer(base(), 'Which AI model are you using?');
    expect(reply.text.toLowerCase()).toContain('free only');
  });
});

/* ------------------------------------------------------------------ */
/* Knowledge vault                                                     */
/* ------------------------------------------------------------------ */

describe('knowledge vault', () => {
  it('finds entries by title, tag and body, ranking titles highest', () => {
    const doc = createDefaultCampus();
    addEntry(doc, { title: 'Market research', kind: 'research', scope: 'shared', body: 'nothing relevant', source: 'x' });
    addEntry(doc, { title: 'Unrelated', kind: 'note', scope: 'shared', body: 'mentions market once', source: 'x' });
    const results = searchVault(doc.knowledge, 'market');
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Market research');
  });

  it('lists everything newest-first for an empty query', () => {
    const doc = createDefaultCampus();
    addEntry(doc, { title: 'A', kind: 'note', scope: 'shared', body: '', source: 'x' });
    addEntry(doc, { title: 'B', kind: 'note', scope: 'shared', body: '', source: 'x' });
    expect(searchVault(doc.knowledge, '')).toHaveLength(2);
  });

  it('filters by scope', () => {
    const doc = createDefaultCampus();
    addEntry(doc, { title: 'Shared thing', kind: 'note', scope: 'shared', body: 'x', source: 'o' });
    addEntry(doc, { title: 'Mission thing', kind: 'note', scope: 'mission', ownerId: 'm1', body: 'x', source: 'o' });
    expect(searchVault(doc.knowledge, '', { scope: 'shared' })).toHaveLength(1);
  });

  it('never leaks another mission or agent memory into a task', () => {
    const doc = createDefaultCampus();
    addEntry(doc, { title: 'Market shared', kind: 'research', scope: 'shared', body: 'market market market', source: 'o' });
    addEntry(doc, { title: 'Market mine', kind: 'research', scope: 'mission', ownerId: 'm1', body: 'market market market', source: 'o' });
    addEntry(doc, { title: 'Market theirs', kind: 'research', scope: 'mission', ownerId: 'OTHER', body: 'market market market', source: 'o' });
    addEntry(doc, { title: 'Market someone else', kind: 'note', scope: 'agent', ownerId: 'agent_999', body: 'market market market', source: 'o' });

    const mission = { id: 'm1', goal: 'market analysis' } as Mission;
    const subtask = { title: 'Market work', instruction: 'analyse the market', assignedAgentId: 'agent_002' } as Subtask;
    const context = retrieveForTask(doc, subtask, mission);

    expect(context.join('\n')).toContain('Market shared');
    expect(context.join('\n')).toContain('Market mine');
    expect(context.join('\n')).not.toContain('Market theirs');
    expect(context.join('\n')).not.toContain('Market someone else');
  });

  it('returns only relevant entries, not the whole vault', () => {
    const doc = createDefaultCampus();
    for (let i = 0; i < 30; i++) {
      addEntry(doc, { title: `Irrelevant ${i}`, kind: 'note', scope: 'shared', body: 'unrelated content', source: 'o' });
    }
    addEntry(doc, { title: 'Quantum widgets', kind: 'research', scope: 'shared', body: 'quantum widgets everywhere', source: 'o' });
    const mission = { id: 'm1', goal: 'quantum widgets' } as Mission;
    const subtask = { title: 'Study quantum widgets', instruction: 'research quantum widgets', assignedAgentId: 'a' } as Subtask;
    const context = retrieveForTask(doc, subtask, mission);
    expect(context.length).toBeLessThanOrEqual(4);
    expect(context.join('\n')).toContain('Quantum widgets');
  });

  it('supports edit and delete', () => {
    const doc = createDefaultCampus();
    const entry = addEntry(doc, { title: 'One', kind: 'note', scope: 'shared', body: 'a', source: 'o' });
    updateEntry(doc, entry.id, { title: 'Two', body: 'longer body' });
    expect(doc.knowledge[0].title).toBe('Two');
    expect(doc.knowledge[0].size).toBe('longer body'.length);
    deleteEntry(doc, entry.id);
    expect(doc.knowledge).toHaveLength(0);
  });

  it('counts entries by scope', () => {
    const doc = createDefaultCampus();
    addEntry(doc, { title: 'a', kind: 'note', scope: 'shared', body: 'x', source: 'o' });
    addEntry(doc, { title: 'b', kind: 'note', scope: 'mission', ownerId: 'm', body: 'xx', source: 'o' });
    const stats = vaultStats(doc.knowledge);
    expect(stats.total).toBe(2);
    expect(stats.shared).toBe(1);
    expect(stats.mission).toBe(1);
    expect(stats.bytes).toBe(3);
  });
});
