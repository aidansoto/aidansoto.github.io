/**
 * Mission domain model.
 *
 * A TASK is one piece of work. A MISSION is a large goal made of many tasks,
 * owned by the Manager agent.
 *
 * ARCHITECTURAL RULE (unchanged from the campus core)
 * --------------------------------------------------
 * Worker agents have NO permanent role. `AgentConfig.role` remains a free-form
 * label the owner controls. Everything a mission assigns lives here instead, in
 * `RoleAssignment`, and is cleared when the mission ends. The mission system
 * borrows agents; it never redefines them.
 */

import type { AgentState } from './types';

/* ------------------------------------------------------------------ */
/* Missions                                                            */
/* ------------------------------------------------------------------ */

export type MissionStatus =
  | 'draft'
  | 'planning'
  | 'running'
  | 'blocked'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MissionPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Routing preference chosen per mission; overrides the global default. */
export type RoutingMode = 'auto_balanced' | 'auto_free' | 'auto_fast' | 'auto_quality' | 'manual';

export interface MissionAttachment {
  id: string;
  name: string;
  /** MIME type as reported by the browser. */
  mime: string;
  size: number;
  /** Small text/image payloads are inlined; large ones keep metadata only. */
  content: string | null;
  /** True when `content` was omitted because the file exceeded the inline cap. */
  truncated: boolean;
  addedAt: number;
}

export interface MissionEvent {
  at: number;
  kind: 'info' | 'warn' | 'error' | 'success';
  text: string;
  /** Subtask this event belongs to, when applicable. */
  subtaskId?: string;
}

export interface Mission {
  id: string;
  /** The owner's original words. Never rewritten. */
  goal: string;
  title: string;
  status: MissionStatus;
  priority: MissionPriority;
  routingMode: RoutingMode;

  managerAgentId: string;
  /** Workers currently borrowed by this mission. */
  workerAgentIds: string[];

  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  /** Epoch ms, or null for "no deadline". */
  deadline: number | null;

  /** 0..1 across all subtasks, weighted evenly. */
  progress: number;
  /** Human-readable current phase, e.g. "Executing · 3 of 7 complete". */
  stage: string;

  subtaskIds: string[];
  attachments: MissionAttachment[];
  events: MissionEvent[];

  /** Combined deliverable, produced when every subtask has passed. */
  finalResult: string | null;
  /** Set when the mission ends without a usable result. */
  failureReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Subtasks                                                            */
/* ------------------------------------------------------------------ */

export type SubtaskStatus =
  | 'pending' // waiting on dependencies
  | 'ready' // dependencies met, awaiting an agent
  | 'assigned'
  | 'in_progress'
  | 'in_review'
  | 'revising'
  | 'awaiting_approval'
  | 'done'
  | 'failed'
  | 'cancelled';

/**
 * What kind of work this is. Used by the router to pick a model and by the
 * campus to choose where the agent should physically go. These are *task*
 * kinds, not agent roles — an agent can do any of them.
 */
export type WorkKind =
  | 'research'
  | 'analysis'
  | 'planning'
  | 'writing'
  | 'build'
  | 'review'
  | 'test'
  | 'summarize'
  | 'classify'
  | 'vision';

export interface SubtaskAttempt {
  at: number;
  agentId: string;
  providerId: string;
  modelId: string;
  outcome: 'success' | 'failure' | 'rejected';
  /** Wall-clock duration in ms. */
  durationMs: number;
  note: string;
}

export interface Subtask {
  id: string;
  missionId: string;
  title: string;
  /** What the assigned agent is actually asked to do. */
  instruction: string;
  kind: WorkKind;
  status: SubtaskStatus;
  order: number;

  /** Subtask ids that must reach `done` before this one becomes ready. */
  dependsOn: string[];

  assignedAgentId: string | null;
  /** Temporary role label shown on the agent while it holds this subtask. */
  roleLabel: string | null;

  /** Set when the Manager routes this subtask through review. */
  reviewerAgentId: string | null;
  requiresReview: boolean;
  /** Some work needs the owner, not another agent. */
  requiresOwnerApproval: boolean;

  /** Routing decision, recorded for transparency. */
  providerId: string | null;
  modelId: string | null;
  routingReason: string | null;

