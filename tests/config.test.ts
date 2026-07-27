import { describe, it, expect } from 'vitest';
import { normalizeCampus, normalizeSettings, findFootprintCollisions } from '@/config/schema';
import { createDefaultCampus, defaultSettings, CAMPUS_SCHEMA_VERSION } from '@/config/defaultCampus';
import { resolveTheme, getTheme, THEMES, DEFAULT_THEME_ID } from '@/config/themes';
import { rectsOverlap } from '@/core/iso';

describe('default campus', () => {
  const doc = createDefaultCampus();

  it('ships the ten configured buildings', () => {
    expect(doc.buildings).toHaveLength(10);
  });

  it('gives every building a unique id', () => {
    const ids = new Set(doc.buildings.map((b) => b.id));
    expect(ids.size).toBe(doc.buildings.length);
  });

  it('gives every building a distinct architectural silhouette', () => {
    const styles = new Set(doc.buildings.map((b) => b.style));
    expect(styles.size).toBe(doc.buildings.length);
  });

  it('never overlaps two building footprints', () => {
    expect(findFootprintCollisions(doc.buildings)).toEqual([]);
  });

  it('keeps every footprint inside the grid', () => {
    for (const b of doc.buildings) {
      expect(b.footprint.x).toBeGreaterThanOrEqual(0);
      expect(b.footprint.y).toBeGreaterThanOrEqual(0);
      expect(b.footprint.x + b.footprint.w).toBeLessThanOrEqual(doc.gridSize.w);
      expect(b.footprint.y + b.footprint.h).toBeLessThanOrEqual(doc.gridSize.h);
    }
  });

  it('places every entrance outside its own footprint', () => {
    for (const b of doc.buildings) {
      const f = b.footprint;
      const inside =
        b.entrance.x >= f.x && b.entrance.x < f.x + f.w && b.entrance.y >= f.y && b.entrance.y < f.y + f.h;
      expect(inside, `${b.name} entrance is inside its own mass`).toBe(false);
    }
  });

  it('makes the Command Tower the tallest structure on the campus', () => {
    const tower = doc.buildings.find((b) => b.id === 'building_command_tower')!;
    for (const b of doc.buildings) {
      if (b.id === tower.id) continue;
      expect(b.height).toBeLessThan(tower.height);
    }
  });

  it('marks exactly one building owner-only', () => {
    expect(doc.buildings.filter((b) => b.ownerOnly)).toHaveLength(1);
  });

  it('keeps buildings clear of water and reserved plots', () => {
    for (const b of doc.buildings) {
      for (const w of doc.water) {
        expect(rectsOverlap(b.footprint, w), `${b.name} sits in water`).toBe(false);
      }
      for (const p of doc.plots) {
        expect(rectsOverlap(b.footprint, p), `${b.name} sits on a reserved plot`).toBe(false);
      }
    }
  });

  it('gives every agent a home building and room that exist', () => {
    for (const a of doc.agents) {
      const b = doc.buildings.find((x) => x.id === a.homeBuildingId);
      expect(b, `${a.name} has no home building`).toBeDefined();
      expect(b!.rooms.some((r) => r.id === a.homeRoomId)).toBe(true);
    }
  });

  it('enforces the dress system: alternate palettes are never black', () => {
    const altAgents = doc.agents.filter((a) => a.presentation === 'suit_alt');
    expect(altAgents.length).toBeGreaterThan(0);
    for (const a of altAgents) {
      expect(a.presentation).not.toBe('suit_black');
      expect(a.suitVariant).toBeGreaterThanOrEqual(0);
    }
  });

  it('places exactly one monument', () => {
    expect(doc.props.filter((p) => p.kind === 'monument')).toHaveLength(1);
  });

  it('only defines bridges between buildings that exist', () => {
    for (const bridge of doc.bridges) {
      expect(doc.buildings.some((b) => b.id === bridge.fromBuildingId)).toBe(true);
      expect(doc.buildings.some((b) => b.id === bridge.toBuildingId)).toBe(true);
    }
  });
});

