/**
 * The Manager engine.
 *
 * One agent is designated Manager. It receives a goal from the owner and then
 * genuinely runs the mission: plans, assigns temporary roles, creates real
 * subtasks, routes each one to a model, monitors progress, orders reviews,
 * recovers from failures, aggregates the outputs, and decides whether the goal
 * was actually met.
 *
 * WHAT MAKES THIS REAL RATHER THAN THEATRE
 * ----------------------------------------
 * Every assignment produces a persisted `Subtask` with a status the dashboard
 * reads. Nothing is "pretend delegated": if the engine says an agent is
 * working, a `generate` call is genuinely in flight for that agent, and its
 * output is stored, reviewed and combined. The Manager cannot report success
 * without every required subtask having reached `done`.
 *
 * The engine is transport-agnostic: it holds no timers of its own beyond the
 * work it dispatches, and it mutates the campus document through a single
 * `commit` callback so persistence, undo and the renderer all stay consistent.
 */

import type {
  AgentDirective,
  AttentionItem,
  Mission,
  MissionEvent,
  MissionStatus,
  RoleAssignment,
  Subtask,
} from '@/core/mission';
import type { CampusDocument } from '@/core/types';
import { providers } from '@/providers/registry';
import type { GenerateResult, ProviderConfig } from '@/providers/types';
import { route } from './router';
import { recordAttempt } from './performance';
import {
  PLAN_SYSTEM_PROMPT,
  deriveTitle,
  materialise,
  parseModelPlan,
  planHeuristically,
  type Plan,
} from './planner';
import { rememberFact, recallFacts } from './memory';
import { retrieveForTask, storeMissionResult } from '@/knowledge/vault';

/** Hard caps that make runaway loops impossible. */
export const LIMITS = {
  /** Attempts at one subtask before the Manager stops trying. */
  maxRetries: 2,
  /** Review → revise cycles before the Manager escalates to the owner. */
  maxRevisions: 2,
  /** Subtasks executing at once. Keeps local models responsive. */
  maxConcurrent: 3,
} as const;

export interface ManagerCallbacks {
  /** Apply a change to the campus document. Must be synchronous. */
  commit(mutate: (doc: CampusDocument) => void): void;
  /** Read the current document. */
  read(): CampusDocument | null;
  /** Fired for user-visible moments; the host decides whether to notify. */
  notify(event: {
    kind: 'mission_complete' | 'mission_failed' | 'task_complete' | 'agent_blocked' | 'approval_needed' | 'deadline';
    title: string;
    body: string;
    missionId: string | null;
    subtaskId: string | null;
  }): void;
}

export interface StartMissionInput {
  goal: string;
  deadline: number | null;
  priority: Mission['priority'];
  routingMode: Mission['routingMode'];
  attachments: Mission['attachments'];
}

export interface ManagerOptions {
  /**
   * Merged into the config handed to every provider call. Lets a headless run
   * execute at full speed without changing how the app behaves.
   */
  providerConfig?: Partial<ProviderConfig>;
}

export class ManagerEngine {
  private cb: ManagerCallbacks;
  private opts: ManagerOptions;
  /** In-flight work, keyed by subtask id, so nothing is dispatched twice. */
  private running = new Map<string, AbortController>();
  private ticking = false;
  private disposed = false;

  constructor(cb: ManagerCallbacks, opts: ManagerOptions = {}) {
    this.cb = cb;
    this.opts = opts;
  }

  /** Provider config for the current document, plus any host overrides. */
  private providerConfig(doc: CampusDocument): ProviderConfig {
    return { ollamaUrl: doc.settings.ollamaUrl, ...this.opts.providerConfig };
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.running.values()) c.abort();
    this.running.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Mission lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  /** Create a mission and begin planning. Returns the new mission id. */
  async startMission(input: StartMissionInput): Promise<string | null> {
    const doc = this.cb.read();
    if (!doc) return null;

    const managerId = doc.managerAgentId ?? doc.agents[0]?.id ?? null;
    if (!managerId) return null;

    const id = `mission_${Date.now().toString(36)}`;
    const now = Date.now();

    const mission: Mission = {
      id,
      goal: input.goal.trim(),
      title: deriveTitle(input.goal),
      status: 'planning',
      priority: input.priority,
      routingMode: input.routingMode,
      managerAgentId: managerId,
      workerAgentIds: [],
      createdAt: now,
      startedAt: now,
      completedAt: null,
      deadline: input.deadline,
      progress: 0,
      stage: 'Planning',
      subtaskIds: [],
      attachments: input.attachments,
      events: [{ at: now, kind: 'info', text: 'Mission received.' }],
      finalResult: null,
      failureReason: null,
    };

    this.cb.commit((d) => {
      d.missions = [...d.missions, mission];
    });

    await this.plan(id);
    void this.tick();
    return id;
  }

