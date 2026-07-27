/**
 * Campus document validation, normalisation and migration.
 *
 * Persisted documents are user-editable data that may have been written by an
 * older build. Everything loaded from disk goes through `normalizeCampus`,
 * which repairs what it can and falls back to seed values for what it cannot.
 * A corrupt config should degrade the campus, never prevent it from opening.
 */

import type {
  AgentConfig,
  BuildingConfig,
  BuildingStyle,
  CampusDocument,
  CampusSettings,
  GridRect,
  PropConfig,
  PropKind,
} from '@/core/types';
import { clamp } from '@/core/iso';
import { THEMES, DEFAULT_THEME_ID } from './themes';
import {
  CAMPUS_SCHEMA_VERSION,
  GRID_H,
  GRID_W,
  createDefaultCampus,
  defaultSettings,
} from './defaultCampus';

const BUILDING_STYLES: BuildingStyle[] = [
  'tower',
  'slab',
  'lab',
  'bunker',
  'vault',
  'studio',
  'cylinder',
  'suite',
  'hub',
  'annex',
];

const PROP_KINDS: PropKind[] = [
  'tree',
  'lamp',
  'bench',
  'sign',
  'monument',
  'planter',
  'bollard',
  'shuttle_stop',
];

export interface NormalizeResult {
  doc: CampusDocument;
  /** Human-readable notes about anything that had to be repaired. */
  repairs: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function normalizeRect(v: unknown, w: number, h: number): GridRect | null {
  if (!isRecord(v)) return null;
  const x = Math.round(num(v.x, NaN));
  const y = Math.round(num(v.y, NaN));
  const rw = Math.round(num(v.w, NaN));
  const rh = Math.round(num(v.h, NaN));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(rw) || !Number.isFinite(rh)) {
    return null;
  }
  if (rw <= 0 || rh <= 0) return null;
  const cx = clamp(x, 0, w - 1);
  const cy = clamp(y, 0, h - 1);
  return { x: cx, y: cy, w: clamp(rw, 1, w - cx), h: clamp(rh, 1, h - cy) };
}

export function normalizeSettings(v: unknown): CampusSettings {
  const d = defaultSettings();
  if (!isRecord(v)) return d;
  const timeOfDay = v.timeOfDay;
  const weather = v.weather;
  const perf = v.performanceMode;
  return {
    timeOfDay: timeOfDay === 'day' || timeOfDay === 'auto' || timeOfDay === 'night' ? timeOfDay : d.timeOfDay,
    weather:
      weather === 'rain' || weather === 'fog' || weather === 'snow' || weather === 'clear'
        ? weather
        : d.weather,
    animationSpeed: clamp(num(v.animationSpeed, d.animationSpeed), 0, 3),
    showAgentLabels: bool(v.showAgentLabels, d.showAgentLabels),
    showStatusTags: bool(v.showStatusTags, d.showStatusTags),
    showActivityTrails: bool(v.showActivityTrails, d.showActivityTrails),
    showTaskPackets: bool(v.showTaskPackets, d.showTaskPackets),
    ambientActivity: bool(v.ambientActivity, d.ambientActivity),
    reducedMotion: bool(v.reducedMotion, d.reducedMotion),
    performanceMode:
      perf === 'balanced' || perf === 'efficient' || perf === 'high' ? perf : d.performanceMode,
    soundEnabled: bool(v.soundEnabled, d.soundEnabled),
    soundVolume: clamp(num(v.soundVolume, d.soundVolume), 0, 1),
    allowTeleport: bool(v.allowTeleport, d.allowTeleport),
    autoResolveApprovals: bool(v.autoResolveApprovals, d.autoResolveApprovals),
    cameraEdgePan: bool(v.cameraEdgePan, d.cameraEdgePan),
    showGrid: bool(v.showGrid, d.showGrid),
  };
}

