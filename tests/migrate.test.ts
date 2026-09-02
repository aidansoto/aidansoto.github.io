import { describe, it, expect } from 'vitest';
import { migrate, CURRENT_SCHEMA_VERSION } from '@/config/migrate';
import { normalizeCampus } from '@/config/schema';
import { createDefaultCampus } from '@/config/defaultCampus';
import { MAX_AGENTS } from '@/core/mission';

/**
 * A realistic v1 campus: the shape the previous release actually persisted,
 * including owner edits (renamed campus, renamed building, custom settings)
 * that migration must not touch.
 */
function v1Document(agentCount = 18): Record<string, unknown> {
  const base = createDefaultCampus() as unknown as Record<string, unknown>;
  const agents = Array.from({ length: agentCount }, (_, i) => ({
    id: `agent_${String(i + 1).padStart(3, '0')}`,
    name: `Agent ${String(i + 1).padStart(2, '0')}`,
    role: 'Unassigned',
    presentation: i % 2 === 0 ? 'suit_black' : 'suit_alt',
    suitVariant: 0,
    homeBuildingId: 'building_operations',
    homeRoomId: 'building_operations_room_01',
    speed: 2.8,
  }));

  const doc: Record<string, unknown> = {
    version: 1,
    campusName: 'Aidan Estate',
    gridSize: base.gridSize,
    buildings: base.buildings,
    agents,
    props: base.props,
    paths: base.paths,
    water: base.water,
    plots: base.plots,
    bridges: base.bridges,
    themeId: 'obsidian_night',
    settings: {
      timeOfDay: 'day',
      weather: 'rain',
      animationSpeed: 1.75,
      soundEnabled: true,
      aiProvider: 'offline',
    },
  };
  // v1 had none of the mission-control collections.
  return JSON.parse(JSON.stringify(doc));
}