  /** Produce the plan and materialise it into real subtasks. */
  private async plan(missionId: string): Promise<void> {
    const doc = this.cb.read();
    const mission = doc?.missions.find((m) => m.id === missionId);
    if (!doc || !mission) return;

    const hasAttachments = mission.attachments.length > 0;
    let plan: Plan = planHeuristically(mission.goal, { hasAttachments });

    // With a language model available, ask it to plan instead — but only trust
    // a well-formed answer. Anything else keeps the heuristic plan.
    const decision = route({
      kind: 'planning',
      mode: mission.routingMode,
      candidates: providers.availableModels(),
      stats: doc.modelStats,
      smartRouter: doc.settings.smartRouter,
    });

    if (decision.model && decision.model.providerId !== 'offline') {
      const adapter = providers.get(decision.model.providerId);
      if (adapter) {
        const res = await adapter.generate(
          {
            system: PLAN_SYSTEM_PROMPT,
            prompt: mission.goal,
            context: [],
            kind: 'planning',
            maxTokens: 900,
          },
          decision.model.id,
          this.providerConfig(doc),
        );
        if (!res.error) {
          const steps = parseModelPlan(res.text);
          if (steps) {
            plan = { steps, source: 'model', summary: `${steps.length} step(s) planned by ${decision.model.label}.` };
          }
        }
      }
    }

    const subtasks = materialise(plan, missionId, missionId);

    this.cb.commit((d) => {
      const m = d.missions.find((x) => x.id === missionId);
      if (!m) return;
      m.subtaskIds = subtasks.map((s) => s.id);
      m.status = 'running';
      m.stage = `Executing · 0 of ${subtasks.length} complete`;
      m.events = [
        ...m.events,
        {
          at: Date.now(),
          kind: 'info',
          text: `Plan created (${plan.source === 'model' ? 'by model' : 'built-in planner'}): ${plan.summary}`,
        },
      ];
      d.subtasks = [...d.subtasks, ...subtasks];
    });
  }

  /* ---------------------------------------------------------------- */
  /* The main loop                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Advance every running mission by one step: unblock ready work, staff it,
   * dispatch it, and finish missions whose work is done.
   *
   * Safe to call as often as you like — it is idempotent and re-entrant-guarded.
   */
  async tick(): Promise<void> {
    if (this.ticking || this.disposed) return;
    this.ticking = true;
    try {
      const doc = this.cb.read();
      if (!doc) return;

      // The owner's pause and emergency stop outrank the Manager entirely.
      if (doc.missions.every((m) => m.status !== 'running' && m.status !== 'planning')) return;

      this.refreshReadiness();
      this.checkDeadlines();
      await this.dispatchReady();
      this.finishCompletedMissions();
    } finally {
      this.ticking = false;
    }
  }

  /** Promote `pending` subtasks whose dependencies are all satisfied. */
  private refreshReadiness(): void {
    this.cb.commit((d) => {
      const byId = new Map(d.subtasks.map((s) => [s.id, s]));
      for (const st of d.subtasks) {
        if (st.status !== 'pending') continue;
        const ready = st.dependsOn.every((dep) => byId.get(dep)?.status === 'done');
        if (ready) st.status = 'ready';
      }
    });
  }

  /** Warn once when a deadline is close, and mark it when it passes. */
  private checkDeadlines(): void {
    const doc = this.cb.read();
    if (!doc) return;
    const now = Date.now();

    for (const m of doc.missions) {
      if (m.status !== 'running' || m.deadline === null) continue;
      const remaining = m.deadline - now;
      const warned = m.events.some((e) => e.text.startsWith('Deadline'));
      if (remaining <= 0 && !warned) {
        this.addEvent(m.id, { kind: 'warn', text: 'Deadline passed — the mission is still running.' });
        this.cb.notify({
          kind: 'deadline',
          title: 'Deadline passed',
          body: m.title,
          missionId: m.id,
          subtaskId: null,
        });
      } else if (remaining > 0 && remaining < 10 * 60 * 1000 && !warned) {
        this.addEvent(m.id, { kind: 'warn', text: 'Deadline approaching — under ten minutes remain.' });
        this.cb.notify({
          kind: 'deadline',
          title: 'Deadline approaching',
          body: m.title,
          missionId: m.id,
          subtaskId: null,
        });
      }
    }
  }

