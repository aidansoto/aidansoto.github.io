/**
 * Ollama provider — real local inference, free.
 *
 * Ollama (https://ollama.com) runs open models on your own machine. Nothing
 * leaves the Mac, there is no account, and there are no charges. When it is
 * running, this adapter turns the mission pipeline from simulated deliverables
 * into genuine model output with no other change to the system.
 *
 * The campus never starts Ollama, never installs it, and never contacts it
 * except through `probe` and `generate`. If it is not running, `probe` reports
 * unavailable and the router quietly stays on the offline provider.
 */

import type { WorkKind } from '@/core/mission';
import type {
  AiProviderAdapter,
  GenerateRequest,
  GenerateResult,
  ModelCapabilities,
  ModelDescriptor,
  ProviderConfig,
  ProviderStatus,
} from './types';

export const OLLAMA_PROVIDER_ID = 'ollama';

/** Probe timeout. Ollama is local, so a slow reply means it is not there. */
const PROBE_TIMEOUT_MS = 2500;
/** Generation timeout. Local models on modest hardware can be slow. */
const GENERATE_TIMEOUT_MS = 180_000;

interface OllamaTag {
  name: string;
  size?: number;
  details?: { parameter_size?: string; family?: string };
}

/**
 * Infer capabilities from the model name and reported parameter size.
 * Ollama does not expose a capability manifest, so this is a heuristic — it is
 * used only for routing preference, never for correctness.
 */
export function inferCapabilities(name: string, parameterSize?: string): ModelCapabilities {
  const n = name.toLowerCase();

  const vision = /llava|bakllava|moondream|vision|llama3.2-vision|minicpm-v|qwen2.5-?vl|gemma3/.test(n);

  // Parameter count drives both reasoning strength and speed.
  const paramB = (() => {
    const fromSize = parameterSize?.match(/([\d.]+)\s*B/i);
    if (fromSize) return parseFloat(fromSize[1]);
    const fromName = n.match(/[:-](\d+(?:\.\d+)?)b\b/);
    if (fromName) return parseFloat(fromName[1]);
    return 7;
  })();

  const reasoning: ModelCapabilities['reasoning'] =
    paramB >= 60 ? 5 : paramB >= 27 ? 4 : paramB >= 12 ? 3 : paramB >= 6 ? 2 : 1;
  const speed: ModelCapabilities['speed'] =
    paramB <= 2 ? 5 : paramB <= 5 ? 4 : paramB <= 9 ? 3 : paramB <= 30 ? 2 : 1;

  // Long-context families, when we can recognise them by name.
  const contextTokens = /128k|llama3\.[12]|qwen2\.5|command-r|mistral-nemo/.test(n)
    ? 128_000
    : /32k|mixtral|qwen2/.test(n)
      ? 32_000
      : 8_000;

  return { vision, contextTokens, reasoning, speed, local: true, free: true };
}

/** Which work kinds a model name suggests it is good at. */
export function inferSuitedFor(name: string, caps: ModelCapabilities): WorkKind[] {
  const n = name.toLowerCase();
  const out: WorkKind[] = [];
  if (caps.vision) out.push('vision', 'classify');
  if (/coder|code|deepseek|starcoder|qwen.*coder|codellama/.test(n)) out.push('build', 'test', 'review');
  if (caps.reasoning >= 4) out.push('analysis', 'planning', 'review');
  if (caps.speed >= 4) out.push('classify', 'summarize');
  out.push('research', 'writing', 'summarize');
  return [...new Set(out)];
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Honour a caller-supplied signal alongside our own timeout.
  const external = init.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class OllamaProvider implements AiProviderAdapter {
  readonly id = OLLAMA_PROVIDER_ID;
  readonly label = 'Ollama (local)';
  readonly free = true;
  readonly local = true;

  async probe(config: ProviderConfig): Promise<ProviderStatus> {
    const base: Omit<ProviderStatus, 'health' | 'detail' | 'models'> = {
      id: this.id,
      label: this.label,
      free: true,
      local: true,
      lastCheckedAt: Date.now(),
    };

    try {
      const models = await this.listModels(config);
      if (models.length === 0) {
        return {
          ...base,
          health: 'unavailable',
          detail:
            'Ollama is running but has no models installed. Install one with: ollama pull llama3.2',
          models: [],
        };
      }
      return {
        ...base,
        health: 'available',
        detail: `${models.length} local model(s) ready. Free — nothing leaves this Mac.`,
        models,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const notRunning = /fetch|network|abort|refused|failed/i.test(reason);
      return {
        ...base,
        health: 'unavailable',
        detail: notRunning
          ? 'Not running. Install from ollama.com, then run: ollama serve'
          : `Unavailable: ${reason}`,
        models: [],
      };
    }
  }

  async listModels(config: ProviderConfig): Promise<ModelDescriptor[]> {
    const res = await fetchWithTimeout(
      `${config.ollamaUrl.replace(/\/$/, '')}/api/tags`,
      { method: 'GET' },
      PROBE_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`Ollama replied ${res.status}`);

    const body = (await res.json()) as { models?: OllamaTag[] };
    const tags = Array.isArray(body.models) ? body.models : [];

    return tags.map((t) => {
      const caps = inferCapabilities(t.name, t.details?.parameter_size);
      return {
        id: t.name,
        providerId: this.id,
        label: t.name,
        capabilities: caps,
        suitedFor: inferSuitedFor(t.name, caps),
      };
    });
  }

  async generate(
    req: GenerateRequest,
    modelId: string,
    config: ProviderConfig,
  ): Promise<GenerateResult> {
    const started = Date.now();
    const contextBlock =
      req.context.length > 0
        ? `\n\nRelevant background from the knowledge vault:\n${req.context.map((c, i) => `[${i + 1}] ${c}`).join('\n')}`
        : '';

    try {
      const res = await fetchWithTimeout(
        `${config.ollamaUrl.replace(/\/$/, '')}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            system: req.system,
            prompt: `${req.prompt}${contextBlock}`,
            stream: false,
            options: { num_predict: req.maxTokens },
          }),
          ...(req.signal ? { signal: req.signal } : {}),
        },
        GENERATE_TIMEOUT_MS,
      );

      if (!res.ok) {
        return {
          text: '',
          modelId,
          providerId: this.id,
          durationMs: Date.now() - started,
          cost: 0,
          error: `Ollama replied ${res.status}. Is the model "${modelId}" installed?`,
        };
      }

      const body = (await res.json()) as { response?: string; error?: string };
      if (body.error) {
        return {
          text: '',
          modelId,
          providerId: this.id,
          durationMs: Date.now() - started,
          cost: 0,
          error: body.error,
        };
      }

      const text = (body.response ?? '').trim();
      return {
        text,
        modelId,
        providerId: this.id,
        durationMs: Date.now() - started,
        // Local inference. Always free.
        cost: 0,
        error: text.length === 0 ? 'The model returned an empty response.' : null,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        text: '',
        modelId,
        providerId: this.id,
        durationMs: Date.now() - started,
        cost: 0,
        error: /abort/i.test(reason) ? 'Timed out or cancelled.' : `Could not reach Ollama: ${reason}`,
      };
    }
  }
}