describe('migrate v1 → v2', () => {
  it('stamps the current schema version', () => {
    const { doc } = migrate(v1Document());
    expect(doc.version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('reports the upgrade so the owner sees it', () => {
    const { notes } = migrate(v1Document());
    expect(notes.some((n) => n.includes('upgraded from schema v1'))).toBe(true);
  });

  it('preserves owner edits exactly', () => {
    const { doc } = migrate(v1Document());
    expect(doc.campusName).toBe('Aidan Estate');
    const settings = doc.settings as Record<string, unknown>;
    expect(settings.timeOfDay).toBe('day');
    expect(settings.weather).toBe('rain');
    expect(settings.animationSpeed).toBe(1.75);
    expect(settings.soundEnabled).toBe(true);
  });

  it('preserves every building untouched', () => {
    const before = v1Document();
    const beforeBuildings = JSON.parse(JSON.stringify(before.buildings));
    const { doc } = migrate(before);
    expect(doc.buildings).toEqual(beforeBuildings);
  });

  it('caps the roster at ten and archives the rest instead of deleting', () => {
    const { doc, notes } = migrate(v1Document(18));
    const agents = doc.agents as unknown[];
    const archived = doc.archivedAgents as unknown[];

    expect(agents).toHaveLength(MAX_AGENTS);
    expect(archived).toHaveLength(8);
    // Nothing is lost: every original agent is still somewhere in the document.
    expect(agents.length + archived.length).toBe(18);
    expect(notes.some((n) => n.includes('archived, not deleted'))).toBe(true);
  });

  it('leaves a roster already within the cap alone', () => {
    const { doc } = migrate(v1Document(6));
    expect(doc.agents as unknown[]).toHaveLength(6);
    expect(doc.archivedAgents).toBeUndefined();
  });

  it('designates a Manager from the surviving roster', () => {
    const { doc, notes } = migrate(v1Document());
    expect(doc.managerAgentId).toBe('agent_001');
    expect(notes.some((n) => n.includes('designated Manager'))).toBe(true);
  });

  it('keeps an existing Manager designation', () => {
    const input = v1Document();
    input.managerAgentId = 'agent_004';
    const { doc } = migrate(input);
    expect(doc.managerAgentId).toBe('agent_004');
  });

  it('adds the mission-control collections as empty arrays', () => {
    const { doc } = migrate(v1Document());
    for (const key of ['missions', 'subtasks', 'assignments', 'memory', 'modelStats', 'knowledge', 'workflows']) {
      expect(Array.isArray(doc[key]), key).toBe(true);
      expect(doc[key] as unknown[]).toHaveLength(0);
    }
  });

  it('defaults new settings to the free, local configuration', () => {
    const { doc } = migrate(v1Document());
    const s = doc.settings as Record<string, unknown>;
    expect(s.routingMode).toBe('auto_free');
    expect(s.smartRouter).toBe(true);
    expect(s.notifications).toBe(true);
    expect(s.ollamaUrl).toBe('http://127.0.0.1:11434');
  });

  it('is idempotent — migrating twice changes nothing further', () => {
    const once = migrate(v1Document()).doc;
    const snapshot = JSON.parse(JSON.stringify(once));
    const twice = migrate(once).doc;
    expect(twice).toEqual(snapshot);
  });

  it('never throws on junk input', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      expect(() => migrate(junk)).not.toThrow();
    }
  });
});

describe('a v1 campus loaded through normalizeCampus', () => {
  it('survives the full load path with data intact', () => {
    const { doc, repairs } = normalizeCampus(v1Document(18));

    expect(doc.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.campusName).toBe('Aidan Estate');
    expect(doc.buildings).toHaveLength(10);
    expect(doc.agents).toHaveLength(MAX_AGENTS);
    expect(doc.managerAgentId).toBe('agent_001');
    expect(doc.settings.weather).toBe('rain');
    expect(doc.settings.routingMode).toBe('auto_free');
    expect(repairs.some((r) => r.includes('upgraded'))).toBe(true);
  });

  it('keeps the Manager on the roster after the cap trims it', () => {
    const input = v1Document(18);
    // A manager that migration is about to archive must be re-designated.
    input.managerAgentId = 'agent_015';
    const { doc } = normalizeCampus(input);
    expect(doc.agents.some((a) => a.id === doc.managerAgentId)).toBe(true);
  });

  it('returns subtasks to the queue when their agent is gone', () => {
    const input = v1Document(10);
    input.subtasks = [
      {
        id: 'st_1',
        missionId: 'm_1',
        title: 'Orphan',
        instruction: 'x',
        kind: 'research',
        status: 'in_progress',
        order: 0,
        dependsOn: [],
        assignedAgentId: 'agent_999',
        roleLabel: 'Researcher',
        reviewerAgentId: null,
        requiresReview: false,
        requiresOwnerApproval: false,
        providerId: null,
        modelId: null,
        routingReason: null,
        output: null,
        reviewNotes: null,
        attempts: [],
        retryCount: 0,
        revisionCount: 0,
        createdAt: 0,
        startedAt: null,
        completedAt: null,
      },
    ];
    const { doc, repairs } = normalizeCampus(input);
    expect(doc.subtasks[0].assignedAgentId).toBeNull();
    expect(doc.subtasks[0].status).toBe('ready');
    expect(repairs.some((r) => r.includes('returned to the queue'))).toBe(true);
  });

  it('drops role assignments pointing at agents that no longer exist', () => {
    const input = v1Document(10);
    input.assignments = [
      { agentId: 'agent_002', missionId: 'm', roleLabel: 'Writer', assignedBy: 'agent_001', assignedAt: 0, currentSubtaskId: null },
      { agentId: 'ghost', missionId: 'm', roleLabel: 'Ghost', assignedBy: 'agent_001', assignedAt: 0, currentSubtaskId: null },
    ];
    const { doc } = normalizeCampus(input);
    expect(doc.assignments).toHaveLength(1);
    expect(doc.assignments[0].agentId).toBe('agent_002');
  });
});

describe('the default campus at v2', () => {
  const doc = createDefaultCampus();

  it('ships exactly ten agents', () => {
    expect(doc.agents).toHaveLength(MAX_AGENTS);
  });

  it('designates a Manager who is on the roster', () => {
    expect(doc.managerAgentId).not.toBeNull();
    expect(doc.agents.some((a) => a.id === doc.managerAgentId)).toBe(true);
  });

  it('gives no agent a permanent role', () => {
    for (const a of doc.agents) expect(a.role).toBe('Unassigned');
  });

  it('defaults to free-only routing', () => {
    expect(doc.settings.routingMode).toBe('auto_free');
    expect(doc.settings.aiProvider).toBe('offline');
  });
});
