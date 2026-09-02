/**
 * AI provider abstraction.
 *
 * Everything the orchestrator needs from a "brain" is behind this interface,
 * so adding Ollama, a local runtime, or a hosted API later is a matter of
 * implementing `AiProviderAdapter` and registering it — not touching the
 * Manager, the router, or any UI.
 *
 * COST RULE
 * ---------
 * Every model declares `free`. The router refuses to select a non-free model
 * unless the mission's routing mode explicitly permits it, and no adapter in
 * this build contacts a paid service at all.
 */

import type { WorkKind } from '@/core/mission';

/** What a model can do. Used for routing, not for marketing. */
export interface ModelCapabilities {
  /** Accepts images as input. */
  vision: boolean;
  /** Approximate usable context window, in tokens. */
  contextTokens: number;
  /** 1 (weakest) … 5 (strongest) — relative reasoning strength. */
  reasoning: 1 | 2 | 3 | 4 | 5;
  /** 1 (slowest) … 5 (fastest) — relative latency. */
  speed: 1 | 2 | 3 | 4 | 5;
  /** True when inference happens on this machine and no data leaves it. */
  local: boolean;
  /** True when using this model can never produce a charge. */
  free: boolean;
}

export interface ModelDescriptor {
  id: string;
  providerId: string;
  label: string;
  capabilities: ModelCapabilities;
  /** Work kinds this model is a particularly good fit for. */
  suitedFor: WorkKind[];
}

export interface GenerateRequest {
  /** System-level framing for the work. */
  system: string;
  /** The actual instruction. */
  prompt: string;
  /** Relevant knowledge retrieved for this task, already trimmed. */
  context: string[];
  kind: WorkKind;
  /** Soft cap on output length. */
  maxTokens: number;
  /**
   * Distinguishes repeat attempts at the same work. A retry must be a genuinely
   * new attempt, not a replay of the one that just failed.
   */
  nonce?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  modelId: string;
  providerId: string;
  durationMs: number;
  /** Always 0 for free/local models. */
  cost: number;
  /** Set when generation failed; `text` is then a best-effort explanation. */
  error: string | null;
}

export type ProviderHealth = 'available' | 'unavailable' | 'unknown' | 'checking';

export interface ProviderStatus {
  id: string;
  label: string;
  health: ProviderHealth;
  /** Why it is unavailable, in language the owner can act on. */
  detail: string;
  models: ModelDescriptor[];
  /** True when nothing this provider does can ever cost money. */
  free: boolean;
  /** True when inference is on-device. */
  local: boolean;
  lastCheckedAt: number;
}

export interface AiProviderAdapter {
  readonly id: string;
  readonly label: string;
  readonly free: boolean;
  readonly local: boolean;

  /**
   * Probe availability. Must never throw and must never block for long — the
   * dashboard calls this on a timer.
   */
  probe(config: ProviderConfig): Promise<ProviderStatus>;

  /** Models currently usable. Empty when the provider is unavailable. */
  listModels(config: ProviderConfig): Promise<ModelDescriptor[]>;

  /** Run one unit of work. Must resolve — errors come back in `error`. */
  generate(req: GenerateRequest, modelId: string, config: ProviderConfig): Promise<GenerateResult>;
}

export interface ProviderConfig {
  ollamaUrl: string;
  /**
   * Overrides the offline provider's artificial think-time. The default pace
   * exists so campus animation is watchable; tests and headless runs set this
   * low to execute at full speed.
   */
  offlineDelayMs?: number;
}
