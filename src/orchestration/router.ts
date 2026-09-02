/**
 * Smart Model Router.
 *
 * Chooses which model runs a given subtask, and explains why in one sentence.
 *
 * THE COST GUARANTEE
 * ------------------
 * Constraints are applied *before* scoring, and the free-only constraint is a
 * hard filter, not a preference. In `auto_free` mode a paid model is never in
 * the candidate set, so no amount of performance history, capability matching
 * or fallback logic can select one. If nothing free can do the job, the router
 * returns a refusal that names the problem instead of silently upgrading.
 */

import type { ModelStat, RoutingMode, WorkKind } from '@/core/mission';
import type { ModelDescriptor } from '@/providers/types';
import { performanceScore } from './performance';

export interface RouteRequest {
  kind: WorkKind;
  mode: RoutingMode;
  /** Available models, already filtered to providers reporting `available`. */
  candidates: ModelDescriptor[];
  stats: ModelStat[];
  /** The agent's configured default, honoured in manual mode. */
  preferredModelId?: string | null;
  /** When off, the agent's default wins unless it cannot do the job. */
  smartRouter: boolean;
  /** Set when the work involves images. */
  needsVision?: boolean;
  /** Rough size of the input, in tokens. */
  estimatedTokens?: number;
  /** Set when the work must not leave the machine. */
  requiresPrivacy?: boolean;
}

export interface RouteDecision {
  model: ModelDescriptor | null;
  reason: string;
  /** Populated when no model could be selected. */
  refusal: string | null;
}

const MODE_LABEL: Record<RoutingMode, string> = {
  auto_balanced: 'best balance',
  auto_free: 'free only',
  auto_fast: 'fastest',
  auto_quality: 'best quality',
  manual: 'manual',
};

/** Complexity of each kind of work, 1 (trivial) … 5 (demanding). */
const KIND_DEMAND: Record<WorkKind, number> = {
  classify: 1,
  summarize: 2,
  research: 3,
  writing: 3,
  vision: 3,
  test: 3,
  analysis: 4,
  build: 4,
  review: 4,
  planning: 5,
};

export function route(req: RouteRequest): RouteDecision {
  const { kind, mode, candidates } = req;

  if (candidates.length === 0) {
    return {
      model: null,
      reason: '',
      refusal:
        'No AI provider is available. Offline Simulation is built in and should always be present — check Settings → AI Provider.',
    };
  }

  /* -- Hard constraints, applied first ------------------------------ */

  let pool = candidates;

  // FREE ONLY: a hard filter. Paid models never enter the candidate set.
  if (mode === 'auto_free') {
    pool = pool.filter((m) => m.capabilities.free);
    if (pool.length === 0) {
      return {
        model: null,
        reason: '',
        refusal:
          'FREE ONLY is selected and no free model can run this task. Nothing was sent to a paid provider. Install a local model with Ollama, or change the routing mode.',
      };
    }
  }

  if (req.requiresPrivacy) {
    const local = pool.filter((m) => m.capabilities.local);
    if (local.length === 0) {
      return {
        model: null,
        reason: '',
        refusal: 'This task requires on-device processing and no local model is available.',
      };
    }
    pool = local;
  }

  if (req.needsVision || kind === 'vision') {
    const seeing = pool.filter((m) => m.capabilities.vision);
    if (seeing.length === 0) {
      return {
        model: null,
        reason: '',
        refusal:
          'This task needs to read an image and no vision-capable model is available. Install one, for example: ollama pull llama3.2-vision',
      };
    }
    pool = seeing;
  }

  if (req.estimatedTokens && req.estimatedTokens > 0) {
    const roomy = pool.filter((m) => m.capabilities.contextTokens >= req.estimatedTokens!);
    // Only narrow if something survives; otherwise the largest context wins below.
    if (roomy.length > 0) pool = roomy;
  }

  /* -- Manual and smart-router-off paths ---------------------------- */

  const preferred = req.preferredModelId
    ? pool.find((m) => m.id === req.preferredModelId)
    : undefined;

  if (mode === 'manual') {
    if (preferred) {
      return {
        model: preferred,
        reason: `Manual selection: ${preferred.label}.`,
        refusal: null,
      };
    }
    // Manual mode with an unusable preference still needs to produce work.
    const fallback = pick(pool, req);
    return {
      model: fallback,
      reason: `Manual model unavailable — using ${fallback.label} instead.`,
      refusal: null,
    };
  }

  if (!req.smartRouter && preferred) {
    return {
      model: preferred,
      reason: `Smart Router is off, so the agent's default model (${preferred.label}) was used.`,
      refusal: null,
    };
  }

  /* -- Scored selection --------------------------------------------- */

  const chosen = pick(pool, req);
  return { model: chosen, reason: explain(chosen, req), refusal: null };
}

