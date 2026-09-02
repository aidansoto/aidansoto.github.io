/**
 * Offline Simulation provider.
 *
 * The default brain. It runs entirely in-process, costs nothing, needs no
 * network, and is always available — which is what lets the campus do genuine
 * end-to-end mission work on a machine with no AI runtime installed.
 *
 * BE CLEAR ABOUT WHAT THIS IS
 * ---------------------------
 * This is a deterministic *work simulator*, not a language model. It produces
 * structured, plausible, clearly-labelled placeholder deliverables so the
 * orchestration — planning, delegation, dependencies, review, revision,
 * failure recovery, aggregation — can be exercised and trusted for real. Every
 * artefact it writes is stamped so its output is never mistaken for analysis.
 *
 * Point the campus at Ollama and the identical pipeline produces real content.
 */

import type {
  AiProviderAdapter,
  GenerateRequest,
  GenerateResult,
  ModelDescriptor,
  ProviderConfig,
  ProviderStatus,
} from './types';

export const OFFLINE_PROVIDER_ID = 'offline';

/** Marker prefixed to every artefact so simulated output is self-identifying. */
export const SIMULATED_MARK = '[Simulated · offline campus]';

const MODELS: ModelDescriptor[] = [
  {
    id: 'campus-sim-standard',
    providerId: OFFLINE_PROVIDER_ID,
    label: 'Campus Simulation · Standard',
    capabilities: {
      vision: false,
      contextTokens: 8000,
      reasoning: 2,
      speed: 5,
      local: true,
      free: true,
    },
    suitedFor: ['research', 'writing', 'summarize', 'classify', 'planning', 'analysis'],
  },
  {
    id: 'campus-sim-review',
    providerId: OFFLINE_PROVIDER_ID,
    label: 'Campus Simulation · Review',
    capabilities: {
      vision: false,
      contextTokens: 8000,
      reasoning: 3,
      speed: 4,
      local: true,
      free: true,
    },
    suitedFor: ['review', 'test', 'analysis'],
  },
  {
    id: 'campus-sim-vision',
    providerId: OFFLINE_PROVIDER_ID,
    label: 'Campus Simulation · Vision',
    capabilities: {
      vision: true,
      contextTokens: 8000,
      reasoning: 2,
      speed: 4,
      local: true,
      free: true,
    },
    suitedFor: ['vision', 'classify'],
  },
];