  output: string | null;
  reviewNotes: string | null;
  attempts: SubtaskAttempt[];
  /** Guards against infinite retry loops. */
  retryCount: number;
  revisionCount: number;

  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Dynamic roles                                                       */
/* ------------------------------------------------------------------ */

/**
 * A temporary role held by a worker for the duration of one mission.
 * Cleared when the mission ends — this is the whole point of "dynamic roles".
 */
export interface RoleAssignment {
  agentId: string;
  missionId: string;
  /** e.g. "Researcher", "Reviewer". Chosen per-mission by the Manager. */
  roleLabel: string;
  assignedBy: string;
  assignedAt: number;
  currentSubtaskId: string | null;
}

/* ------------------------------------------------------------------ */
/* Manager memory                                                      */
/* ------------------------------------------------------------------ */

/**
 * What the Manager has learned. Every entry is timestamped and sourced so
 * nothing is treated as permanently true — `recallFacts` decays confidence
 * with age rather than trusting stale observations.
 */
export interface MemoryFact {
  id: string;
  kind: 'agent_performance' | 'model_performance' | 'failure' | 'workflow' | 'owner_preference' | 'procedure';
  subject: string;
  statement: string;
  /** 0..1 at the time of recording. */
  confidence: number;
  source: string;
  recordedAt: number;
  /** Bumped each time the same observation recurs. */
  observations: number;
}

/* ------------------------------------------------------------------ */
/* Model performance                                                   */
/* ------------------------------------------------------------------ */

export interface ModelStat {
  /** `${providerId}:${modelId}` */
  key: string;
  providerId: string;
  modelId: string;
  kind: WorkKind | 'all';
  attempts: number;
  successes: number;
  failures: number;
  revisions: number;
  totalDurationMs: number;
  /** Sum of reviewer scores (0..1), averaged on read. */
  scoreSum: number;
  scoreCount: number;
  /** Always 0 for free/local models. */
  totalCost: number;
  lastUsedAt: number;
}

/* ------------------------------------------------------------------ */
/* Knowledge vault                                                     */
/* ------------------------------------------------------------------ */

export type KnowledgeScope = 'shared' | 'mission' | 'agent';

export type KnowledgeKind =
  | 'note'
  | 'document'
  | 'research'
  | 'output'
  | 'result'
  | 'instruction'
  | 'decision'
  | 'procedure'
  | 'image'
  | 'pdf';

export interface KnowledgeEntry {
  id: string;
  title: string;
  kind: KnowledgeKind;
  scope: KnowledgeScope;
  /** Set when scope is 'mission' or 'agent'. */
  ownerId: string | null;
  body: string;
  tags: string[];
  /** Where this came from: an agent id, 'owner', or 'manager'. */
  source: string;
  createdAt: number;
  updatedAt: number;
  /** Bytes, for uploaded files. */
  size: number;
  mime: string | null;
}

/* ------------------------------------------------------------------ */
/* Workflows                                                           */
/* ------------------------------------------------------------------ */

export type WorkflowNodeKind =
  | 'start'
  | 'task'
  | 'agent'
  | 'manager'
  | 'ai'
  | 'tool'
  | 'condition'
  | 'wait'
  | 'schedule'
  | 'approval'
  | 'review'
  | 'revision'
  | 'notification'
  | 'save_output'
  | 'complete';

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  /** Canvas position in workflow-editor pixels. */
  x: number;
  y: number;
  /** Free-form per-node configuration; shape depends on `kind`. */
  config: Record<string, string>;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  /** Condition nodes emit labelled branches ("yes" / "no"). */
  label: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Templates appear in the New Mission picker. */
  isTemplate: boolean;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Runtime view                                                        */
/* ------------------------------------------------------------------ */

/** Everything the Command Dashboard needs, assembled in one pass. */
export interface MissionSnapshot {
  activeMission: Mission | null;
  missions: Mission[];
  subtasks: Subtask[];
  assignments: RoleAssignment[];
  /** Items genuinely waiting on the owner. */
  attention: AttentionItem[];
  agentCapacity: { active: number; max: number };
}

export interface AttentionItem {
  id: string;
  kind: 'approval' | 'question' | 'failure' | 'warning';
  title: string;
  detail: string;
  missionId: string | null;
  subtaskId: string | null;
  at: number;
}

/** Campus-facing directive: what the mission system wants an agent to do. */
export interface AgentDirective {
  agentId: string;
  state: AgentState;
  /** Where the agent should physically be. */
  workKind: WorkKind | null;
  roleLabel: string | null;
  subtaskId: string | null;
  missionId: string | null;
  progress: number;
  tool: string | null;
}

export const MAX_AGENTS = 10;