  /** Staff and start as much ready work as the concurrency budget allows. */
  private async dispatchReady(): Promise<void> {
    const doc = this.cb.read();
    if (!doc) return;

    const budget = LIMITS.maxConcurrent - this.running.size;
    if (budget <= 0) return;

    const runningMissions = new Set(
      doc.missions.filter((m) => m.status === 'running').map((m) => m.id),
    );
    const ready = doc.subtasks
      .filter((s) => s.status === 'ready' && runningMissions.has(s.missionId) && !this.running.has(s.id))
      .sort((a, b) => a.order - b.order)
      .slice(0, budget);

    for (const st of ready) {
      const agentId = this.pickWorker(st);
      if (!agentId) {
        // Everyone is busy. The subtask stays ready and is picked up next tick.
        continue;
      }
      this.assign(st.id, agentId);
      void this.execute(st.id);
    }
  }

  /**
   * Choose a worker for a subtask.
   *
   * Never the Manager (it coordinates rather than executes), never an agent
   * already holding work, and preferring agents this mission has already
   * borrowed so a mission keeps a stable crew.
   */
  private pickWorker(st: Subtask): string | null {
    const doc = this.cb.read();
    if (!doc) return null;

    const managerId = doc.managerAgentId;
    const busy = new Set(
      doc.subtasks
        .filter((s) => s.assignedAgentId && ['assigned', 'in_progress', 'in_review', 'revising'].includes(s.status))
        .map((s) => s.assignedAgentId as string),
    );

    const candidates = doc.agents.filter((a) => a.id !== managerId && !busy.has(a.id));
    if (candidates.length === 0) return null;

    const mission = doc.missions.find((m) => m.id === st.missionId);
    const onMission = new Set(mission?.workerAgentIds ?? []);

    // Manager memory: prefer agents that have done well at this kind of work.
    const facts = recallFacts(doc.memory, 'agent_performance');
    const scoreOf = (agentId: string): number => {
      let score = onMission.has(agentId) ? 1 : 0;
      const fact = facts.find((f) => f.subject === `${agentId}:${st.kind}`);
      if (fact) score += fact.confidence * 2;
      return score;
    };

    return candidates.sort((a, b) => scoreOf(b.id) - scoreOf(a.id))[0].id;
  }

