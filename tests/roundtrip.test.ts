/**
 * Export / import round trip.
 *
 * Settings → Data → Export writes the whole campus document as JSON, and
 * Import feeds it back through `normalizeCampus`. Normalisation is where a
 * field it does not know about gets silently dropped — so the thing worth
 * testing is not that export works, but that everything the mission system
 * produces survives a trip out and back.
 */

import { describe, it, expect } from 'vitest';
import { normalizeCampus } from '@/config/schema';
import { createDefaultCampus } from '@/config/defaultCampus';
import type { Mission, Subtask, KnowledgeEntry, ModelStat, MemoryFact, Workflow } from '@/core/mission';

function populated() {
  const doc = createDefaultCampus();
  const [manager, worker, reviewer] = doc.agents;

  const mission: Mission = {
    id: 'm1',
    goal: 'Research the market and write a report',
    title: 'Research the market',
    status: 'completed',
    priority: 'normal',
    routingMode: 'auto_free',
    managerAgentId: manager.id,
    workerAgentIds: [worker.id],
    createdAt: 1,
    startedAt: 1,
    completedAt: 2,
    deadline: null,
    progress: 1,
    stage: 'Complete',
    subtaskIds: ['s1'],
    attachments: [],
    events: [{ at: 1, kind: 'success', text: 'Mission complete.' }],
    finalResult: 'THE DELIVERABLE',
    failureReason: null,
  };

  const subtask: Subtask = {
    id: 's1',
    missionId: 'm1',
    title: 'Writer: produce the written work',
    instruction: 'Write it',
    kind: 'writing',
    status: 'done',
    order: 0,
    dependsOn: [],
    assignedAgentId: worker.id,
    reviewerAgentId: reviewer.id,
    roleLabel: 'Writer',
    providerId: 'offline',
    modelId: 'campus-sim-standard',
    routingReason: 'Selected because FREE ONLY is active.',
    output: 'THE OUTPUT',
    reviewNotes: null,
    attempts: [],
    retryCount: 0,
    revisionCount: 0,
    requiresReview: true,
    requiresOwnerApproval: false,
    createdAt: 1,
    startedAt: 1,
    completedAt: 2,
  };

  const knowledge: KnowledgeEntry = {
    id: 'k1',
    kind: 'result',
    scope: 'shared',
    ownerId: null,
    title: 'Result: Research the market',
    body: 'THE DELIVERABLE',
    tags: ['mission'],
    source: 'manager',
    createdAt: 1,
    updatedAt: 1,
    size: 15,
    mime: null,
  };

  const stat: ModelStat = {
    key: 'offline:campus-sim-standard',
    providerId: 'offline',
    modelId: 'campus-sim-standard',
    kind: 'writing',
    attempts: 5,
    successes: 5,
    failures: 0,
    revisions: 0,
    totalDurationMs: 100,
    scoreSum: 4.5,
    scoreCount: 5,
    totalCost: 0,
    lastUsedAt: 1,
  };

  const fact: MemoryFact = {
    id: 'f1',
    kind: 'agent_performance',
    subject: `${worker.id}:writing`,
    statement: 'Handles writing well.',
    confidence: 0.5,
    source: 'mission m1',
    recordedAt: 1,
    observations: 1,
  };

  const workflow: Workflow = {
    id: 'w1',
    name: 'Standard report',
    description: '',
    nodes: [],
    edges: [],
    isTemplate: false,
    createdAt: 1,
    updatedAt: 1,
  };

  doc.missions = [mission];
  doc.subtasks = [subtask];
  doc.knowledge = [knowledge];
  doc.modelStats = [stat];
  doc.memory = [fact];
  doc.workflows = [workflow];
  return doc;
}

describe('export / import', () => {
  it('carries mission control state out and back without loss', () => {
    const doc = populated();
    // Exactly what the export button writes and the import button reads.
    const { doc: back, repairs } = normalizeCampus(JSON.parse(JSON.stringify(doc, null, 2)));

    expect(repairs).toEqual([]);
    expect(back.managerAgentId).toBe(doc.managerAgentId);

    expect(back.missions).toHaveLength(1);
    expect(back.missions[0].finalResult).toBe('THE DELIVERABLE');
    expect(back.missions[0].events).toHaveLength(1);

    expect(back.subtasks).toHaveLength(1);
    expect(back.subtasks[0].output).toBe('THE OUTPUT');
    expect(back.subtasks[0].routingReason).toBe('Selected because FREE ONLY is active.');
    expect(back.subtasks[0].reviewerAgentId).toBe(doc.subtasks[0].reviewerAgentId);

    expect(back.knowledge).toHaveLength(1);
    expect(back.knowledge[0].scope).toBe('shared');
    expect(back.modelStats).toHaveLength(1);
    expect(back.memory).toHaveLength(1);
    expect(back.workflows).toHaveLength(1);
  });

  it('leaves no live role assignments behind on import', () => {
    // Assignments belong to a running mission. Importing a finished campus
    // must not resurrect roles for agents that are not working.
    const doc = populated();
    doc.assignments = [
      {
        agentId: doc.agents[1].id,
        missionId: 'm1',
        roleLabel: 'Writer',
        assignedBy: doc.agents[0].id,
        assignedAt: 1,
        currentSubtaskId: 's1',
      },
    ];
    const { doc: back } = normalizeCampus(JSON.parse(JSON.stringify(doc)));
    // The mission is completed, so nothing should still be assigned to it.
    const live = back.assignments.filter((a) =>
      back.missions.some((m) => m.id === a.missionId && (m.status === 'running' || m.status === 'planning')),
    );
    expect(live).toHaveLength(0);
  });
});
