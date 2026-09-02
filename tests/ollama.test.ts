import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { OllamaProvider } from '@/providers/ollama';
import { ProviderRegistry } from '@/providers/registry';
import type { GenerateRequest } from '@/providers/types';

/**
 * A stand-in Ollama server speaking the real wire protocol.
 *
 * This exercises the adapter over actual HTTP — request shape, response
 * parsing, error mapping and timeouts — rather than mocking `fetch`. If this
 * passes, pointing the campus at a genuine `ollama serve` is the same code
 * path with a different process on the other end.
 */
let server: Server;
let baseUrl: string;
let mode: 'ok' | 'empty_models' | 'error_status' | 'model_error' | 'empty_response' | 'hang' = 'ok';
let lastGenerateBody: Record<string, unknown> | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/api/tags') {
      if (mode === 'error_status') {
        res.writeHead(500).end('boom');
        return;
      }
      const models =
        mode === 'empty_models'
          ? []
          : [
              { name: 'llama3.2:3b', details: { parameter_size: '3.2B', family: 'llama' } },
              { name: 'qwen2.5-coder:7b', details: { parameter_size: '7.6B' } },
              { name: 'llava:13b', details: { parameter_size: '13B' } },
            ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));
      return;
    }

    if (req.url === '/api/generate') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          lastGenerateBody = JSON.parse(body);
        } catch {
          lastGenerateBody = null;
        }
        if (mode === 'hang') return; // never responds — exercises the timeout
        if (mode === 'error_status') {
          res.writeHead(404).end('no such model');
          return;
        }
        if (mode === 'model_error') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'model requires more system memory' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            response:
              mode === 'empty_response' ? '' : '  ## Findings\nThe local model produced this.  ',
            done: true,
          }),
        );
      });
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  system: 'You are a campus worker agent.',
  prompt: 'Research the topic.',
  context: [],
  kind: 'research',
  maxTokens: 512,
  ...over,
});