describe('normalizeCampus', () => {
  it('falls back to the default campus for junk input', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      const { doc, repairs } = normalizeCampus(junk);
      expect(doc.buildings.length).toBeGreaterThan(0);
      expect(repairs.length).toBeGreaterThan(0);
    }
  });

  it('round-trips a valid document unchanged in substance', () => {
    const original = createDefaultCampus();
    const { doc } = normalizeCampus(JSON.parse(JSON.stringify(original)));
    expect(doc.buildings.map((b) => b.id)).toEqual(original.buildings.map((b) => b.id));
    expect(doc.agents.map((a) => a.id)).toEqual(original.agents.map((a) => a.id));
    expect(doc.campusName).toBe(original.campusName);
    expect(doc.version).toBe(CAMPUS_SCHEMA_VERSION);
  });

  it('records a migration note for an older schema version', () => {
    const older = { ...createDefaultCampus(), version: 0 };
    const { repairs } = normalizeCampus(JSON.parse(JSON.stringify(older)));
    expect(repairs.some((r) => r.includes('Migrated'))).toBe(true);
  });

  it('drops buildings with an unusable footprint', () => {
    const doc = createDefaultCampus() as unknown as Record<string, unknown>;
    (doc.buildings as unknown[])[0] = { id: 'broken', footprint: { x: 'a', y: 1, w: 2, h: 2 } };
    const result = normalizeCampus(doc);
    expect(result.doc.buildings.some((b) => b.id === 'broken')).toBe(false);
    expect(result.repairs.some((r) => r.includes('broken'))).toBe(true);
  });

  it('relocates an entrance that landed inside the building mass', () => {
    const doc = createDefaultCampus();
    doc.buildings[0].entrance = {
      x: doc.buildings[0].footprint.x + 1,
      y: doc.buildings[0].footprint.y + 1,
    };
    const result = normalizeCampus(JSON.parse(JSON.stringify(doc)));
    const b = result.doc.buildings[0];
    const f = b.footprint;
    const inside =
      b.entrance.x >= f.x && b.entrance.x < f.x + f.w && b.entrance.y >= f.y && b.entrance.y < f.y + f.h;
    expect(inside).toBe(false);
    expect(result.repairs.some((r) => r.includes('entrance'))).toBe(true);
  });

  it('gives a room-less building an open floor', () => {
    const doc = createDefaultCampus();
    doc.buildings[0].rooms = [];
    const result = normalizeCampus(JSON.parse(JSON.stringify(doc)));
    expect(result.doc.buildings[0].rooms.length).toBeGreaterThan(0);
  });

  it('reassigns an agent whose home building vanished', () => {
    const doc = createDefaultCampus();
    doc.agents[0].homeBuildingId = 'building_that_never_existed';
    const result = normalizeCampus(JSON.parse(JSON.stringify(doc)));
    const agent = result.doc.agents.find((a) => a.id === doc.agents[0].id)!;
    expect(result.doc.buildings.some((b) => b.id === agent.homeBuildingId)).toBe(true);
    expect(result.repairs.some((r) => r.includes('home building missing'))).toBe(true);
  });

  it('drops duplicate building ids', () => {
    const doc = createDefaultCampus();
    doc.buildings.push({ ...doc.buildings[0] });
    const result = normalizeCampus(JSON.parse(JSON.stringify(doc)));
    const ids = result.doc.buildings.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.repairs.some((r) => r.includes('Duplicate'))).toBe(true);
  });

  it('drops bridges whose endpoints no longer exist', () => {
    const doc = createDefaultCampus();
    doc.bridges.push({
      id: 'ghost',
      fromBuildingId: 'nope',
      toBuildingId: 'also_nope',
      height: 8,
      width: 1,
    });
    const result = normalizeCampus(JSON.parse(JSON.stringify(doc)));
    expect(result.doc.bridges.some((b) => b.id === 'ghost')).toBe(false);
  });

  it('clamps an out-of-range height instead of rejecting the building', () => {
    const doc = createDefaultCampus();
    doc.buildings[0].height = 9999;
    const result = normalizeCampus(JSON.parse(JSON.stringify(doc)));
    expect(result.doc.buildings[0].height).toBeLessThanOrEqual(60);
  });

  it('restores defaults when every building is unusable', () => {
    const result = normalizeCampus({ buildings: [null, 'x', 7] });
    expect(result.doc.buildings.length).toBe(10);
    expect(result.repairs.some((r) => r.includes('no usable buildings'))).toBe(true);
  });
});

describe('normalizeSettings', () => {
  it('returns defaults for junk', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings('nope')).toEqual(defaultSettings());
  });

  it('rejects unknown enum values', () => {
    const s = normalizeSettings({ timeOfDay: 'dusk', weather: 'hail', performanceMode: 'turbo' });
    expect(s.timeOfDay).toBe('night');
    expect(s.weather).toBe('clear');
    expect(s.performanceMode).toBe('high');
  });

  it('clamps numeric ranges', () => {
    const s = normalizeSettings({ animationSpeed: 900, soundVolume: -4 });
    expect(s.animationSpeed).toBe(3);
    expect(s.soundVolume).toBe(0);
  });

  it('preserves valid values', () => {
    const s = normalizeSettings({ timeOfDay: 'day', weather: 'rain', showAgentLabels: false });
    expect(s.timeOfDay).toBe('day');
    expect(s.weather).toBe('rain');
    expect(s.showAgentLabels).toBe(false);
  });
});

describe('themes', () => {
  it('falls back to the default theme for an unknown id', () => {
    expect(getTheme('does_not_exist').id).toBe(DEFAULT_THEME_ID);
  });

  it('keeps night as the primary grade', () => {
    expect(THEMES[DEFAULT_THEME_ID].id).toBe('obsidian_night');
    expect(THEMES.obsidian_night.ambientLight).toBeLessThan(THEMES.obsidian_day.ambientLight);
  });

  it('honours an explicit day or night override', () => {
    expect(resolveTheme('obsidian_night', 'day').id).toBe('obsidian_day');
    expect(resolveTheme('obsidian_day', 'night').id).toBe('obsidian_night');
  });

  it('leaves custom themes alone unless the override applies', () => {
    expect(resolveTheme('vault', 'night').id).toBe('vault');
    expect(resolveTheme('glacier', 'night').id).toBe('glacier');
  });

  it('picks a grade by the clock in auto mode', () => {
    const theme = resolveTheme('obsidian_night', 'auto');
    expect(['obsidian_day', 'obsidian_night']).toContain(theme.id);
  });
});

describe('findFootprintCollisions', () => {
  it('finds overlapping pairs', () => {
    const doc = createDefaultCampus();
    doc.buildings[1].footprint = { ...doc.buildings[0].footprint };
    const hits = findFootprintCollisions(doc.buildings);
    expect(hits).toContainEqual([doc.buildings[0].id, doc.buildings[1].id]);
  });
});
