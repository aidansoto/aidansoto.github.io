import { describe, it, expect } from 'vitest';
import { route, ROUTING_OPTIONS } from '@/orchestration/router';
import { recordAttempt, performanceScore, performanceOf, summarise } from '@/orchestration/performance';
import { inferCapabilities, inferSuitedFor } from '@/providers/ollama';
import type { ModelDescriptor } from '@/providers/types';
import type { ModelStat, WorkKind } from '@/core/mission';

function model(
  id: string,
  over: Partial<ModelDescriptor['capabilities']> = {},
  suitedFor: WorkKind[] = [],
  providerId = 'test',
): ModelDescriptor {
  return {
    id,
    providerId,
    label: id,
    capabilities: {
      vision: false,
      contextTokens: 8000,
      reasoning: 3,
      speed: 3,
      local: true,
      free: true,
      ...over,
    },
    suitedFor,
  };
}

const FREE_LOCAL = model('free-local');
const PAID_CLOUD = model('paid-cloud', { free: false, local: false, reasoning: 5, speed: 5 }, [], 'cloud');

describe('FREE ONLY is a hard constraint', () => {
  it('never selects a paid model, even when it is far better', () => {
    for (const kind of ['research', 'planning', 'build', 'review', 'analysis'] as WorkKind[]) {
      const decision = route({
        kind,
        mode: 'auto_free',
        candidates: [PAID_CLOUD, FREE_LOCAL],
        stats: [],
        smartRouter: true,
      });
      expect(decision.model?.capabilities.free, kind).toBe(true);
      expect(decision.model?.id, kind).toBe('free-local');
    }
  });

  it('refuses rather than silently upgrading when nothing free can do the job', () => {
    const decision = route({
      kind: 'research',
      mode: 'auto_free',
      candidates: [PAID_CLOUD],
      stats: [],
      smartRouter: true,
    });
    expect(decision.model).toBeNull();
    expect(decision.refusal).toContain('FREE ONLY');
    expect(decision.refusal).toContain('Nothing was sent to a paid provider');
  });

  it('cannot be overridden by an agent preferring a paid model', () => {
    const decision = route({
      kind: 'writing',
      mode: 'auto_free',
      candidates: [PAID_CLOUD, FREE_LOCAL],
      stats: [],
      smartRouter: true,
      preferredModelId: 'paid-cloud',
    });
    expect(decision.model?.id).toBe('free-local');
  });

  it('cannot be overridden by learned performance favouring a paid model', () => {
    // Give the paid model a flawless record and the free one a poor one.
    let stats: ModelStat[] = [];
    for (let i = 0; i < 20; i++) {
      stats = recordAttempt(stats, {
        providerId: 'cloud', modelId: 'paid-cloud', kind: 'research',
        outcome: 'success', durationMs: 100, score: 1,
      });
      stats = recordAttempt(stats, {
        providerId: 'test', modelId: 'free-local', kind: 'research',
        outcome: 'failure', durationMs: 100,
      });
    }
    const decision = route({
      kind: 'research', mode: 'auto_free',
      candidates: [PAID_CLOUD, FREE_LOCAL], stats, smartRouter: true,
    });
    expect(decision.model?.id).toBe('free-local');
  });

  it('cannot be overridden by manual mode inside a free-only route', () => {
    const decision = route({
      kind: 'research', mode: 'auto_free',
      candidates: [PAID_CLOUD, FREE_LOCAL], stats: [],
      smartRouter: false, preferredModelId: 'paid-cloud',
    });
    expect(decision.model?.capabilities.free).toBe(true);
  });
});

