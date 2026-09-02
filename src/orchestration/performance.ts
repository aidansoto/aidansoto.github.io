/**
 * Model performance learning.
 *
 * Records how each model actually performs per kind of work, and exposes a
 * single score the router can blend into its decisions.
 *
 * DELIBERATE LIMIT
 * ----------------
 * This system influences *model preference only*. It cannot change routing
 * modes, unlock paid providers, alter spending limits, or touch any security
 * rule — the router applies hard constraints before performance is ever
 * consulted, so learning can never widen what is permitted.
 */

import type { ModelStat, WorkKind } from '@/core/mission';

export function statKey(providerId: string, modelId: string, kind: WorkKind | 'all'): string {
  return `${providerId}:${modelId}:${kind}`;
}

export interface RecordArgs {
  providerId: string;
  modelId: string;
  kind: WorkKind;
  outcome: 'success' | 'failure' | 'revision';
  durationMs: number;
  /** Reviewer score in 0..1, when the work went through review. */
  score?: number;
  cost?: number;
}

/**
 * Fold one attempt into the stats table. Returns a new array — callers persist
 * it as part of the campus document.
 *
 * Each attempt updates two rows: the per-kind row the router prefers, and an
 * 'all' row used as a fallback for work kinds a model has not seen yet.
 */
export function recordAttempt(stats: ModelStat[], args: RecordArgs): ModelStat[] {
  const next = stats.map((s) => ({ ...s }));

  for (const kind of [args.kind, 'all'] as const) {
    const key = statKey(args.providerId, args.modelId, kind);
    let row = next.find((s) => s.key === key);
    if (!row) {
      row = {
        key,
        providerId: args.providerId,
        modelId: args.modelId,
        kind,
        attempts: 0,
        successes: 0,
        failures: 0,
        revisions: 0,
        totalDurationMs: 0,
        scoreSum: 0,
        scoreCount: 0,
        totalCost: 0,
        lastUsedAt: 0,
      };
      next.push(row);
    }

    row.attempts += 1;
    row.totalDurationMs += Math.max(0, args.durationMs);
    row.totalCost += Math.max(0, args.cost ?? 0);
    row.lastUsedAt = Date.now();

    if (args.outcome === 'success') row.successes += 1;
    else if (args.outcome === 'failure') row.failures += 1;
    else row.revisions += 1;

    if (typeof args.score === 'number') {
      row.scoreSum += Math.max(0, Math.min(1, args.score));
      row.scoreCount += 1;
    }
  }

  return next;
}

export interface ModelPerformance {
  attempts: number;
  successRate: number;
  failureRate: number;
  revisionRate: number;
  avgDurationMs: number;
  avgScore: number | null;
  totalCost: number;
}

export function performanceOf(
  stats: ModelStat[],
  providerId: string,
  modelId: string,
  kind: WorkKind | 'all',
): ModelPerformance | null {
  const row = stats.find((s) => s.key === statKey(providerId, modelId, kind));
  if (!row || row.attempts === 0) return null;
  return {
    attempts: row.attempts,
    successRate: row.successes / row.attempts,
    failureRate: row.failures / row.attempts,
    revisionRate: row.revisions / row.attempts,
    avgDurationMs: row.totalDurationMs / row.attempts,
    avgScore: row.scoreCount > 0 ? row.scoreSum / row.scoreCount : null,
    totalCost: row.totalCost,
  };
}

/**
 * A 0..1 quality signal for the router, or null when there is not enough
 * evidence yet.
 *
 * Confidence ramps with sample count: a single lucky success must not
 * outweigh a model with a long, solid record. Below three attempts we return
 * null and the router falls back to declared capabilities.
 */
export function performanceScore(
  stats: ModelStat[],
  providerId: string,
  modelId: string,
  kind: WorkKind,
): number | null {
  const specific = performanceOf(stats, providerId, modelId, kind);
  const general = performanceOf(stats, providerId, modelId, 'all');
  const perf = specific && specific.attempts >= 3 ? specific : general;
  if (!perf || perf.attempts < 3) return null;

  // Success dominates; revisions are a partial penalty; reviewer score refines.
  let score = perf.successRate - perf.revisionRate * 0.35;
  if (perf.avgScore !== null) score = score * 0.7 + perf.avgScore * 0.3;

  // Blend toward neutral until the sample is meaningful.
  const confidence = Math.min(1, perf.attempts / 12);
  return Math.max(0, Math.min(1, 0.5 + (score - 0.5) * confidence));
}

/** Rows for the performance table in the UI, newest activity first. */
export function summarise(stats: ModelStat[]): Array<ModelStat & ModelPerformance> {
  return stats
    .filter((s) => s.kind === 'all' && s.attempts > 0)
    .map((s) => ({
      ...s,
      attempts: s.attempts,
      successRate: s.successes / s.attempts,
      failureRate: s.failures / s.attempts,
      revisionRate: s.revisions / s.attempts,
      avgDurationMs: s.totalDurationMs / s.attempts,
      avgScore: s.scoreCount > 0 ? s.scoreSum / s.scoreCount : null,
      totalCost: s.totalCost,
    }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}