function normalizeBuilding(
  v: unknown,
  gw: number,
  gh: number,
  index: number,
  repairs: string[],
): BuildingConfig | null {
  if (!isRecord(v)) return null;
  const id = str(v.id, `building_${index}`);
  const footprint = normalizeRect(v.footprint, gw, gh);
  if (!footprint) {
    repairs.push(`Dropped building "${id}": invalid footprint.`);
    return null;
  }
  const style = BUILDING_STYLES.includes(v.style as BuildingStyle)
    ? (v.style as BuildingStyle)
    : 'annex';
  if (style !== v.style) repairs.push(`Building "${id}": unknown style, using "annex".`);

  const facing = clamp(Math.round(num(v.facing, 0)), 0, 3) as 0 | 1 | 2 | 3;

  // The entrance must sit inside the grid; if it landed inside the footprint or
  // off-grid we push it to the nearest edge tile just outside the mass.
  let entrance = isRecord(v.entrance)
    ? { x: Math.round(num(v.entrance.x, NaN)), y: Math.round(num(v.entrance.y, NaN)) }
    : { x: NaN, y: NaN };
  const inside =
    entrance.x >= footprint.x &&
    entrance.x < footprint.x + footprint.w &&
    entrance.y >= footprint.y &&
    entrance.y < footprint.y + footprint.h;
  if (!Number.isFinite(entrance.x) || !Number.isFinite(entrance.y) || inside) {
    entrance = {
      x: clamp(footprint.x + Math.floor(footprint.w / 2), 0, gw - 1),
      y: clamp(footprint.y + footprint.h, 0, gh - 1),
    };
    repairs.push(`Building "${id}": entrance relocated to the footprint edge.`);
  }
  entrance.x = clamp(entrance.x, 0, gw - 1);
  entrance.y = clamp(entrance.y, 0, gh - 1);

  const rawRooms = Array.isArray(v.rooms) ? v.rooms : [];
  const roomList = rawRooms
    .map((r, i) => {
      if (!isRecord(r)) return null;
      return {
        id: str(r.id, `${id}_room_${i}`),
        name: str(r.name, `Room ${i + 1}`),
        level: Math.max(0, Math.round(num(r.level, 0))),
        anchor: isRecord(r.anchor)
          ? {
              x: clamp(Math.round(num(r.anchor.x, 1)), 0, footprint.w - 1),
              y: clamp(Math.round(num(r.anchor.y, 1)), 0, footprint.h - 1),
            }
          : { x: Math.floor(footprint.w / 2), y: Math.floor(footprint.h / 2) },
        kind: (['workstation', 'meeting', 'review', 'approval', 'transit', 'open'] as const).includes(
          r.kind as never,
        )
          ? (r.kind as BuildingConfig['rooms'][number]['kind'])
          : 'workstation',
        capacity: Math.max(1, Math.round(num(r.capacity, 1))),
      };
    })
    .filter((r): r is BuildingConfig['rooms'][number] => r !== null);

  if (roomList.length === 0) {
    roomList.push({
      id: `${id}_room_default`,
      name: 'Open Floor',
      level: 0,
      anchor: { x: Math.floor(footprint.w / 2), y: Math.floor(footprint.h / 2) },
      kind: 'workstation',
      capacity: 4,
    });
    repairs.push(`Building "${id}": no rooms defined, added an open floor.`);
  }

  const accent = v.accent;
  return {
    id,
    name: str(v.name, `Building ${index + 1}`),
    code: typeof v.code === 'string' ? v.code : undefined,
    style,
    footprint,
    height: clamp(num(v.height, 6), 1, 60),
    facing,
    accent:
      accent === 'silver' || accent === 'blue' || accent === 'gold' || accent === 'none'
        ? accent
        : 'none',
    entrance,
    rooms: roomList,
    ownerOnly: bool(v.ownerOnly, false),
    locked: bool(v.locked, false),
  };
}

function normalizeAgent(
  v: unknown,
  buildings: BuildingConfig[],
  index: number,
  repairs: string[],
): AgentConfig | null {
  if (!isRecord(v)) return null;
  const id = str(v.id, `agent_${index}`);
  let building = buildings.find((b) => b.id === v.homeBuildingId);
  if (!building) {
    building = buildings[0];
    if (!building) return null;
    repairs.push(`Agent "${id}": home building missing, reassigned to ${building.name}.`);
  }
  let room = building.rooms.find((r) => r.id === v.homeRoomId);
  if (!room) room = building.rooms[0];

  return {
    id,
    name: str(v.name, `Agent ${index + 1}`),
    role: str(v.role, 'Unassigned'),
    presentation: v.presentation === 'suit_alt' ? 'suit_alt' : 'suit_black',
    suitVariant: clamp(Math.round(num(v.suitVariant, 0)), 0, 7),
    homeBuildingId: building.id,
    homeRoomId: room.id,
    speed: clamp(num(v.speed, 2.8), 0.5, 12),
  };
}

function normalizeProp(v: unknown, gw: number, gh: number, index: number): PropConfig | null {
  if (!isRecord(v)) return null;
  if (!isRecord(v.at)) return null;
  const kind = PROP_KINDS.includes(v.kind as PropKind) ? (v.kind as PropKind) : 'lamp';
  return {
    id: str(v.id, `prop_${index}`),
    kind,
    at: {
      x: clamp(Math.round(num(v.at.x, 0)), 0, gw - 1),
      y: clamp(Math.round(num(v.at.y, 0)), 0, gh - 1),
    },
    scale: typeof v.scale === 'number' ? clamp(v.scale, 0.2, 4) : undefined,
  };
}