/** Score every candidate and return the winner. `pool` must be non-empty. */
function pick(pool: ModelDescriptor[], req: RouteRequest): ModelDescriptor {
  const demand = KIND_DEMAND[req.kind];

  let best = pool[0];
  let bestScore = -Infinity;

  for (const m of pool) {
    const caps = m.capabilities;
    let score = 0;

    // Fit between the work's demand and the model's reasoning strength.
    // Overshooting is mildly wasteful; undershooting is a real problem.
    const gap = caps.reasoning - demand;
    score += gap >= 0 ? 3 - gap * 0.4 : gap * 1.6;

    // Declared affinity for this kind of work.
    if (m.suitedFor.includes(req.kind)) score += 2;

    switch (req.mode) {
      case 'auto_fast':
        score += caps.speed * 1.6;
        break;
      case 'auto_quality':
        score += caps.reasoning * 1.6;
        break;
      case 'auto_free':
        // Everything here is already free; prefer the better fit, then speed.
        score += caps.reasoning * 0.6 + caps.speed * 0.5;
        break;
      case 'auto_balanced':
      default:
        score += caps.reasoning * 0.8 + caps.speed * 0.6;
        break;
    }

    // Local execution is a genuine advantage: private, and never billable.
    if (caps.local) score += 1.2;
    if (caps.free) score += 1.2;

    // Learned performance, blended in once there is enough evidence.
    const learned = performanceScore(req.stats, m.providerId, m.id, req.kind);
    if (learned !== null) score += (learned - 0.5) * 4;

    // A tie-break that keeps the agent's own default when it is just as good.
    if (req.preferredModelId && m.id === req.preferredModelId) score += 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  return best;
}

/** One short sentence. Shown verbatim in the UI. */
function explain(model: ModelDescriptor, req: RouteRequest): string {
  const caps = model.capabilities;
  const bits: string[] = [];

  if (req.kind === 'vision') bits.push('the task involves an image');
  else if (KIND_DEMAND[req.kind] <= 2) bits.push(`this is a simple ${req.kind} task`);
  else if (KIND_DEMAND[req.kind] >= 4) bits.push(`${req.kind} needs stronger reasoning`);
  else bits.push(`it suits ${req.kind} work`);

  if (caps.local) bits.push('local execution is sufficient');
  if (req.mode === 'auto_free') bits.push('and FREE ONLY is active');
  else if (req.mode === 'auto_fast') bits.push('and speed was prioritised');
  else if (req.mode === 'auto_quality') bits.push('and quality was prioritised');

  const learned = performanceScore(req.stats, model.providerId, model.id, req.kind);
  if (learned !== null && learned > 0.6) bits.push('and it has performed well on similar work');

  return `Selected because ${bits.join(', ')}.`;
}

export function routingModeLabel(mode: RoutingMode): string {
  return MODE_LABEL[mode];
}

/** Human-facing option list for the settings and mission dialogs. */
export const ROUTING_OPTIONS: Array<{ value: RoutingMode; label: string; hint: string }> = [
  { value: 'auto_free', label: 'AUTO — FREE ONLY', hint: 'Only free/local models. Never a paid API.' },
  { value: 'auto_balanced', label: 'AUTO — BEST BALANCE', hint: 'Weighs quality, speed and cost.' },
  { value: 'auto_fast', label: 'AUTO — FASTEST', hint: 'Prefers the quickest capable model.' },
  { value: 'auto_quality', label: 'AUTO — BEST QUALITY', hint: 'Prefers the strongest capable model.' },
  { value: 'manual', label: 'MANUAL', hint: "Uses each agent's configured default model." },
];
