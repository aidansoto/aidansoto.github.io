/**
 * Mission planner.
 *
 * Turns one large owner goal into a real, ordered, dependency-linked set of
 * subtasks with the temporary roles needed to staff them.
 *
 * TWO PLANNERS, ONE OUTPUT SHAPE
 * ------------------------------
 * `planHeuristically` runs with no AI at all and always works. When a language
 * model is available the Manager asks it to plan instead, and `parseModelPlan`
 * validates that answer back into the same shape — falling back to the
 * heuristic plan if the model returns anything unusable.
 *
 * Either way the plan is genuine: every step becomes a Subtask record that is
 * assigned, executed, reviewed and tracked. Nothing here pretends to delegate.
 */

import type { Subtask, SubtaskStatus, WorkKind } from '@/core/mission';

export interface PlanStep {
  title: string;
  instruction: string;
  kind: WorkKind;
  roleLabel: string;
  /** Indices into the step array; converted to ids by `materialise`. */
  dependsOn: number[];
  requiresReview: boolean;
  requiresOwnerApproval: boolean;
}

export interface Plan {
  steps: PlanStep[];
  /** How the plan was produced, shown to the owner. */
  source: 'heuristic' | 'model';
  summary: string;
}

/* ------------------------------------------------------------------ */
/* Goal classification                                                 */
/* ------------------------------------------------------------------ */

const SIGNALS: Array<{ kind: WorkKind; role: string; words: RegExp }> = [
  { kind: 'research', role: 'Researcher', words: /\b(research|investigate|find out|explore|look into|study|gather|survey|discover)\b/i },
  { kind: 'analysis', role: 'Analyst', words: /\b(analy[sz]e|assess|evaluate|compare|measure|examine|audit|review the data)\b/i },
  { kind: 'planning', role: 'Planner', words: /\b(plan|strategy|roadmap|outline|schedule|organi[sz]e|design an approach)\b/i },
  { kind: 'writing', role: 'Writer', words: /\b(write|draft|document|compose|summar|report|article|copy|content|blog)\b/i },
  { kind: 'build', role: 'Builder', words: /\b(build|create|make|implement|develop|code|construct|generate|produce|prototype)\b/i },
  { kind: 'test', role: 'Tester', words: /\b(test|verify|validate|check|qa|quality)\b/i },
  { kind: 'vision', role: 'Image Analyst', words: /\b(image|photo|picture|screenshot|diagram|visual|logo|design mock)\b/i },
  { kind: 'classify', role: 'Classifier', words: /\b(classify|categor|sort|label|tag|triage)\b/i },
  { kind: 'summarize', role: 'Summariser', words: /\b(summar|condense|brief|digest|tl;?dr)\b/i },
];