/** Deterministic hash so the same instruction always yields the same artefact. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pull the meaningful words out of an instruction to echo back in output. */
function keyPhrases(text: string, limit = 6): string[] {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'by', 'is', 'are',
    'be', 'this', 'that', 'it', 'as', 'from', 'at', 'into', 'then', 'me', 'my', 'i', 'we',
    'create', 'make', 'do', 'please', 'need', 'want', 'have', 'get', 'give', 'using', 'use',
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#.-]+/)) {
    const w = raw.trim();
    if (w.length < 3 || stop.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Compose a structured artefact appropriate to the kind of work. The shape
 * differs per kind so downstream review and aggregation have something real to
 * operate on.
 */
function compose(req: GenerateRequest, seed: number): string {
  const topics = keyPhrases(req.prompt);
  const subject = topics.slice(0, 3).map(titleCase).join(', ') || 'the assignment';
  const ctx = req.context.length > 0
    ? `\n\nDrew on ${req.context.length} item(s) from the knowledge vault.`
    : '';

  const bullets = (n: number, lead: string): string =>
    Array.from({ length: n }, (_, i) => {
      const t = topics[(seed + i) % Math.max(1, topics.length)] ?? 'the objective';
      return `- ${lead} ${titleCase(t)}.`;
    }).join('\n');

  switch (req.kind) {
    case 'research':
      return `${SIMULATED_MARK}\n\n## Research notes: ${subject}\n\n### Findings\n${bullets(3, 'Established the current position on')}\n\n### Open questions\n${bullets(2, 'Needs confirmation regarding')}${ctx}`;

    case 'analysis':
      return `${SIMULATED_MARK}\n\n## Analysis: ${subject}\n\n### Observations\n${bullets(3, 'The evidence points toward')}\n\n### Assessment\nThe material supports proceeding, with the caveats noted above.${ctx}`;

    case 'planning':
      return `${SIMULATED_MARK}\n\n## Plan: ${subject}\n\n### Approach\n${bullets(4, 'Step — address')}\n\n### Risks\n${bullets(2, 'Watch for delays in')}${ctx}`;

    case 'writing':
      return `${SIMULATED_MARK}\n\n## Draft: ${subject}\n\n${topics.slice(0, 4).map((t) => `${titleCase(t)} forms a central part of this piece, and the draft develops it in full.`).join(' ')}\n\n### Structure\n${bullets(3, 'Section covering')}${ctx}`;

    case 'build':
      return `${SIMULATED_MARK}\n\n## Build output: ${subject}\n\n### Artefacts produced\n${bullets(3, 'Component implementing')}\n\n### Notes\nAssembled and ready for review.${ctx}`;

    case 'review':
      // Deterministic pass/fail so the review loop is genuinely exercised.
      return seed % 5 === 0
        ? `${SIMULATED_MARK}\n\n## Review: revisions requested\n\n### Issues\n${bullets(2, 'Insufficient depth on')}\n\n### Verdict\nREVISE — address the points above and resubmit.`
        : `${SIMULATED_MARK}\n\n## Review: approved\n\n### Checked\n${bullets(2, 'Verified coverage of')}\n\n### Verdict\nPASS — the work meets the brief.`;

    case 'test':
      return `${SIMULATED_MARK}\n\n## Test report: ${subject}\n\n${bullets(3, 'Exercised')}\n\n### Result\nAll checks completed.${ctx}`;

    case 'summarize':
      return `${SIMULATED_MARK}\n\n## Summary: ${subject}\n\n${bullets(3, 'Key point regarding')}${ctx}`;

    case 'classify':
      return `${SIMULATED_MARK}\n\n## Classification: ${subject}\n\nCategory: ${topics[0] ? titleCase(topics[0]) : 'General'}\nConfidence: ${(0.7 + (seed % 25) / 100).toFixed(2)}${ctx}`;

    case 'vision':
      return `${SIMULATED_MARK}\n\n## Image assessment\n\n${bullets(3, 'Observed element resembling')}\n\nNo real image analysis was performed — connect a vision-capable local model for genuine results.${ctx}`;
  }
}

export class OfflineProvider implements AiProviderAdapter {
  readonly id = OFFLINE_PROVIDER_ID;
  readonly label = 'Offline Simulation';
  readonly free = true;
  readonly local = true;

  async probe(): Promise<ProviderStatus> {
    // Always available: it is in-process, so there is nothing to fail.
    return {
      id: this.id,
      label: this.label,
      health: 'available',
      detail: 'Built in. Free, local, always available. Produces simulated deliverables.',
      models: MODELS,
      free: true,
      local: true,
      lastCheckedAt: Date.now(),
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return MODELS;
  }

  async generate(
    req: GenerateRequest,
    modelId: string,
    config: ProviderConfig,
  ): Promise<GenerateResult> {
    const started = Date.now();
    const seed = hash(`${req.prompt}${req.kind}${modelId}${req.nonce ?? 0}`);

    // A short, bounded delay so the campus animates at a watchable pace and
    // concurrency is genuinely exercised. Deterministic per instruction, and
    // overridable so headless runs execute at full speed.
    const delay = config.offlineDelayMs ?? 600 + (seed % 1400);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      req.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      });
    });

    if (req.signal?.aborted) {
      return {
        text: '',
        modelId,
        providerId: this.id,
        durationMs: Date.now() - started,
        cost: 0,
        error: 'Cancelled.',
      };
    }

    // A small deterministic failure rate keeps the recovery path honest: retry,
    // model switch and reassignment are all real code paths that must work.
    if (seed % 17 === 0) {
      return {
        text: '',
        modelId,
        providerId: this.id,
        durationMs: Date.now() - started,
        cost: 0,
        error: 'Simulated worker fault — the task did not complete.',
      };
    }

    return {
      text: compose(req, seed),
      modelId,
      providerId: this.id,
      durationMs: Date.now() - started,
      cost: 0,
      error: null,
    };
  }
}