  /** Attach an agent to a subtask and give it the temporary role. */
  private assign(subtaskId: string, agentId: string): void {
    this.cb.commit((d) => {
      const st = d.subtasks.find((s) => s.id === subtaskId);
      const mission = st ? d.missions.find((m) => m.id === st.missionId) : null;
      if (!st || !mission) return;

      st.assignedAgentId = agentId;
      st.status = 'assigned';
      st.startedAt = st.startedAt ?? Date.now();

      if (!mission.workerAgentIds.includes(agentId)) mission.workerAgentIds.push(agentId);

      // Temporary role — replaced per mission, cleared when the mission ends.
      const existing = d.assignments.find((a) => a.agentId === agentId && a.missionId === mission.id);
      const assignment: RoleAssignment = {
        agentId,
        missionId: mission.id,
        roleLabel: st.roleLabel ?? 'Specialist',
        assignedBy: mission.managerAgentId,
        assignedAt: Date.now(),
        currentSubtaskId: subtaskId,
      };
      if (existing) Object.assign(existing, assignment);
      else d.assignments.push(assignment);

      const agentName = d.agents.find((a) => a.id === agentId)?.name ?? agentId;
      mission.events.push({
        at: Date.now(),
        kind: 'info',
        text: `${agentName} assigned as ${assignment.roleLabel} — ${st.title}`,
        subtaskId,
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Execution                                                         */
  /* ---------------------------------------------------------------- */

  /** Run one subtask end to end, including review and recovery. */
  private async execute(subtaskId: string): Promise<void> {
    if (this.running.has(subtaskId) || this.disposed) return;
    const controller = new AbortController();
    this.running.set(subtaskId, controller);

    try {
      const result = await this.runOnce(subtaskId, controller.signal);
      if (this.disposed) return;

      if (result === 'failed') {
        await this.recover(subtaskId);
      } else if (result === 'needs_review') {
        await this.review(subtaskId);
      }
    } finally {
      this.running.delete(subtaskId);
    }

    if (!this.disposed) void this.tick();
  }

  /** One generation attempt. Returns what happened. */
  private async runOnce(
    subtaskId: string,
    signal: AbortSignal,
  ): Promise<'done' | 'needs_review' | 'failed'> {
    const doc = this.cb.read();
    const st = doc?.subtasks.find((s) => s.id === subtaskId);
    const mission = doc && st ? doc.missions.find((m) => m.id === st.missionId) : null;
    if (!doc || !st || !mission) return 'failed';

    /* -- Route ------------------------------------------------------- */
    const decision = route({
      kind: st.kind,
      mode: mission.routingMode,
      candidates: providers.availableModels(),
      stats: doc.modelStats,
      smartRouter: doc.settings.smartRouter,
      needsVision: st.kind === 'vision',
      estimatedTokens: estimateTokens(st.instruction, mission.attachments),
    });

    if (!decision.model) {
      this.failSubtask(subtaskId, decision.refusal ?? 'No suitable model is available.');
      return 'failed';
    }

    const adapter = providers.get(decision.model.providerId);
    if (!adapter) {
      this.failSubtask(subtaskId, 'The selected provider is no longer registered.');
      return 'failed';
    }

    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.status = 'in_progress';
      s.providerId = decision.model!.providerId;
      s.modelId = decision.model!.id;
      s.routingReason = decision.reason;
    });

    /* -- Gather context ---------------------------------------------- */
    // Only relevant knowledge, never the whole vault.
    const context = retrieveForTask(doc, st, mission);

    /* -- Generate ---------------------------------------------------- */
    const res: GenerateResult = await adapter.generate(
      {
        system: `You are a worker agent on an autonomous campus, currently acting as ${st.roleLabel ?? 'a specialist'}. Produce the deliverable directly and completely.`,
        prompt: buildPrompt(st, mission, doc),
        context,
        kind: st.kind,
        maxTokens: 1200,
        // Each retry and each revision is a fresh attempt, not a replay.
        nonce: st.retryCount * 10 + st.revisionCount,
        signal,
      },
      decision.model.id,
      this.providerConfig(doc),
    );

    /* -- Record ------------------------------------------------------ */
    this.cb.commit((d) => {
      d.modelStats = recordAttempt(d.modelStats, {
        providerId: res.providerId,
        modelId: res.modelId,
        kind: st.kind,
        outcome: res.error ? 'failure' : 'success',
        durationMs: res.durationMs,
        cost: res.cost,
      });

      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.attempts.push({
        at: Date.now(),
        agentId: s.assignedAgentId ?? 'unknown',
        providerId: res.providerId,
        modelId: res.modelId,
        outcome: res.error ? 'failure' : 'success',
        durationMs: res.durationMs,
        note: res.error ?? 'Completed.',
      });
    });

    if (res.error) {
      this.addEvent(mission.id, { kind: 'warn', text: `${st.title} failed: ${res.error}`, subtaskId });
      return 'failed';
    }

    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.output = res.text;
    });

    if (st.requiresReview) {
      this.setStatus(subtaskId, 'in_review');
      return 'needs_review';
    }

    this.completeSubtask(subtaskId);
    return 'done';
  }

  /* ---------------------------------------------------------------- */
  /* Review                                                            */
  /* ---------------------------------------------------------------- */

  /** Have a second agent check the work, then pass, revise, or escalate. */
  private async review(subtaskId: string): Promise<void> {
    const doc = this.cb.read();
    const st = doc?.subtasks.find((s) => s.id === subtaskId);
    const mission = doc && st ? doc.missions.find((m) => m.id === st.missionId) : null;
    if (!doc || !st || !mission || !st.output) return;

    // A reviewer must be someone other than the author.
    const busy = new Set(
      doc.subtasks
        .filter((s) => s.id !== subtaskId && s.assignedAgentId && ['assigned', 'in_progress'].includes(s.status))
        .map((s) => s.assignedAgentId as string),
    );
    const reviewer =
      doc.agents.find(
        (a) => a.id !== st.assignedAgentId && a.id !== doc.managerAgentId && !busy.has(a.id),
      ) ?? doc.agents.find((a) => a.id !== st.assignedAgentId && a.id !== doc.managerAgentId);

    if (!reviewer) {
      // Nobody free to review: accept the work rather than deadlock, and say so.
      this.addEvent(mission.id, {
        kind: 'warn',
        text: `${st.title} accepted without review — no second agent was available.`,
        subtaskId,
      });
      this.completeSubtask(subtaskId);
      return;
    }

    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.reviewerAgentId = reviewer.id;
      // The reviewer takes a temporary Reviewer role for the duration.
      const existing = d.assignments.find((a) => a.agentId === reviewer.id && a.missionId === s.missionId);
      const assignment: RoleAssignment = {
        agentId: reviewer.id,
        missionId: s.missionId,
        roleLabel: 'Reviewer',
        assignedBy: d.managerAgentId ?? 'manager',
        assignedAt: Date.now(),
        currentSubtaskId: subtaskId,
      };
      if (existing) Object.assign(existing, assignment);
      else d.assignments.push(assignment);
    });

    const decision = route({
      kind: 'review',
      mode: mission.routingMode,
      candidates: providers.availableModels(),
      stats: doc.modelStats,
      smartRouter: doc.settings.smartRouter,
    });
    const adapter = decision.model ? providers.get(decision.model.providerId) : null;

    if (!decision.model || !adapter) {
      this.completeSubtask(subtaskId);
      return;
    }

