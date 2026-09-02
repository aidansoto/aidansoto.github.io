import { describe, it, expect, beforeEach } from 'vitest';
import { ManagerEngine, LIMITS } from '@/orchestration/manager';
import {
  planHeuristically,
  parseModelPlan,
  materialise,
  detectWorkKinds,
  deriveTitle,
} from '@/orchestration/planner';
import { rememberFact, recallFacts, effectiveConfidence, describeMemory } from '@/orchestration/memory';
import { createDefaultCampus } from '@/config/defaultCampus';
import { providers } from '@/providers/registry';
import type { CampusDocument } from '@/core/types';
import type { MemoryFact } from '@/core/mission';

/** Drive the engine until every mission settles, or the budget runs out. */
async function runToCompletion(engine: ManagerEngine, doc: () => CampusDocument, maxTicks = 600): Promise<number> {
  for (let i = 0; i < maxTicks; i++) {
    await engine.tick();
    const d = doc();
    const live = d.missions.some((m) => m.status === 'running' || m.status === 'planning');
    if (!live) return i;
    await new Promise((r) => setTimeout(r, 5));
  }
  return maxTicks;
}

/**
 * `offlineDelayMs` sets how long simulated work takes. Completion tests run at
 * full speed; tests that need to observe mid-flight state slow it down enough
 * to catch the campus mid-mission.
 */
function harness(offlineDelayMs = 1) {
  let doc: CampusDocument = createDefaultCampus();
  const notifications: Array<{ kind: string; title: string }> = [];
  const engine = new ManagerEngine(
    {
      commit: (mutate) => {
        // Mirrors the real host: mutate a draft, then swap the reference.
        const draft = { ...doc };
        mutate(draft);
        doc = draft;
      },
      read: () => doc,
      notify: (e) => notifications.push({ kind: e.kind, title: e.title }),
    },
    { providerConfig: { offlineDelayMs } },
  );
  return { engine, get: () => doc, notifications };
}

beforeEach(async () => {
  // Offline provider only — deterministic, and proves no network is needed.
  await providers.probeAll({ ollamaUrl: 'http://127.0.0.1:1' });
});

describe('planner', () => {
  it('detects the work a goal actually calls for', () => {
    const kinds = detectWorkKinds('Research the market then write a report').map((k) => k.kind);
    expect(kinds).toContain('research');
    expect(kinds).toContain('writing');
  });

  it('orders work naturally regardless of how the goal was phrased', () => {
    const kinds = detectWorkKinds('Write a summary after you research it').map((k) => k.kind);
    expect(kinds.indexOf('research')).toBeLessThan(kinds.indexOf('writing'));
  });

  it('still plans something useful for a vague goal', () => {
    const plan = planHeuristically('Handle the thing');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.source).toBe('heuristic');
  });

  it('chains steps so later work depends on earlier work', () => {
    const plan = planHeuristically('Research the topic and write an article about it');
    const withDeps = plan.steps.filter((s) => s.dependsOn.length > 0);
    expect(withDeps.length).toBeGreaterThan(0);
  });

  it('adds a consolidation step that depends on everything before it', () => {
    const plan = planHeuristically('Research the market, analyse it, and write a detailed report');
    const last = plan.steps[plan.steps.length - 1];
    expect(last.kind).toBe('summarize');
    expect(last.dependsOn.length).toBe(plan.steps.length - 1);
  });

  it('inspects an attached image before anything else', () => {
    const plan = planHeuristically('Write a description', { hasAttachments: true });
    expect(plan.steps[0].kind).toBe('vision');
  });

  it('asks for review on substantial creative work', () => {
    const plan = planHeuristically('Research this thoroughly and then write a long detailed report about the findings');
    expect(plan.steps.some((s) => s.requiresReview)).toBe(true);
  });

  it('derives a short title from a long goal', () => {
    const title = deriveTitle('a'.repeat(200));
    expect(title.length).toBeLessThanOrEqual(61);
    expect(deriveTitle('Short goal')).toBe('Short goal');
  });
});