/** Which kinds of work the goal actually calls for, in a sensible order. */
export function detectWorkKinds(goal: string): Array<{ kind: WorkKind; role: string }> {
  const hits = SIGNALS.filter((s) => s.words.test(goal)).map((s) => ({ kind: s.kind, role: s.role }));

  // A goal with no recognisable verbs still deserves a real plan.
  if (hits.length === 0) {
    return [
      { kind: 'research', role: 'Researcher' },
      { kind: 'writing', role: 'Writer' },
    ];
  }

  // Natural working order, regardless of the order words appeared in.
  const ORDER: WorkKind[] = [
    'research', 'vision', 'classify', 'analysis', 'planning', 'build', 'writing', 'test', 'summarize', 'review',
  ];
  return hits.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** Does this goal look big enough to warrant review and a final summary? */
export function looksSubstantial(goal: string): boolean {
  return goal.trim().length > 60 || /\b(and|then|after|finally|also)\b/i.test(goal);
}

/* ------------------------------------------------------------------ */
/* Heuristic planner                                                   */
/* ------------------------------------------------------------------ */

/**
 * Build a plan with no AI involvement. Deterministic, instant, always
 * available — this is what runs on a Mac with nothing installed.
 */
export function planHeuristically(goal: string, opts: { hasAttachments: boolean } = { hasAttachments: false }): Plan {
  const trimmed = goal.trim();
  const kinds = detectWorkKinds(trimmed);
  const steps: PlanStep[] = [];

  // An image attachment always earns an explicit look at it, first.
  if (opts.hasAttachments && !kinds.some((k) => k.kind === 'vision')) {
    kinds.unshift({ kind: 'vision', role: 'Image Analyst' });
  }

  kinds.forEach((k, i) => {
    steps.push({
      title: `${k.role}: ${verbFor(k.kind)}`,
      instruction: instructionFor(k.kind, trimmed),
      kind: k.kind,
      roleLabel: k.role,
      // A simple chain: each stage builds on the one before it.
      dependsOn: i === 0 ? [] : [i - 1],
      // Substantial creative output gets checked by a second agent.
      requiresReview: looksSubstantial(trimmed) && (k.kind === 'build' || k.kind === 'writing' || k.kind === 'analysis'),
      requiresOwnerApproval: false,
    });
  });

  // Always finish by consolidating, so the owner gets one deliverable.
  if (steps.length > 1) {
    steps.push({
      title: 'Consolidate the final result',
      instruction: `Combine the completed work into one deliverable that answers the original goal: "${trimmed}"`,
      kind: 'summarize',
      roleLabel: 'Integrator',
      dependsOn: steps.map((_, i) => i),
      requiresReview: false,
      requiresOwnerApproval: false,
    });
  }

  return {
    steps,
    source: 'heuristic',
    summary: `${steps.length} step(s) covering ${kinds.map((k) => k.kind).join(', ')}.`,
  };
}

function verbFor(kind: WorkKind): string {
  switch (kind) {
    case 'research': return 'gather the source material';
    case 'analysis': return 'assess the findings';
    case 'planning': return 'lay out the approach';
    case 'writing': return 'produce the written work';
    case 'build': return 'build the deliverable';
    case 'test': return 'verify the result';
    case 'review': return 'review the work';
    case 'summarize': return 'consolidate the output';
    case 'classify': return 'categorise the material';
    case 'vision': return 'examine the attached image';
  }
}

function instructionFor(kind: WorkKind, goal: string): string {
  const tail = `\n\nOriginal goal: "${goal}"`;
  switch (kind) {
    case 'research': return `Research everything needed to satisfy this goal. Report findings and anything still unknown.${tail}`;
    case 'analysis': return `Analyse the research and state what it means for the goal, including risks.${tail}`;
    case 'planning': return `Produce a concrete step-by-step plan for achieving the goal.${tail}`;
    case 'writing': return `Write the deliverable the goal asks for, in full.${tail}`;
    case 'build': return `Build the artefacts the goal requires and describe what you produced.${tail}`;
    case 'test': return `Verify the work against the goal and report any problems.${tail}`;
    case 'review': return `Review the preceding work for quality and completeness. End with PASS or REVISE.${tail}`;
    case 'summarize': return `Summarise the completed work into a single clear result.${tail}`;
    case 'classify': return `Classify the material relevant to this goal.${tail}`;
    case 'vision': return `Examine the attached image(s) and describe what is relevant to the goal.${tail}`;
  }
}

/* ------------------------------------------------------------------ */
/* Model-authored plans                                                */
/* ------------------------------------------------------------------ */

export const PLAN_SYSTEM_PROMPT = `You are the Manager of an autonomous work campus. Break the owner's goal into 2-6 concrete subtasks.
Reply with ONLY a JSON array. Each element:
{"title": string, "instruction": string, "kind": one of ["research","analysis","planning","writing","build","review","test","summarize","classify","vision"], "role": string, "dependsOn": array of zero-based indices of earlier steps, "review": boolean}
No prose, no markdown fences.`;

const VALID_KINDS: WorkKind[] = [
  'research', 'analysis', 'planning', 'writing', 'build', 'review', 'test', 'summarize', 'classify', 'vision',
];

/**
 * Validate a model's JSON plan into `PlanStep[]`.
 * Returns null when the response cannot be trusted, so the caller falls back
 * to the heuristic plan rather than acting on malformed instructions.
 */
export function parseModelPlan(raw: string): PlanStep[] | null {
  // Models often wrap JSON in prose or fences; take the outermost array.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const steps: PlanStep[] = [];
  parsed.slice(0, 8).forEach((item, index) => {
    if (typeof item !== 'object' || item === null) return;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 120) : null;
    const instruction =
      typeof o.instruction === 'string' && o.instruction.trim() ? o.instruction.trim().slice(0, 2000) : null;
    if (!title || !instruction) return;

    const kind = VALID_KINDS.includes(o.kind as WorkKind) ? (o.kind as WorkKind) : 'research';
    const role = typeof o.role === 'string' && o.role.trim() ? o.role.trim().slice(0, 40) : 'Specialist';

    // Dependencies may only point backwards, which makes cycles impossible.
    const dependsOn = Array.isArray(o.dependsOn)
      ? o.dependsOn
          .map((d) => (typeof d === 'number' ? Math.floor(d) : NaN))
          .filter((d) => Number.isFinite(d) && d >= 0 && d < index)
      : [];

    steps.push({
      title,
      instruction,
      kind,
      roleLabel: role,
      dependsOn: [...new Set(dependsOn)],
      requiresReview: o.review === true,
      requiresOwnerApproval: false,
    });
  });

  return steps.length > 0 ? steps : null;
}

/* ------------------------------------------------------------------ */
/* Materialisation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Turn plan steps into persisted Subtask records.
 * Steps with no unmet dependencies start `ready`; the rest start `pending`.
 */
export function materialise(plan: Plan, missionId: string, idPrefix: string): Subtask[] {
  const now = Date.now();
  const ids = plan.steps.map((_, i) => `${idPrefix}_st${String(i + 1).padStart(2, '0')}`);

  return plan.steps.map((step, i) => {
    const dependsOn = step.dependsOn.filter((d) => d >= 0 && d < ids.length).map((d) => ids[d]);
    const status: SubtaskStatus = dependsOn.length === 0 ? 'ready' : 'pending';
    return {
      id: ids[i],
      missionId,
      title: step.title,
      instruction: step.instruction,
      kind: step.kind,
      status,
      order: i,
      dependsOn,
      assignedAgentId: null,
      roleLabel: step.roleLabel,
      reviewerAgentId: null,
      requiresReview: step.requiresReview,
      requiresOwnerApproval: step.requiresOwnerApproval,
      providerId: null,
      modelId: null,
      routingReason: null,
      output: null,
      reviewNotes: null,
      attempts: [],
      retryCount: 0,
      revisionCount: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
  });
}

/** A short mission title derived from the goal, for lists and notifications. */
export function deriveTitle(goal: string): string {
  const clean = goal.trim().replace(/\s+/g, ' ');
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 30 ? lastSpace : 60)}…`;
}