describe('capability constraints', () => {
  it('requires a vision model for image work and says so when there is none', () => {
    const decision = route({
      kind: 'vision', mode: 'auto_balanced',
      candidates: [FREE_LOCAL], stats: [], smartRouter: true,
    });
    expect(decision.model).toBeNull();
    expect(decision.refusal).toContain('vision');
    expect(decision.refusal).toContain('ollama pull');
  });

  it('selects the vision model when one exists', () => {
    const seeing = model('sees', { vision: true }, ['vision']);
    const decision = route({
      kind: 'vision', mode: 'auto_balanced',
      candidates: [FREE_LOCAL, seeing], stats: [], smartRouter: true,
    });
    expect(decision.model?.id).toBe('sees');
  });

  it('honours a privacy requirement', () => {
    const remote = model('remote', { local: false, reasoning: 5 });
    const decision = route({
      kind: 'analysis', mode: 'auto_balanced',
      candidates: [remote, FREE_LOCAL], stats: [], smartRouter: true,
      requiresPrivacy: true,
    });
    expect(decision.model?.capabilities.local).toBe(true);
  });

  it('prefers a model whose context fits the input', () => {
    const small = model('small', { contextTokens: 4000 });
    const large = model('large', { contextTokens: 128000 });
    const decision = route({
      kind: 'summarize', mode: 'auto_balanced',
      candidates: [small, large], stats: [], smartRouter: true,
      estimatedTokens: 40000,
    });
    expect(decision.model?.id).toBe('large');
  });

  it('still returns a model when nothing has enough context', () => {
    const small = model('small', { contextTokens: 4000 });
    const decision = route({
      kind: 'summarize', mode: 'auto_balanced',
      candidates: [small], stats: [], smartRouter: true, estimatedTokens: 900000,
    });
    expect(decision.model).not.toBeNull();
  });
});

describe('routing modes', () => {
  const fast = model('fast', { speed: 5, reasoning: 2 });
  const strong = model('strong', { speed: 1, reasoning: 5 });

  it('FASTEST prefers the quick model', () => {
    const d = route({ kind: 'summarize', mode: 'auto_fast', candidates: [fast, strong], stats: [], smartRouter: true });
    expect(d.model?.id).toBe('fast');
  });

  it('BEST QUALITY prefers the strong model on demanding work', () => {
    const d = route({ kind: 'planning', mode: 'auto_quality', candidates: [fast, strong], stats: [], smartRouter: true });
    expect(d.model?.id).toBe('strong');
  });

  it('MANUAL honours the agent default when it is usable', () => {
    const d = route({
      kind: 'research', mode: 'manual', candidates: [fast, strong],
      stats: [], smartRouter: true, preferredModelId: 'strong',
    });
    expect(d.model?.id).toBe('strong');
    expect(d.reason).toContain('Manual');
  });

  it('MANUAL falls back rather than failing when the default is gone', () => {
    const d = route({
      kind: 'research', mode: 'manual', candidates: [fast],
      stats: [], smartRouter: true, preferredModelId: 'missing',
    });
    expect(d.model).not.toBeNull();
    expect(d.reason).toContain('unavailable');
  });

  it('respects Smart Router off by keeping the agent default', () => {
    const d = route({
      kind: 'planning', mode: 'auto_balanced', candidates: [fast, strong],
      stats: [], smartRouter: false, preferredModelId: 'fast',
    });
    expect(d.model?.id).toBe('fast');
    expect(d.reason).toContain('Smart Router is off');
  });

  it('always explains itself in one short sentence', () => {
    const d = route({ kind: 'research', mode: 'auto_free', candidates: [FREE_LOCAL], stats: [], smartRouter: true });
    expect(d.reason.startsWith('Selected because')).toBe(true);
    expect(d.reason.length).toBeLessThan(200);
  });

  it('reports no provider at all rather than crashing', () => {
    const d = route({ kind: 'research', mode: 'auto_balanced', candidates: [], stats: [], smartRouter: true });
    expect(d.model).toBeNull();
    expect(d.refusal).toContain('No AI provider');
  });

  it('offers free-only first in the options list', () => {
    expect(ROUTING_OPTIONS[0].value).toBe('auto_free');
  });
});