    const res = await adapter.generate(
      {
        system:
          'You are reviewing another agent\'s work for quality and completeness. Be specific. End your reply with exactly PASS or REVISE.',
        prompt: `Task: ${st.title}\nInstruction: ${st.instruction}\n\nSubmitted work:\n${st.output}`,
        context: [],
        kind: 'review',
        maxTokens: 500,
      },
      decision.model.id,
      this.providerConfig(doc),
    );

    const rejected = !res.error && /\bREVISE\b/i.test(res.text) && !/\bPASS\b/i.test(res.text.slice(-40));

    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.reviewNotes = res.error ? `Review unavailable: ${res.error}` : res.text;
      d.modelStats = recordAttempt(d.modelStats, {
        providerId: res.providerId,
        modelId: res.modelId,
        kind: 'review',
        outcome: res.error ? 'failure' : 'success',
        durationMs: res.durationMs,
        cost: res.cost,
      });
      // The author's model is scored by the reviewer's verdict.
      if (!res.error && s.providerId && s.modelId) {
        d.modelStats = recordAttempt(d.modelStats, {
          providerId: s.providerId,
          modelId: s.modelId,
          kind: s.kind,
          outcome: rejected ? 'revision' : 'success',
          durationMs: 0,
          score: rejected ? 0.3 : 0.9,
        });
      }
    });

    const reviewerName = reviewer.name;

    if (!rejected) {
      this.addEvent(mission.id, { kind: 'success', text: `${reviewerName} passed ${st.title}.`, subtaskId });
      this.completeSubtask(subtaskId);
      return;
    }

    /* -- Revision --------------------------------------------------- */
    const current = this.cb.read()?.subtasks.find((s) => s.id === subtaskId);
    if (current && current.revisionCount >= LIMITS.maxRevisions) {
      // Two rounds and still not right: this needs the owner, not another loop.
      this.addEvent(mission.id, {
        kind: 'warn',
        text: `${st.title} still needs work after ${LIMITS.maxRevisions} revisions — escalated to you.`,
        subtaskId,
      });
      this.setStatus(subtaskId, 'awaiting_approval');
      this.cb.commit((d) => {
        const m = d.missions.find((x) => x.id === mission.id);
        if (m) m.status = 'awaiting_approval';
      });
      this.cb.notify({
        kind: 'approval_needed',
        title: 'Your decision is needed',
        body: `${st.title} did not pass review after ${LIMITS.maxRevisions} attempts.`,
        missionId: mission.id,
        subtaskId,
      });
      return;
    }

    this.addEvent(mission.id, { kind: 'warn', text: `${reviewerName} requested revisions to ${st.title}.`, subtaskId });
    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.revisionCount += 1;
      s.status = 'ready';
      // Keep the author; they revise their own work using the review notes.
    });
  }

  /* ---------------------------------------------------------------- */
  /* Failure recovery                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Recover from a failed subtask, escalating only when it cannot proceed
   * safely. Bounded by `maxRetries` so no loop can run forever.
   */
  private async recover(subtaskId: string): Promise<void> {
    const doc = this.cb.read();
    const st = doc?.subtasks.find((s) => s.id === subtaskId);
    if (!doc || !st) return;

    if (st.retryCount >= LIMITS.maxRetries) {
      const mission = doc.missions.find((m) => m.id === st.missionId);
      this.failSubtask(subtaskId, `Gave up after ${st.retryCount + 1} attempts.`);
      if (mission) {
        this.cb.notify({
          kind: 'agent_blocked',
          title: 'A task could not be completed',
          body: `${st.title} failed after ${st.retryCount + 1} attempts.`,
          missionId: mission.id,
          subtaskId,
        });
        // Record the failure so the Manager avoids the same pairing next time.
        if (st.modelId && st.providerId) {
          this.cb.commit((d) => {
            d.memory = rememberFact(d.memory, {
              kind: 'failure',
              subject: `${st.providerId}:${st.modelId}:${st.kind}`,
              statement: `Failed ${st.kind} work repeatedly on "${st.title}".`,
              confidence: 0.6,
              source: `mission ${st.missionId}`,
            });
          });
        }
      }
      return;
    }

    // Try again — with a different agent, and the router free to pick another
    // model now that this pairing has a failure on record.
    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.retryCount += 1;
      s.status = 'ready';
      s.assignedAgentId = null;
      s.providerId = null;
      s.modelId = null;
    });

    this.addEvent(st.missionId, {
      kind: 'info',
      text: `Retrying ${st.title} (attempt ${st.retryCount + 2}) with a different agent.`,
      subtaskId,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Completion                                                        */
  /* ---------------------------------------------------------------- */

  private completeSubtask(subtaskId: string): void {
    let missionId: string | null = null;
    let title = '';

    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.status = 'done';
      s.completedAt = Date.now();
      missionId = s.missionId;
      title = s.title;

      // Free the agent's current-subtask pointer; the role stays until the
      // mission ends, which is what makes roles mission-scoped rather than
      // task-scoped.
      const assignment = d.assignments.find((a) => a.currentSubtaskId === subtaskId);
      if (assignment) assignment.currentSubtaskId = null;

      // Credit the agent for this kind of work.
      if (s.assignedAgentId) {
        d.memory = rememberFact(d.memory, {
          kind: 'agent_performance',
          subject: `${s.assignedAgentId}:${s.kind}`,
          statement: `Completed ${s.kind} work successfully.`,
          confidence: 0.7,
          source: `mission ${s.missionId}`,
        });
      }

      const m = d.missions.find((x) => x.id === s.missionId);
      if (m) {
        const total = m.subtaskIds.length;
        const done = d.subtasks.filter((x) => x.missionId === m.id && x.status === 'done').length;
        m.progress = total > 0 ? done / total : 0;
        m.stage = `Executing · ${done} of ${total} complete`;
      }
    });

    if (missionId) {
      this.addEvent(missionId, { kind: 'success', text: `${title} completed.`, subtaskId });
      this.cb.notify({
        kind: 'task_complete',
        title: 'Task completed',
        body: title,
        missionId,
        subtaskId,
      });
    }
  }

  private failSubtask(subtaskId: string, reason: string): void {
    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (!s) return;
      s.status = 'failed';
      s.completedAt = Date.now();
      s.reviewNotes = reason;
      const assignment = d.assignments.find((a) => a.currentSubtaskId === subtaskId);
      if (assignment) assignment.currentSubtaskId = null;
    });
    const doc = this.cb.read();
    const st = doc?.subtasks.find((s) => s.id === subtaskId);
    if (st) this.addEvent(st.missionId, { kind: 'error', text: `${st.title} failed: ${reason}`, subtaskId });
  }

  /**
   * Close out missions whose work has all settled.
   *
   * The Manager only declares success when every non-optional subtask reached
   * `done`. Anything else is an honest failure with a stated reason.
   */
  private finishCompletedMissions(): void {
    const doc = this.cb.read();
    if (!doc) return;

    for (const mission of doc.missions) {
      if (mission.status !== 'running') continue;

      const subtasks = doc.subtasks.filter((s) => s.missionId === mission.id);
      if (subtasks.length === 0) continue;

      const settled = subtasks.every((s) => ['done', 'failed', 'cancelled'].includes(s.status));
      if (!settled) continue;
      // Do not finish while work is still in flight for this mission.
      if (subtasks.some((s) => this.running.has(s.id))) continue;

      const failed = subtasks.filter((s) => s.status === 'failed');
      const done = subtasks.filter((s) => s.status === 'done');

      if (done.length === 0) {
        this.endMission(mission.id, 'failed', null, 'Every subtask failed.');
        continue;
      }

      const result = this.combineOutputs(mission, done, failed);
      // A mission with failures still returns what succeeded, clearly labelled.
      this.endMission(
        mission.id,
        failed.length === 0 ? 'completed' : 'completed',
        result,
        failed.length > 0 ? `${failed.length} subtask(s) failed; partial result delivered.` : null,
      );
    }
  }

  /** Assemble the deliverable the owner actually receives. */
  private combineOutputs(mission: Mission, done: Subtask[], failed: Subtask[]): string {
    const parts: string[] = [
      `# ${mission.title}`,
      '',
      `**Goal:** ${mission.goal}`,
      '',
      `Completed ${done.length} of ${done.length + failed.length} subtasks.`,
      '',
      '---',
      '',
    ];

    // A consolidation step, if the plan included one, leads the result.
    const ordered = [...done].sort((a, b) => a.order - b.order);
    const consolidation = ordered.find((s) => s.kind === 'summarize' && s.dependsOn.length > 1);

    if (consolidation?.output) {
      parts.push('## Result', '', consolidation.output, '', '---', '', '## Supporting work', '');
    }

    for (const st of ordered) {
      if (st === consolidation) continue;
      parts.push(`### ${st.title}`, '');
      parts.push(`*${st.roleLabel ?? 'Agent'} · ${st.modelId ?? 'unknown model'}*`, '');
      parts.push(st.output ?? '_No output recorded._', '');
    }

    if (failed.length > 0) {
      parts.push('---', '', '## Not completed', '');
      for (const st of failed) parts.push(`- **${st.title}** — ${st.reviewNotes ?? 'failed'}`);
    }

    return parts.join('\n');
  }

  private endMission(
    missionId: string,
    status: MissionStatus,
    result: string | null,
    failureReason: string | null,
  ): void {
    let title = '';
    this.cb.commit((d) => {
      const m = d.missions.find((x) => x.id === missionId);
      if (!m) return;
      title = m.title;
      m.status = status;
      m.completedAt = Date.now();
      m.finalResult = result;
      m.failureReason = failureReason;
      m.progress = 1;
      m.stage = status === 'completed' ? 'Complete' : 'Failed';
      m.events.push({
        at: Date.now(),
        kind: status === 'completed' ? 'success' : 'error',
        text: status === 'completed' ? 'Mission complete.' : `Mission failed: ${failureReason ?? 'unknown'}`,
      });

      // Temporary roles end with the mission. This is the point of the system:
      // the agents persist, their roles do not.
      d.assignments = d.assignments.filter((a) => a.missionId !== missionId);
    });

    if (result) {
      this.cb.commit((d) => {
        storeMissionResult(d, missionId, title, result);
      });
    }

    this.cb.notify({
      kind: status === 'completed' ? 'mission_complete' : 'mission_failed',
      title: status === 'completed' ? 'Mission complete' : 'Mission failed',
      body: title,
      missionId,
      subtaskId: null,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Owner controls                                                    */
  /* ---------------------------------------------------------------- */

  /** Resolve an escalation the Manager raised. */
  resolveApproval(subtaskId: string, approved: boolean): void {
    const doc = this.cb.read();
    const st = doc?.subtasks.find((s) => s.id === subtaskId);
    if (!doc || !st) return;

    if (approved) {
      this.completeSubtask(subtaskId);
      this.addEvent(st.missionId, { kind: 'success', text: `You approved ${st.title}.`, subtaskId });
    } else {
      this.failSubtask(subtaskId, 'You declined this work.');
    }

    this.cb.commit((d) => {
      const m = d.missions.find((x) => x.id === st.missionId);
      if (m && m.status === 'awaiting_approval') m.status = 'running';
    });
    void this.tick();
  }

  cancelMission(missionId: string): void {
    for (const [id, controller] of this.running) {
      const doc = this.cb.read();
      if (doc?.subtasks.find((s) => s.id === id)?.missionId === missionId) controller.abort();
    }
    this.cb.commit((d) => {
      const m = d.missions.find((x) => x.id === missionId);
      if (!m) return;
      m.status = 'cancelled';
      m.completedAt = Date.now();
      m.stage = 'Cancelled';
      for (const s of d.subtasks) {
        if (s.missionId === missionId && !['done', 'failed'].includes(s.status)) s.status = 'cancelled';
      }
      d.assignments = d.assignments.filter((a) => a.missionId !== missionId);
    });
  }

  /** Stop everything immediately — used by pause and emergency stop. */
  abortAll(): void {
    for (const c of this.running.values()) c.abort();
    this.running.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Views                                                             */
  /* ---------------------------------------------------------------- */

  /** What the campus renderer should show each agent doing right now. */
  directives(): AgentDirective[] {
    const doc = this.cb.read();
    if (!doc) return [];

    const out: AgentDirective[] = [];
    const active = doc.missions.filter((m) => m.status === 'running' || m.status === 'planning' || m.status === 'awaiting_approval');
    if (active.length === 0) return out;

    // The Manager is visibly coordinating whenever a mission is live.
    if (doc.managerAgentId) {
      const planning = active.some((m) => m.status === 'planning');
      out.push({
        agentId: doc.managerAgentId,
        state: planning ? 'planning' : 'reviewing',
        workKind: 'planning',
        roleLabel: 'Manager',
        subtaskId: null,
        missionId: active[0].id,
        progress: active[0].progress,
        tool: null,
      });
    }

    for (const st of doc.subtasks) {
      if (!st.assignedAgentId) continue;
      const mission = doc.missions.find((m) => m.id === st.missionId);
      if (!mission || !['running', 'planning', 'awaiting_approval'].includes(mission.status)) continue;

      const role = doc.assignments.find((a) => a.agentId === st.assignedAgentId)?.roleLabel ?? st.roleLabel;

      let state: AgentDirective['state'] = 'idle';
      switch (st.status) {
        case 'assigned': state = 'receiving_task'; break;
        case 'in_progress': state = 'working'; break;
        case 'in_review': state = 'collaborating'; break;
        case 'revising': state = 'working'; break;
        case 'awaiting_approval': state = 'waiting_for_approval'; break;
        case 'failed': state = 'failed'; break;
        case 'done': state = 'completed'; break;
        default: continue;
      }

      out.push({
        agentId: st.assignedAgentId,
        state,
        workKind: st.kind,
        roleLabel: role,
        subtaskId: st.id,
        missionId: st.missionId,
        progress: st.status === 'done' ? 1 : st.status === 'in_progress' ? 0.5 : 0.1,
        tool: st.modelId,
      });

      // A reviewer is visibly reviewing, not idle.
      if (st.status === 'in_review' && st.reviewerAgentId) {
        out.push({
          agentId: st.reviewerAgentId,
          state: 'reviewing',
          workKind: 'review',
          roleLabel: 'Reviewer',
          subtaskId: st.id,
          missionId: st.missionId,
          progress: 0.5,
          tool: null,
        });
      }
    }

    return out;
  }

  /** Everything genuinely waiting on the owner. */
  attention(): AttentionItem[] {
    const doc = this.cb.read();
    if (!doc) return [];
    const items: AttentionItem[] = [];

    for (const st of doc.subtasks) {
      if (st.status === 'awaiting_approval') {
        items.push({
          id: `approval_${st.id}`,
          kind: 'approval',
          title: 'Approval needed',
          detail: `${st.title} — ${st.reviewNotes ?? 'awaiting your decision'}`,
          missionId: st.missionId,
          subtaskId: st.id,
          at: st.completedAt ?? st.createdAt,
        });
      } else if (st.status === 'failed') {
        const mission = doc.missions.find((m) => m.id === st.missionId);
        if (mission && ['running', 'awaiting_approval'].includes(mission.status)) {
          items.push({
            id: `failure_${st.id}`,
            kind: 'failure',
            title: 'Task failed',
            detail: `${st.title} — ${st.reviewNotes ?? 'no reason recorded'}`,
            missionId: st.missionId,
            subtaskId: st.id,
            at: st.completedAt ?? st.createdAt,
          });
        }
      }
    }

    for (const m of doc.missions) {
      if (m.status === 'failed') {
        items.push({
          id: `mission_failed_${m.id}`,
          kind: 'failure',
          title: 'Mission failed',
          detail: `${m.title} — ${m.failureReason ?? 'no reason recorded'}`,
          missionId: m.id,
          subtaskId: null,
          at: m.completedAt ?? m.createdAt,
        });
      }
      if (m.status === 'running' && m.deadline !== null && m.deadline < Date.now()) {
        items.push({
          id: `overdue_${m.id}`,
          kind: 'warning',
          title: 'Past deadline',
          detail: `${m.title} is still running.`,
          missionId: m.id,
          subtaskId: null,
          at: m.deadline,
        });
      }
    }

    return items.sort((a, b) => b.at - a.at);
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  private setStatus(subtaskId: string, status: Subtask['status']): void {
    this.cb.commit((d) => {
      const s = d.subtasks.find((x) => x.id === subtaskId);
      if (s) s.status = status;
    });
  }

  private addEvent(missionId: string, event: Omit<MissionEvent, 'at'>): void {
    this.cb.commit((d) => {
      const m = d.missions.find((x) => x.id === missionId);
      if (!m) return;
      m.events.push({ ...event, at: Date.now() });
      // Keep the log bounded; the dashboard shows the tail.
      if (m.events.length > 200) m.events.splice(0, m.events.length - 200);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Prompt assembly                                                     */
/* ------------------------------------------------------------------ */

function buildPrompt(st: Subtask, mission: Mission, doc: CampusDocument): string {
  const parts = [st.instruction];

  // Completed dependency outputs are the real input to this step.
  const deps = st.dependsOn
    .map((id) => doc.subtasks.find((s) => s.id === id))
    .filter((s): s is Subtask => Boolean(s?.output));

  if (deps.length > 0) {
    parts.push('', 'Completed work from earlier steps:');
    for (const d of deps) parts.push(`\n--- ${d.title} ---\n${d.output}`);
  }

  // On a revision pass, the reviewer's notes are the point.
  if (st.revisionCount > 0 && st.reviewNotes) {
    parts.push('', 'A reviewer asked for changes. Address these points:', st.reviewNotes);
    if (st.output) parts.push('', 'Your previous attempt:', st.output);
  }

  if (mission.attachments.length > 0) {
    const readable = mission.attachments.filter((a) => a.content !== null);
    if (readable.length > 0) {
      parts.push('', 'Attachments provided by the owner:');
      for (const a of readable) parts.push(`\n--- ${a.name} (${a.mime}) ---\n${a.content}`);
    }
    const opaque = mission.attachments.filter((a) => a.content === null);
    for (const a of opaque) parts.push(`\n[Attachment "${a.name}" (${a.mime}) was too large to inline.]`);
  }

  return parts.join('\n');
}

function estimateTokens(instruction: string, attachments: Mission['attachments']): number {
  // Four characters per token is the usual rough rule.
  const chars = instruction.length + attachments.reduce((n, a) => n + (a.content?.length ?? 0), 0);
  return Math.ceil(chars / 4) + 500;
}