describe('model-authored plans', () => {
  it('parses a well-formed plan', () => {
    const steps = parseModelPlan(JSON.stringify([
      { title: 'Research', instruction: 'Do research', kind: 'research', role: 'Researcher', dependsOn: [], review: false },
      { title: 'Write', instruction: 'Write it up', kind: 'writing', role: 'Writer', dependsOn: [0], review: true },
    ]))!;
    expect(steps).toHaveLength(2);
    expect(steps[1].dependsOn).toEqual([0]);
    expect(steps[1].requiresReview).toBe(true);
  });

  it('tolerates prose and code fences around the JSON', () => {
    const raw = 'Sure! Here is the plan:\n```json\n[{"title":"A","instruction":"B","kind":"research","role":"R","dependsOn":[]}]\n```\nHope that helps.';
    expect(parseModelPlan(raw)).toHaveLength(1);
  });

  it('rejects unusable output so the caller can fall back', () => {
    expect(parseModelPlan('I cannot help with that.')).toBeNull();
    expect(parseModelPlan('[]')).toBeNull();
    expect(parseModelPlan('[{"nope": true}]')).toBeNull();
  });

  it('makes dependency cycles impossible by only allowing backward links', () => {
    const steps = parseModelPlan(JSON.stringify([
      { title: 'A', instruction: 'x', kind: 'research', role: 'R', dependsOn: [1, 5, -1] },
      { title: 'B', instruction: 'y', kind: 'writing', role: 'W', dependsOn: [0] },
    ]))!;
    expect(steps[0].dependsOn).toEqual([]);
    expect(steps[1].dependsOn).toEqual([0]);
  });

  it('falls back to a safe kind for an unknown one', () => {
    const steps = parseModelPlan(JSON.stringify([
      { title: 'A', instruction: 'x', kind: 'telepathy', role: 'R', dependsOn: [] },
    ]))!;
    expect(steps[0].kind).toBe('research');
  });
});

describe('materialise', () => {
  it('creates real subtasks with dependencies resolved to ids', () => {
    const plan = planHeuristically('Research and write about it');
    const subtasks = materialise(plan, 'm1', 'm1');
    expect(subtasks.length).toBe(plan.steps.length);
    expect(subtasks[0].status).toBe('ready');
    const dependent = subtasks.find((s) => s.dependsOn.length > 0)!;
    expect(dependent.status).toBe('pending');
    expect(subtasks.some((s) => s.id === dependent.dependsOn[0])).toBe(true);
  });
});