/**
 * Turn arbitrary parsed JSON into a campus document that the renderer can
 * safely consume. Never throws.
 */
export function normalizeCampus(input: unknown): NormalizeResult {
  const repairs: string[] = [];
  const fallback = createDefaultCampus();

  if (!isRecord(input)) {
    return { doc: fallback, repairs: ['No saved campus found — loaded the default layout.'] };
  }

  const gw = clamp(Math.round(num((input.gridSize as Record<string, unknown>)?.w, GRID_W)), 24, 512);
  const gh = clamp(Math.round(num((input.gridSize as Record<string, unknown>)?.h, GRID_H)), 24, 512);

  const rawBuildings = Array.isArray(input.buildings) ? input.buildings : [];
  const seen = new Set<string>();
  const buildings: BuildingConfig[] = [];
  rawBuildings.forEach((b, i) => {
    const nb = normalizeBuilding(b, gw, gh, i, repairs);
    if (!nb) return;
    if (seen.has(nb.id)) {
      repairs.push(`Duplicate building id "${nb.id}" dropped.`);
      return;
    }
    seen.add(nb.id);
    buildings.push(nb);
  });

  if (buildings.length === 0) {
    repairs.push('Saved campus contained no usable buildings — restored the default set.');
    buildings.push(...fallback.buildings);
  }

  const rawAgents = Array.isArray(input.agents) ? input.agents : [];
  const agentIds = new Set<string>();
  const agents: AgentConfig[] = [];
  rawAgents.forEach((a, i) => {
    const na = normalizeAgent(a, buildings, i, repairs);
    if (!na || agentIds.has(na.id)) return;
    agentIds.add(na.id);
    agents.push(na);
  });

  const themeId = typeof input.themeId === 'string' && THEMES[input.themeId] ? input.themeId : DEFAULT_THEME_ID;

  const doc: CampusDocument = {
    version: CAMPUS_SCHEMA_VERSION,
    campusName: str(input.campusName, fallback.campusName),
    gridSize: { w: gw, h: gh },
    buildings,
    agents,
    settings: normalizeSettings(input.settings),
    themeId,
    props: (Array.isArray(input.props) ? input.props : fallback.props)
      .map((p, i) => normalizeProp(p, gw, gh, i))
      .filter((p): p is PropConfig => p !== null),
    paths: (Array.isArray(input.paths) ? input.paths : fallback.paths)
      .map((r) => normalizeRect(r, gw, gh))
      .filter((r): r is GridRect => r !== null),
    water: (Array.isArray(input.water) ? input.water : fallback.water)
      .map((r) => normalizeRect(r, gw, gh))
      .filter((r): r is GridRect => r !== null),
    plots: (Array.isArray(input.plots) ? input.plots : fallback.plots)
      .map((r) => normalizeRect(r, gw, gh))
      .filter((r): r is GridRect => r !== null),
    // A bridge whose endpoints no longer exist is dropped rather than drawn
    // hanging in mid-air.
    bridges: (Array.isArray(input.bridges) ? input.bridges : fallback.bridges)
      .map((b, i): CampusDocument['bridges'][number] | null => {
        if (!isRecord(b)) return null;
        const from = str(b.fromBuildingId, '');
        const to = str(b.toBuildingId, '');
        if (!buildings.some((x) => x.id === from) || !buildings.some((x) => x.id === to)) {
          return null;
        }
        return {
          id: str(b.id, `bridge_${i}`),
          fromBuildingId: from,
          toBuildingId: to,
          height: clamp(num(b.height, 6), 1, 60),
          width: clamp(num(b.width, 1), 0.3, 4),
        };
      })
      .filter((b): b is CampusDocument['bridges'][number] => b !== null),
  };

  if (num(input.version, 0) !== CAMPUS_SCHEMA_VERSION) {
    repairs.push(`Migrated campus from schema v${num(input.version, 0)} to v${CAMPUS_SCHEMA_VERSION}.`);
  }

  return { doc, repairs };
}

/**
 * Detect buildings whose footprints overlap. Used by the layout editor to warn
 * the owner before they commit a move.
 */
export function findFootprintCollisions(buildings: BuildingConfig[]): Array<[string, string]> {
  const hits: Array<[string, string]> = [];
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const a = buildings[i].footprint;
      const b = buildings[j].footprint;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        hits.push([buildings[i].id, buildings[j].id]);
      }
    }
  }
  return hits;
}
