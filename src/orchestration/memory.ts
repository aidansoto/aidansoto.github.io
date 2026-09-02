/**
 * Manager memory.
 *
 * What the Manager has learned about agents, models, failures, workflows and
 * the owner's preferences.
 *
 * NOTHING IS PERMANENTLY TRUE
 * ---------------------------
 * Every fact carries a timestamp, a source and an observation count, and
 * `recallFacts` decays confidence with age. A single observation from six
 * months ago is not allowed to outweigh fresh evidence, and a fact that has
 * decayed below the floor is simply not recalled. This is the difference
 * between remembering and assuming.
 */

import type { MemoryFact } from '@/core/mission';

/** After this long, a single unrepeated observation is worth roughly half. */
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
/** Below this effective confidence a fact stops being recalled. */
const RECALL_FLOOR = 0.15;
/** Cap so memory cannot grow without bound. */
const MAX_FACTS = 500;

export interface NewFact {
  kind: MemoryFact['kind'];
  subject: string;
  statement: string;
  confidence: number;
  source: string;
}

/**
 * Record an observation. Repeating an existing observation reinforces it
 * rather than duplicating it — which is what lets confidence grow with
 * genuine evidence instead of with noise.
 */
export function rememberFact(facts: MemoryFact[], incoming: NewFact): MemoryFact[] {
  const next = facts.map((f) => ({ ...f }));
  const existing = next.find((f) => f.kind === incoming.kind && f.subject === incoming.subject);

  if (existing) {
    existing.observations += 1;
    existing.recordedAt = Date.now();
    existing.statement = incoming.statement;
    existing.source = incoming.source;
    // Converge upward with repetition, never past 0.95 — certainty is earned
    // slowly and never absolute.
    existing.confidence = Math.min(0.95, existing.confidence + (incoming.confidence - existing.confidence) * 0.4 + 0.05);
    return trim(next);
  }

  next.push({
    id: `fact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: incoming.kind,
    subject: incoming.subject,
    statement: incoming.statement,
    confidence: Math.max(0, Math.min(0.95, incoming.confidence)),
    source: incoming.source,
    recordedAt: Date.now(),
    observations: 1,
  });
  return trim(next);
}

/** Age-adjusted confidence for a fact, right now. */
export function effectiveConfidence(fact: MemoryFact, now = Date.now()): number {
  const age = Math.max(0, now - fact.recordedAt);
  const decay = Math.pow(0.5, age / HALF_LIFE_MS);
  // Repeated observations resist decay: a pattern seen many times stays useful
  // longer than a one-off.
  const resistance = Math.min(1, 0.4 + fact.observations * 0.15);
  return fact.confidence * (decay + (1 - decay) * resistance);
}

/**
 * Recall facts, strongest first, with confidence already age-adjusted.
 * Facts that have decayed below the floor are omitted entirely.
 */
export function recallFacts(
  facts: MemoryFact[],
  kind?: MemoryFact['kind'],
  subject?: string,
): MemoryFact[] {
  const now = Date.now();
  return facts
    .filter((f) => (kind ? f.kind === kind : true))
    .filter((f) => (subject ? f.subject === subject : true))
    .map((f) => ({ ...f, confidence: effectiveConfidence(f, now) }))
    .filter((f) => f.confidence >= RECALL_FLOOR)
    .sort((a, b) => b.confidence - a.confidence);
}

/** Human-readable lines for the Manager chat and the memory panel. */
export function describeMemory(facts: MemoryFact[], limit = 8): string[] {
  return recallFacts(facts)
    .slice(0, limit)
    .map((f) => {
      const age = Date.now() - f.recordedAt;
      const days = Math.floor(age / (24 * 60 * 60 * 1000));
      const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      return `${f.statement} (${Math.round(f.confidence * 100)}% confidence, ${f.observations}× observed, last ${when}, from ${f.source})`;
    });
}

/** Keep the strongest, freshest facts when the store grows too large. */
function trim(facts: MemoryFact[]): MemoryFact[] {
  if (facts.length <= MAX_FACTS) return facts;
  const now = Date.now();
  return [...facts]
    .sort((a, b) => effectiveConfidence(b, now) - effectiveConfidence(a, now))
    .slice(0, MAX_FACTS);
}

export function forgetFact(facts: MemoryFact[], id: string): MemoryFact[] {
  return facts.filter((f) => f.id !== id);
}