describe('a full mission, offline and free', () => {
  it('runs from goal to delivered result', async () => {
    const { engine, get, notifications } = harness();

    const id = await engine.startMission({
      goal: 'Research the opportunity, analyse it, and write a detailed report for me',
      deadline: null,
      priority: 'normal',
      routingMode: 'auto_free',
      attachments: [],
    });
    expect(id).not.toBeNull();

    await runToCompletion(engine, get);

    const mission = get().missions.find((m) => m.id === id)!;
    expect(mission.status).toBe('completed');
    expect(mission.progress).toBe(1);
    expect(mission.finalResult).toBeTruthy();
    expect(mission.finalResult).toContain(mission.goal);
    expect(notifications.some((n) => n.kind === 'mission_complete')).toBe(true);
  }, 30000);

  it('creates genuine subtasks rather than pretending to delegate', async () => {
    const { engine, get } = harness();
    await engine.startMission({
      goal: 'Research the market and write a report',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await runToCompletion(engine, get);

    const subtasks = get().subtasks;
    expect(subtasks.length).toBeGreaterThan(1);
    // Every completed subtask has a real agent, a real model and real output.
    for (const st of subtasks.filter((s) => s.status === 'done')) {
      expect(st.assignedAgentId).toBeTruthy();
      expect(st.modelId).toBeTruthy();
      expect(st.output).toBeTruthy();
      expect(st.attempts.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('never assigns work to the Manager itself', async () => {
    const { engine, get } = harness();
    await engine.startMission({
      goal: 'Research and analyse and write and test this thoroughly',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await runToCompletion(engine, get);

    const managerId = get().managerAgentId;
    expect(get().subtasks.every((s) => s.assignedAgentId !== managerId)).toBe(true);
  }, 30000);

  it('gives workers temporary roles and clears them when the mission ends', async () => {
    const { engine, get } = harness(120);
    const id = await engine.startMission({
      goal: 'Research the topic and write a detailed report about the findings',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });

    // Mid-flight: roles exist.
    await engine.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(get().assignments.length).toBeGreaterThan(0);

    await runToCompletion(engine, get);
    // Mission over: roles are gone, agents remain.
    expect(get().assignments.filter((a) => a.missionId === id)).toHaveLength(0);
    expect(get().agents).toHaveLength(10);
  }, 30000);

  // Subtasks mostly run in sequence, so an unbalanced picker hands every step
  // to whichever agent sorts first and the other eight never work.
  it('spreads a mission across the bench instead of one agent doing everything', async () => {
    const { engine, get } = harness();
    await engine.startMission({
      goal: 'Research the market, analyse the findings, write the report, and test the result',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await runToCompletion(engine, get);

    const subtasks = get().subtasks;
    expect(subtasks.length).toBeGreaterThanOrEqual(4);

    const workers = new Set(subtasks.map((s) => s.assignedAgentId).filter(Boolean));
    expect(workers.size).toBeGreaterThan(1);

    // And no single agent carries most of the mission.
    const counts = new Map<string, number>();
    for (const s of subtasks) {
      if (s.assignedAgentId) counts.set(s.assignedAgentId, (counts.get(s.assignedAgentId) ?? 0) + 1);
    }
    const busiest = Math.max(...counts.values());
    expect(busiest).toBeLessThan(subtasks.length);

    // Reviewing is spread too, rather than falling to one permanent reviewer.
    const reviewers = new Set(subtasks.map((s) => s.reviewerAgentId).filter(Boolean));
    expect(reviewers.size).toBeGreaterThan(1);
  }, 30000);

  it('leaves permanent agent config untouched by temporary roles', async () => {
    const { engine, get } = harness();
    const before = JSON.parse(JSON.stringify(get().agents));
    await engine.startMission({
      goal: 'Research and write about the topic',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await runToCompletion(engine, get);
    expect(get().agents).toEqual(before);
  }, 30000);

  it('respects the concurrency limit', async () => {
    const { engine, get } = harness(120);
    await engine.startMission({
      goal: 'Research, analyse, plan, build, write, and test all of this',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    for (let i = 0; i < 6; i++) {
      await engine.tick();
      const inFlight = get().subtasks.filter((s) => s.status === 'in_progress').length;
      expect(inFlight).toBeLessThanOrEqual(LIMITS.maxConcurrent);
      await new Promise((r) => setTimeout(r, 5));
    }
  }, 30000);

  it('records model performance as it goes', async () => {
    const { engine, get } = harness();
    await engine.startMission({
      goal: 'Research the market and write a report',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await runToCompletion(engine, get);
    expect(get().modelStats.length).toBeGreaterThan(0);
    // Free provider: cost must be zero everywhere.
    expect(get().modelStats.every((s) => s.totalCost === 0)).toBe(true);
  }, 30000);

  it('files the result in the knowledge vault', async () => {
    const { engine, get } = harness();
    await engine.startMission({
      goal: 'Research the market and write a report',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await runToCompletion(engine, get);
    expect(get().knowledge.some((k) => k.kind === 'result')).toBe(true);
  }, 30000);

  it('respects dependency order — nothing starts before its inputs are done', async () => {
    const { engine, get } = harness();
    await engine.startMission({
      goal: 'Research the topic then analyse it then write it up',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });

    for (let i = 0; i < 100; i++) {
      await engine.tick();
      const d = get();
      const byId = new Map(d.subtasks.map((s) => [s.id, s]));
      for (const st of d.subtasks) {
        if (['in_progress', 'done'].includes(st.status)) {
          for (const dep of st.dependsOn) {
            expect(byId.get(dep)?.status, `${st.title} started before ${dep}`).toBe('done');
          }
        }
      }
      if (!d.missions.some((m) => m.status === 'running' || m.status === 'planning')) break;
      await new Promise((r) => setTimeout(r, 5));
    }
  }, 30000);
});

describe('owner controls', () => {
  it('cancels a mission and releases its agents', async () => {
    const { engine, get } = harness(120);
    const id = await engine.startMission({
      goal: 'Research and write a long report about the topic',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await engine.tick();
    engine.cancelMission(id!);

    const mission = get().missions.find((m) => m.id === id)!;
    expect(mission.status).toBe('cancelled');
    expect(get().assignments.filter((a) => a.missionId === id)).toHaveLength(0);
    expect(get().subtasks.filter((s) => s.missionId === id).every((s) => ['cancelled', 'done', 'failed'].includes(s.status))).toBe(true);
  }, 30000);

  it('abortAll stops in-flight work', async () => {
    const { engine } = harness(120);
    await engine.startMission({
      goal: 'Research and write about this',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await engine.tick();
    expect(() => engine.abortAll()).not.toThrow();
  }, 30000);

  it('reports attention items for failed work', async () => {
    const { engine, get } = harness(120);
    await engine.startMission({
      goal: 'Research and write about this',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await engine.tick();
    // Force a failure state the owner should see.
    const st = get().subtasks[0];
    st.status = 'failed';
    st.reviewNotes = 'exploded';
    const items = engine.attention();
    expect(items.some((i) => i.kind === 'failure')).toBe(true);
  }, 30000);

  it('produces campus directives that mirror real subtask state', async () => {
    const { engine, get } = harness(120);
    await engine.startMission({
      goal: 'Research and write about this',
      deadline: null, priority: 'normal', routingMode: 'auto_free', attachments: [],
    });
    await engine.tick();
    await new Promise((r) => setTimeout(r, 20));

    const directives = engine.directives();
    expect(directives.length).toBeGreaterThan(0);
    // The Manager is always visibly coordinating during a live mission.
    expect(directives.some((d) => d.agentId === get().managerAgentId)).toBe(true);
    // Every worker directive corresponds to a real subtask.
    for (const d of directives.filter((x) => x.subtaskId)) {
      expect(get().subtasks.some((s) => s.id === d.subtaskId)).toBe(true);
    }
  }, 30000);

  it('emits no directives when nothing is running', () => {
    const { engine } = harness();
    expect(engine.directives()).toEqual([]);
  });
});

describe('manager memory', () => {
  it('reinforces a repeated observation instead of duplicating it', () => {
    let facts: MemoryFact[] = [];
    facts = rememberFact(facts, { kind: 'agent_performance', subject: 'a1:research', statement: 'Good at research.', confidence: 0.5, source: 'm1' });
    const first = facts[0].confidence;
    facts = rememberFact(facts, { kind: 'agent_performance', subject: 'a1:research', statement: 'Good at research.', confidence: 0.5, source: 'm2' });
    expect(facts).toHaveLength(1);
    expect(facts[0].observations).toBe(2);
    expect(facts[0].confidence).toBeGreaterThan(first);
  });

  it('never reaches absolute certainty', () => {
    let facts: MemoryFact[] = [];
    for (let i = 0; i < 50; i++) {
      facts = rememberFact(facts, { kind: 'model_performance', subject: 'm', statement: 's', confidence: 1, source: 'x' });
    }
    expect(facts[0].confidence).toBeLessThanOrEqual(0.95);
  });

  it('decays a stale one-off observation', () => {
    const old: MemoryFact = {
      id: 'f1', kind: 'failure', subject: 's', statement: 'x', confidence: 0.8,
      source: 'old', recordedAt: Date.now() - 120 * 24 * 60 * 60 * 1000, observations: 1,
    };
    expect(effectiveConfidence(old)).toBeLessThan(0.8);
  });

  it('lets repeatedly observed patterns resist decay', () => {
    const base = { kind: 'failure' as const, subject: 's', statement: 'x', confidence: 0.8, source: 'o', recordedAt: Date.now() - 120 * 24 * 60 * 60 * 1000 };
    const once: MemoryFact = { ...base, id: 'a', observations: 1 };
    const often: MemoryFact = { ...base, id: 'b', observations: 10 };
    expect(effectiveConfidence(often)).toBeGreaterThan(effectiveConfidence(once));
  });

  it('stops recalling facts that have decayed away', () => {
    const ancient: MemoryFact = {
      id: 'f', kind: 'failure', subject: 's', statement: 'x', confidence: 0.2,
      source: 'o', recordedAt: Date.now() - 365 * 24 * 60 * 60 * 1000, observations: 1,
    };
    expect(recallFacts([ancient])).toHaveLength(0);
  });

  it('describes memory with age, source and confidence', () => {
    let facts: MemoryFact[] = [];
    facts = rememberFact(facts, { kind: 'owner_preference', subject: 'p', statement: 'Prefers free models.', confidence: 0.8, source: 'settings' });
    const lines = describeMemory(facts);
    expect(lines[0]).toContain('Prefers free models.');
    expect(lines[0]).toContain('confidence');
    expect(lines[0]).toContain('settings');
  });
});
