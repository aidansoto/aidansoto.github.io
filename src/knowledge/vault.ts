/**
 * Knowledge Vault.
 *
 * Central store for what the campus knows: notes, documents, research,
 * previous outputs, mission results, saved instructions, decisions and
 * reusable procedures.
 *
 * THREE SCOPES, DELIBERATELY SEPARATE
 * -----------------------------------
 *   shared  — campus-wide knowledge every agent may draw on
 *   mission — scoped to one mission; disappears from other missions' context
 *   agent   — one agent's personal memory
 *
 * RETRIEVAL, NOT BULK LOADING
 * ---------------------------
 * `retrieveForTask` scores entries against the task at hand and returns only
 * the few that are actually relevant, trimmed to a token budget. Agents never
 * receive the whole vault — that would waste context, slow local models, and
 * bury the signal.
 */

import type { CampusDocument } from '@/core/types';
import type { KnowledgeEntry, KnowledgeKind, KnowledgeScope, Mission, Subtask } from '@/core/mission';

/** Characters of context handed to one task. Roughly 1,500 tokens. */
const CONTEXT_BUDGET = 6000;
/** Most entries any single task will receive. */
const MAX_ENTRIES = 4;

export interface NewEntry {
  title: string;
  kind: KnowledgeKind;
  scope: KnowledgeScope;
  ownerId?: string | null;
  body: string;
  tags?: string[];
  source: string;
  mime?: string | null;
}

export function createEntry(input: NewEntry): KnowledgeEntry {
  const now = Date.now();
  return {
    id: `kn_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: input.title.trim() || 'Untitled',
    kind: input.kind,
    scope: input.scope,
    ownerId: input.ownerId ?? null,
    body: input.body,
    tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    source: input.source,
    createdAt: now,
    updatedAt: now,
    size: input.body.length,
    mime: input.mime ?? null,
  };
}

export function addEntry(doc: CampusDocument, input: NewEntry): KnowledgeEntry {
  const entry = createEntry(input);
  doc.knowledge = [...doc.knowledge, entry];
  return entry;
}

export function updateEntry(
  doc: CampusDocument,
  id: string,
  patch: Partial<Pick<KnowledgeEntry, 'title' | 'body' | 'tags' | 'kind' | 'scope'>>,
): void {
  const entry = doc.knowledge.find((e) => e.id === id);
  if (!entry) return;
  Object.assign(entry, patch);
  if (patch.body !== undefined) entry.size = patch.body.length;
  entry.updatedAt = Date.now();
}

export function deleteEntry(doc: CampusDocument, id: string): void {
  doc.knowledge = doc.knowledge.filter((e) => e.id !== id);
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'by', 'is', 'are', 'be',
  'this', 'that', 'it', 'as', 'from', 'at', 'into', 'then', 'my', 'we', 'i', 'you', 'your',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Relevance of one entry to a set of query terms.
 *
 * Title and tag matches count for more than body matches, because a document
 * *about* something is more useful than one that merely mentions it.
 */
export function scoreEntry(entry: KnowledgeEntry, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = entry.title.toLowerCase();
  const body = entry.body.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) score += 3;
    if (entry.tags.includes(term)) score += 2.5;
    // Body matches saturate: ten mentions is not ten times as relevant.
    const hits = body.split(term).length - 1;
    if (hits > 0) score += Math.min(2, 0.4 + hits * 0.25);
  }

  // Gentle freshness preference between otherwise equal entries.
  const ageDays = (Date.now() - entry.updatedAt) / (24 * 60 * 60 * 1000);
  score += Math.max(0, 0.5 - ageDays / 120);

  return score;
}

export interface SearchOptions {
  scope?: KnowledgeScope | 'all';
  ownerId?: string | null;
  kind?: KnowledgeKind | 'all';
  limit?: number;
}

export function searchVault(
  entries: KnowledgeEntry[],
  query: string,
  opts: SearchOptions = {},
): KnowledgeEntry[] {
  const { scope = 'all', ownerId, kind = 'all', limit = 50 } = opts;
  const terms = tokenize(query);

  let pool = entries;
  if (scope !== 'all') pool = pool.filter((e) => e.scope === scope);
  if (ownerId !== undefined && ownerId !== null) pool = pool.filter((e) => e.ownerId === ownerId);
  if (kind !== 'all') pool = pool.filter((e) => e.kind === kind);

  // An empty query lists the pool newest-first rather than returning nothing.
  if (terms.length === 0) {
    return [...pool].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  return pool
    .map((e) => ({ e, s: scoreEntry(e, terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
}

/* ------------------------------------------------------------------ */
/* Retrieval for agents                                                */
/* ------------------------------------------------------------------ */

/**
 * The few entries genuinely relevant to one subtask, trimmed to a budget.
 *
 * Draws from shared knowledge, this mission's own knowledge, and the assigned
 * agent's personal memory — never from another mission or another agent.
 */
export function retrieveForTask(doc: CampusDocument, subtask: Subtask, mission: Mission): string[] {
  const query = `${subtask.title} ${subtask.instruction} ${mission.goal}`;
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const visible = doc.knowledge.filter((e) => {
    if (e.scope === 'shared') return true;
    if (e.scope === 'mission') return e.ownerId === mission.id;
    if (e.scope === 'agent') return e.ownerId === subtask.assignedAgentId;
    return false;
  });

  const ranked = visible
    .map((e) => ({ e, s: scoreEntry(e, terms) }))
    .filter((x) => x.s > 1.5) // a bare incidental mention is not context
    .sort((a, b) => b.s - a.s);

  const out: string[] = [];
  let used = 0;

  for (const { e } of ranked.slice(0, MAX_ENTRIES)) {
    const remaining = CONTEXT_BUDGET - used;
    if (remaining < 200) break;
    const body = e.body.length > remaining ? `${e.body.slice(0, remaining - 3)}...` : e.body;
    out.push(`${e.title}\n${body}`);
    used += body.length + e.title.length;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Mission integration                                                 */
/* ------------------------------------------------------------------ */

/** File a completed mission's deliverable into the vault as shared knowledge. */
export function storeMissionResult(
  doc: CampusDocument,
  missionId: string,
  title: string,
  result: string,
): KnowledgeEntry {
  return addEntry(doc, {
    title: `Result: ${title}`,
    kind: 'result',
    scope: 'shared',
    body: result,
    tags: ['mission-result', ...tokenize(title).slice(0, 5)],
    source: `mission ${missionId}`,
  });
}

/** Turn an owner attachment into mission-scoped knowledge agents can retrieve. */
export function storeAttachment(
  doc: CampusDocument,
  missionId: string,
  name: string,
  mime: string,
  content: string,
): KnowledgeEntry {
  const kind: KnowledgeKind = mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : 'document';
  return addEntry(doc, {
    title: name,
    kind,
    scope: 'mission',
    ownerId: missionId,
    body: content,
    tags: ['attachment', ...tokenize(name).slice(0, 4)],
    source: 'owner',
    mime,
  });
}

/** Counts for the vault header. */
export function vaultStats(entries: KnowledgeEntry[]): {
  total: number;
  shared: number;
  mission: number;
  agent: number;
  bytes: number;
} {
  return {
    total: entries.length,
    shared: entries.filter((e) => e.scope === 'shared').length,
    mission: entries.filter((e) => e.scope === 'mission').length,
    agent: entries.filter((e) => e.scope === 'agent').length,
    bytes: entries.reduce((n, e) => n + e.size, 0),
  };
}
