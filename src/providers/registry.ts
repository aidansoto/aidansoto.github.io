/**
 * Provider registry.
 *
 * Holds the available adapters, caches their health, and is the single place
 * the rest of the app asks "what brains can I use right now?".
 *
 * Adding a provider later — a different local runtime, or a hosted API — means
 * writing one adapter and registering it here. Nothing else changes.
 */

import type { AiProviderAdapter, ModelDescriptor, ProviderConfig, ProviderStatus } from './types';
import { OfflineProvider, OFFLINE_PROVIDER_ID } from './offline';
import { OllamaProvider, OLLAMA_PROVIDER_ID } from './ollama';

export class ProviderRegistry {
  private adapters = new Map<string, AiProviderAdapter>();
  private statuses = new Map<string, ProviderStatus>();
  private inFlight = new Map<string, Promise<ProviderStatus>>();

  constructor() {
    this.register(new OfflineProvider());
    this.register(new OllamaProvider());
  }

  register(adapter: AiProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.statuses.set(adapter.id, {
      id: adapter.id,
      label: adapter.label,
      health: 'unknown',
      detail: 'Not yet checked.',
      models: [],
      free: adapter.free,
      local: adapter.local,
      lastCheckedAt: 0,
    });
  }

  get(id: string): AiProviderAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  list(): AiProviderAdapter[] {
    return [...this.adapters.values()];
  }

  statusOf(id: string): ProviderStatus | null {
    return this.statuses.get(id) ?? null;
  }

  allStatuses(): ProviderStatus[] {
    return [...this.statuses.values()];
  }

  /**
   * Refresh health for every provider. Concurrent calls for the same provider
   * share one probe, so a fast dashboard timer cannot pile up requests.
   */
  async probeAll(config: ProviderConfig): Promise<ProviderStatus[]> {
    const results = await Promise.all(this.list().map((a) => this.probe(a.id, config)));
    return results.filter((r): r is ProviderStatus => r !== null);
  }

  async probe(id: string, config: ProviderConfig): Promise<ProviderStatus | null> {
    const adapter = this.adapters.get(id);
    if (!adapter) return null;

    const existing = this.inFlight.get(id);
    if (existing) return existing;

    const current = this.statuses.get(id);
    if (current) this.statuses.set(id, { ...current, health: 'checking' });

    const run = adapter
      .probe(config)
      .catch(
        (err): ProviderStatus => ({
          id: adapter.id,
          label: adapter.label,
          health: 'unavailable',
          detail: err instanceof Error ? err.message : String(err),
          models: [],
          free: adapter.free,
          local: adapter.local,
          lastCheckedAt: Date.now(),
        }),
      )
      .then((status) => {
        this.statuses.set(id, status);
        this.inFlight.delete(id);
        return status;
      });

    this.inFlight.set(id, run);
    return run;
  }

  /** Every model currently usable, across all available providers. */
  availableModels(): ModelDescriptor[] {
    const out: ModelDescriptor[] = [];
    for (const status of this.statuses.values()) {
      if (status.health !== 'available') continue;
      out.push(...status.models);
    }
    return out;
  }

  /** Models that can never produce a charge. */
  freeModels(): ModelDescriptor[] {
    return this.availableModels().filter((m) => m.capabilities.free);
  }
}

export const providers = new ProviderRegistry();
export { OFFLINE_PROVIDER_ID, OLLAMA_PROVIDER_ID };