describe('OllamaProvider against a live HTTP server', () => {
  const provider = new OllamaProvider();

  it('is free and local by definition', () => {
    expect(provider.free).toBe(true);
    expect(provider.local).toBe(true);
  });

  it('lists installed models with inferred capabilities', async () => {
    mode = 'ok';
    const models = await provider.listModels({ ollamaUrl: baseUrl });
    expect(models).toHaveLength(3);
    expect(models.every((m) => m.capabilities.free && m.capabilities.local)).toBe(true);

    const vision = models.find((m) => m.id === 'llava:13b')!;
    expect(vision.capabilities.vision).toBe(true);

    const coder = models.find((m) => m.id === 'qwen2.5-coder:7b')!;
    expect(coder.suitedFor).toContain('build');
  });

  it('reports available when models are installed', async () => {
    mode = 'ok';
    const status = await provider.probe({ ollamaUrl: baseUrl });
    expect(status.health).toBe('available');
    expect(status.free).toBe(true);
    expect(status.detail).toContain('nothing leaves this Mac');
  });

  it('explains how to install a model when none are present', async () => {
    mode = 'empty_models';
    const status = await provider.probe({ ollamaUrl: baseUrl });
    expect(status.health).toBe('unavailable');
    expect(status.detail).toContain('ollama pull');
  });

  it('reports unavailable, with instructions, when nothing is listening', async () => {
    mode = 'ok';
    // Port 1 is reserved and never accepts connections.
    const status = await provider.probe({ ollamaUrl: 'http://127.0.0.1:1' });
    expect(status.health).toBe('unavailable');
    expect(status.detail).toMatch(/ollama serve|Unavailable/);
    expect(status.models).toEqual([]);
  });

  it('generates text and reports zero cost', async () => {
    mode = 'ok';
    const result = await provider.generate(req(), 'llama3.2:3b', { ollamaUrl: baseUrl });
    expect(result.error).toBeNull();
    expect(result.text).toBe('## Findings\nThe local model produced this.');
    expect(result.cost).toBe(0);
    expect(result.modelId).toBe('llama3.2:3b');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sends the model, system prompt and non-streaming flag', async () => {
    mode = 'ok';
    await provider.generate(req(), 'llama3.2:3b', { ollamaUrl: baseUrl });
    expect(lastGenerateBody).toMatchObject({
      model: 'llama3.2:3b',
      system: 'You are a campus worker agent.',
      stream: false,
    });
  });

  it('includes retrieved knowledge in the prompt', async () => {
    mode = 'ok';
    await provider.generate(
      req({ context: ['Vault note one', 'Vault note two'] }),
      'llama3.2:3b',
      { ollamaUrl: baseUrl },
    );
    const prompt = String(lastGenerateBody?.prompt ?? '');
    expect(prompt).toContain('knowledge vault');
    expect(prompt).toContain('Vault note one');
    expect(prompt).toContain('[2] Vault note two');
  });

  it('surfaces an HTTP error without throwing', async () => {
    mode = 'error_status';
    const result = await provider.generate(req(), 'ghost:1b', { ollamaUrl: baseUrl });
    expect(result.error).toContain('404');
    expect(result.error).toContain('ghost:1b');
    expect(result.text).toBe('');
  });

  it('surfaces a model-level error message', async () => {
    mode = 'model_error';
    const result = await provider.generate(req(), 'huge:70b', { ollamaUrl: baseUrl });
    expect(result.error).toContain('more system memory');
  });

  it('treats an empty response as an error rather than a silent success', async () => {
    mode = 'empty_response';
    const result = await provider.generate(req(), 'llama3.2:3b', { ollamaUrl: baseUrl });
    expect(result.error).toContain('empty response');
  });

  it('reports a connection failure instead of throwing', async () => {
    mode = 'ok';
    const result = await provider.generate(req(), 'llama3.2:3b', { ollamaUrl: 'http://127.0.0.1:1' });
    expect(result.error).toBeTruthy();
    expect(result.text).toBe('');
    expect(result.cost).toBe(0);
  });

  it('honours a caller abort signal', async () => {
    mode = 'hang';
    const controller = new AbortController();
    const pending = provider.generate(req({ signal: controller.signal }), 'llama3.2:3b', {
      ollamaUrl: baseUrl,
    });
    controller.abort();
    const result = await pending;
    expect(result.error).toBeTruthy();
    mode = 'ok';
  });
});

describe('ProviderRegistry', () => {
  it('always has the offline provider available', async () => {
    const registry = new ProviderRegistry();
    await registry.probeAll({ ollamaUrl: 'http://127.0.0.1:1' });
    const offline = registry.statusOf('offline')!;
    expect(offline.health).toBe('available');
    expect(offline.models.length).toBeGreaterThan(0);
  });

  it('reports every model as free when only free providers are present', async () => {
    const registry = new ProviderRegistry();
    await registry.probeAll({ ollamaUrl: baseUrl });
    const all = registry.availableModels();
    expect(all.length).toBeGreaterThan(0);
    expect(registry.freeModels()).toHaveLength(all.length);
  });

  it('picks up Ollama models once it is reachable', async () => {
    mode = 'ok';
    const registry = new ProviderRegistry();
    await registry.probeAll({ ollamaUrl: baseUrl });
    expect(registry.statusOf('ollama')?.health).toBe('available');
    expect(registry.availableModels().some((m) => m.providerId === 'ollama')).toBe(true);
  });

  it('degrades to offline-only when Ollama is absent', async () => {
    const registry = new ProviderRegistry();
    await registry.probeAll({ ollamaUrl: 'http://127.0.0.1:1' });
    expect(registry.statusOf('ollama')?.health).toBe('unavailable');
    const models = registry.availableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.providerId === 'offline')).toBe(true);
  });

  it('shares one in-flight probe rather than stacking requests', async () => {
    const registry = new ProviderRegistry();
    const [a, b] = await Promise.all([
      registry.probe('ollama', { ollamaUrl: baseUrl }),
      registry.probe('ollama', { ollamaUrl: baseUrl }),
    ]);
    expect(a).toBe(b);
  });
});
