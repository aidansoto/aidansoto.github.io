/**
 * Persistence adapter.
 *
 * Two backends behind one interface:
 *   - Tauri  → SQLite on disk, via `load_document` / `save_document` commands.
 *   - Browser → localStorage, so `npm run dev` in a plain browser still
 *               persists and the visual work can be iterated without Rust.
 *
 * The rest of the app only ever sees `CampusStore`.
 */

import type { CampusDocument } from '@/core/types';
import { normalizeCampus } from '@/config/schema';
import { createDefaultCampus } from '@/config/defaultCampus';

const DOC_KEY = 'campus.document';
const WEB_PREFIX = 'obsidian-campus:';

export interface CampusStore {
  readonly backend: 'sqlite' | 'localstorage' | 'memory';
  load(): Promise<{ doc: CampusDocument; repairs: string[] }>;
  save(doc: CampusDocument): Promise<void>;
  reset(): Promise<CampusDocument>;
}

/** True when running inside the Tauri shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/* ------------------------------------------------------------------ */
/* Tauri / SQLite                                                      */
/* ------------------------------------------------------------------ */

class TauriStore implements CampusStore {
  readonly backend = 'sqlite' as const;

  private async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const mod = await import('@tauri-apps/api/core');
    return mod.invoke<T>(cmd, args);
  }

  async load(): Promise<{ doc: CampusDocument; repairs: string[] }> {
    const raw = await this.invoke<string | null>('load_document', { key: DOC_KEY });
    if (!raw) {
      const doc = createDefaultCampus();
      await this.save(doc);
      return { doc, repairs: [] };
    }
    return parseAndNormalize(raw);
  }

  async save(doc: CampusDocument): Promise<void> {
    await this.invoke('save_document', { key: DOC_KEY, value: JSON.stringify(doc) });
  }

  async reset(): Promise<CampusDocument> {
    const doc = createDefaultCampus();
    await this.save(doc);
    return doc;
  }
}

/* ------------------------------------------------------------------ */
/* Browser                                                             */
/* ------------------------------------------------------------------ */

class WebStore implements CampusStore {
  readonly backend = 'localstorage' as const;

  async load(): Promise<{ doc: CampusDocument; repairs: string[] }> {
    const raw = localStorage.getItem(WEB_PREFIX + DOC_KEY);
    if (!raw) {
      const doc = createDefaultCampus();
      await this.save(doc);
      return { doc, repairs: [] };
    }
    return parseAndNormalize(raw);
  }

  async save(doc: CampusDocument): Promise<void> {
    try {
      localStorage.setItem(WEB_PREFIX + DOC_KEY, JSON.stringify(doc));
    } catch {
      // Quota exhausted — the campus keeps running from memory.
    }
  }

  async reset(): Promise<CampusDocument> {
    localStorage.removeItem(WEB_PREFIX + DOC_KEY);
    const doc = createDefaultCampus();
    await this.save(doc);
    return doc;
  }
}

/* ------------------------------------------------------------------ */
/* Memory (tests / SSR)                                                */
/* ------------------------------------------------------------------ */

export class MemoryStore implements CampusStore {
  readonly backend = 'memory' as const;
  private raw: string | null = null;

  async load(): Promise<{ doc: CampusDocument; repairs: string[] }> {
    if (!this.raw) {
      const doc = createDefaultCampus();
      await this.save(doc);
      return { doc, repairs: [] };
    }
    return parseAndNormalize(this.raw);
  }

  async save(doc: CampusDocument): Promise<void> {
    this.raw = JSON.stringify(doc);
  }

  async reset(): Promise<CampusDocument> {
    this.raw = null;
    const doc = createDefaultCampus();
    await this.save(doc);
    return doc;
  }
}

/* ------------------------------------------------------------------ */

export function parseAndNormalize(raw: string): { doc: CampusDocument; repairs: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      doc: createDefaultCampus(),
      repairs: ['Saved campus file was unreadable — restored the default layout.'],
    };
  }
  return normalizeCampus(parsed);
}

let singleton: CampusStore | null = null;

export function getStore(): CampusStore {
  if (singleton) return singleton;
  if (isTauri()) singleton = new TauriStore();
  else if (typeof localStorage !== 'undefined') singleton = new WebStore();
  else singleton = new MemoryStore();
  return singleton;
}

/**
 * Debounced writer with a ceiling on how long a change may go unwritten.
 *
 * Settings changes fire constantly while a slider is being dragged; disk should
 * see one write, not four hundred. But a plain trailing debounce starves under
 * sustained change: a running mission touches the document every few hundred
 * milliseconds, so the timer is cleared before it ever fires and nothing
 * reaches disk until the campus finally goes quiet. A force-quit mid-mission
 * would then lose the whole mission. `maxWaitMs` bounds that: once a change has
 * been waiting that long, the next `schedule` writes instead of deferring.
 */
export function createAutosave(store: CampusStore, delayMs = 700, maxWaitMs = 3000): {
  schedule(doc: CampusDocument): void;
  flush(): Promise<void>;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: CampusDocument | null = null;
  /** When the oldest currently-unwritten change arrived. */
  let oldestPendingAt = 0;

  const write = async (): Promise<void> => {
    if (!pending) return;
    const doc = pending;
    pending = null;
    oldestPendingAt = 0;
    await store.save(doc);
  };

  return {
    schedule(doc: CampusDocument): void {
      const now = Date.now();
      if (!pending) oldestPendingAt = now;
      pending = doc;

      if (now - oldestPendingAt >= maxWaitMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        void write();
        return;
      }

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void write();
      }, delayMs);
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await write();
    },
  };
}
