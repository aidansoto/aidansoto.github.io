/**
 * Campus document migrations.
 *
 * Every persisted document passes through here on load, before normalisation.
 * Migrations are additive and lossless: a v1 campus keeps its buildings,
 * agents, layout, landscaping and settings exactly as saved, and simply gains
 * the fields the newer schema expects.
 *
 * The one destructive step is the 10-agent cap introduced in v2, and it is
 * handled explicitly: agents beyond the cap are *archived into the document*
 * rather than deleted, so nothing the owner configured is lost and the roster
 * can be restored by raising the cap later.
 */

import { MAX_AGENTS } from '@/core/mission';

export const CURRENT_SCHEMA_VERSION = 2;

export interface MigrationResult {
  /** Mutated in place and returned for convenience. */
  doc: Record<string, unknown>;
  notes: string[];
}

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Bring any older document up to `CURRENT_SCHEMA_VERSION`.
 * Never throws — an unrecognisable document is handed on untouched for
 * `normalizeCampus` to repair or replace.
 */
export function migrate(input: unknown): MigrationResult {
  const notes: string[] = [];
  if (!isRecord(input)) return { doc: {}, notes };

  const doc = input;
  const from = typeof doc.version === 'number' ? doc.version : 0;

  if (from < 2) migrateV1toV2(doc, notes);

  doc.version = CURRENT_SCHEMA_VERSION;
  if (from > 0 && from < CURRENT_SCHEMA_VERSION) {
    notes.unshift(`Campus upgraded from schema v${from} to v${CURRENT_SCHEMA_VERSION}.`);
  }
  return { doc, notes };
}

/**
 * v1 → v2: mission control.
 *
 * Adds missions, subtasks, temporary role assignments, manager memory, model
 * performance, the knowledge vault and workflows. Designates a Manager. Caps
 * the active roster at ten agents, archiving the remainder.
 */
function migrateV1toV2(doc: Raw, notes: string[]): void {
  const agents = Array.isArray(doc.agents) ? (doc.agents as Raw[]) : [];

  /* -- Agent cap ---------------------------------------------------- */
  if (agents.length > MAX_AGENTS) {
    const kept = agents.slice(0, MAX_AGENTS);
    const archived = agents.slice(MAX_AGENTS);
    doc.agents = kept;
    // Preserved, not destroyed. Restoring is a matter of moving entries back.
    const existingArchive = Array.isArray(doc.archivedAgents) ? (doc.archivedAgents as Raw[]) : [];
    doc.archivedAgents = [...existingArchive, ...archived];
    notes.push(
      `Roster capped at ${MAX_AGENTS} agents — ${archived.length} additional agent(s) were archived, not deleted.`,
    );
  }

  /* -- Manager designation ------------------------------------------ */
  if (typeof doc.managerAgentId !== 'string' || doc.managerAgentId.length === 0) {
    const roster = Array.isArray(doc.agents) ? (doc.agents as Raw[]) : [];
    const first = roster[0];
    const managerId = first && typeof first.id === 'string' ? first.id : null;
    doc.managerAgentId = managerId;
    if (managerId) {
      const name = typeof first.name === 'string' ? first.name : managerId;
      notes.push(`${name} was designated Manager. You can change this at any time.`);
    }
  }

  /* -- New collections ---------------------------------------------- */
  for (const key of ['missions', 'subtasks', 'assignments', 'memory', 'modelStats', 'knowledge', 'workflows']) {
    if (!Array.isArray(doc[key])) doc[key] = [];
  }

  /* -- New settings -------------------------------------------------- */
  const settings = isRecord(doc.settings) ? doc.settings : {};
  if (typeof settings.routingMode !== 'string') settings.routingMode = 'auto_free';
  if (typeof settings.smartRouter !== 'boolean') settings.smartRouter = true;
  if (typeof settings.notifications !== 'boolean') settings.notifications = true;
  if (typeof settings.ollamaUrl !== 'string') settings.ollamaUrl = 'http://127.0.0.1:11434';
  if (typeof settings.ambientTaskSimulation !== 'boolean') settings.ambientTaskSimulation = true;
  doc.settings = settings;
}