describe('performance learning', () => {
  it('needs evidence before it forms an opinion', () => {
    let stats: ModelStat[] = [];
    expect(performanceScore(stats, 'p', 'm', 'research')).toBeNull();
    stats = recordAttempt(stats, { providerId: 'p', modelId: 'm', kind: 'research', outcome: 'success', durationMs: 10 });
    expect(performanceScore(stats, 'p', 'm', 'research')).toBeNull();
  });

  it('rates a consistently successful model above a failing one', () => {
    let stats: ModelStat[] = [];
    for (let i = 0; i < 12; i++) {
      stats = recordAttempt(stats, { providerId: 'p', modelId: 'good', kind: 'research', outcome: 'success', durationMs: 10 });
      stats = recordAttempt(stats, { providerId: 'p', modelId: 'bad', kind: 'research', outcome: 'failure', durationMs: 10 });
    }
    const good = performanceScore(stats, 'p', 'good', 'research')!;
    const bad = performanceScore(stats, 'p', 'bad', 'research')!;
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeGreaterThan(0.6);
    expect(bad).toBeLessThan(0.4);
  });

  it('lets a strong record steer the choice between equals', () => {
    const a = model('alpha');
    const b = model('beta');
    let stats: ModelStat[] = [];
    for (let i = 0; i < 15; i++) {
      stats = recordAttempt(stats, { providerId: 'test', modelId: 'beta', kind: 'writing', outcome: 'success', durationMs: 10, score: 0.95 });
      stats = recordAttempt(stats, { providerId: 'test', modelId: 'alpha', kind: 'writing', outcome: 'failure', durationMs: 10 });
    }
    const d = route({ kind: 'writing', mode: 'auto_balanced', candidates: [a, b], stats, smartRouter: true });
    expect(d.model?.id).toBe('beta');
  });

  it('tracks rates, duration, score and cost', () => {
    let stats: ModelStat[] = [];
    stats = recordAttempt(stats, { providerId: 'p', modelId: 'm', kind: 'review', outcome: 'success', durationMs: 100, score: 0.8 });
    stats = recordAttempt(stats, { providerId: 'p', modelId: 'm', kind: 'review', outcome: 'revision', durationMs: 300 });
    const perf = performanceOf(stats, 'p', 'm', 'review')!;
    expect(perf.attempts).toBe(2);
    expect(perf.successRate).toBe(0.5);
    expect(perf.revisionRate).toBe(0.5);
    expect(perf.avgDurationMs).toBe(200);
    expect(perf.avgScore).toBeCloseTo(0.8);
    expect(perf.totalCost).toBe(0);
  });

  it('keeps a per-kind row and an all-kinds fallback row', () => {
    let stats: ModelStat[] = [];
    stats = recordAttempt(stats, { providerId: 'p', modelId: 'm', kind: 'build', outcome: 'success', durationMs: 10 });
    expect(performanceOf(stats, 'p', 'm', 'build')).not.toBeNull();
    expect(performanceOf(stats, 'p', 'm', 'all')).not.toBeNull();
  });

  it('summarises for display without mutating the source', () => {
    let stats: ModelStat[] = [];
    stats = recordAttempt(stats, { providerId: 'p', modelId: 'm', kind: 'build', outcome: 'success', durationMs: 10 });
    const before = JSON.parse(JSON.stringify(stats));
    const rows = summarise(stats);
    expect(rows).toHaveLength(1);
    expect(rows[0].successRate).toBe(1);
    expect(stats).toEqual(before);
  });

  it('never mutates the array it was given', () => {
    const stats: ModelStat[] = [];
    const next = recordAttempt(stats, { providerId: 'p', modelId: 'm', kind: 'build', outcome: 'success', durationMs: 10 });
    expect(stats).toHaveLength(0);
    expect(next.length).toBeGreaterThan(0);
  });
});

describe('Ollama capability inference', () => {
  it('recognises vision models', () => {
    expect(inferCapabilities('llava:13b').vision).toBe(true);
    expect(inferCapabilities('llama3.2-vision:11b').vision).toBe(true);
    expect(inferCapabilities('llama3.2:3b').vision).toBe(false);
  });

  it('scales reasoning and speed with parameter count', () => {
    const small = inferCapabilities('llama3.2:1b');
    const large = inferCapabilities('llama3.1:70b');
    expect(large.reasoning).toBeGreaterThan(small.reasoning);
    expect(small.speed).toBeGreaterThan(large.speed);
  });

  it('prefers the reported parameter size over the name', () => {
    expect(inferCapabilities('custom-model', '70B').reasoning).toBe(5);
  });

  it('always reports local models as free and on-device', () => {
    const caps = inferCapabilities('anything:7b');
    expect(caps.free).toBe(true);
    expect(caps.local).toBe(true);
  });

  it('routes coding models toward build work', () => {
    const caps = inferCapabilities('qwen2.5-coder:7b');
    expect(inferSuitedFor('qwen2.5-coder:7b', caps)).toContain('build');
  });
});
