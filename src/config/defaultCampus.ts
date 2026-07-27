/**
 * The default campus document.
 *
 * This is *seed data*, not architecture. Everything here — names, footprints,
 * heights, styles, paths, landscaping, the agent roster — is written into the
 * persisted document on first run and is editable from the interface
 * afterwards. No building is bound to a function and no agent is bound to a
 * role; the names below are placeholders.
 */

import type {
  AgentConfig,
  BuildingConfig,
  CampusDocument,
  CampusSettings,
  GridRect,
  PropConfig,
  RoomConfig,
} from '@/core/types';
import { DEFAULT_THEME_ID } from './themes';

export const CAMPUS_SCHEMA_VERSION = 1;

export const GRID_W = 96;
export const GRID_H = 96;

/** The plaza occupies the centre of the grid. */
export const PLAZA: GridRect = { x: 36, y: 36, w: 24, h: 24 };
export const PLAZA_CENTER = { x: 48, y: 48 };

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

interface RoomSeed {
  name: string;
  level: number;
  kind: RoomConfig['kind'];
  /** Offset within the footprint, in tiles. */
  ax: number;
  ay: number;
  capacity?: number;
}

function rooms(buildingId: string, seeds: RoomSeed[]): RoomConfig[] {
  return seeds.map((s, i) => ({
    id: `${buildingId}_room_${String(i + 1).padStart(2, '0')}`,
    name: s.name,
    level: s.level,
    anchor: { x: s.ax, y: s.ay },
    kind: s.kind,
    capacity: s.capacity ?? (s.kind === 'meeting' ? 6 : 1),
  }));
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

export function defaultBuildings(): BuildingConfig[] {
  return [
    {
      id: 'building_command_tower',
      name: 'Command Tower',
      code: 'CT-01',
      style: 'tower',
      // A tight footprint against a tall shaft. In isometric projection a wide
      // base flattens a tower no matter how tall it is, so the Command Tower
      // is the narrowest plan on the campus and by far the highest.
      footprint: { x: 42, y: 22, w: 10, h: 11 },
      height: 38,
      facing: 2,
      accent: 'silver',
      entrance: { x: 47, y: 33 },
      rooms: rooms('building_command_tower', [
        { name: 'Control Room', level: 10, kind: 'open', ax: 7, ay: 8, capacity: 12 },
        { name: 'Overview Deck', level: 10, kind: 'review', ax: 2, ay: 8 },
        { name: 'Signal Floor', level: 6, kind: 'workstation', ax: 8, ay: 3 },
        { name: 'Briefing Room', level: 3, kind: 'meeting', ax: 2, ay: 2 },
        { name: 'Approval Desk', level: 1, kind: 'approval', ax: 7, ay: 9 },
        { name: 'Lobby', level: 0, kind: 'transit', ax: 5, ay: 10 },
      ]),
    },
    {
      id: 'building_operations',
      name: 'Main Operations Building',
      code: 'OP-02',
      style: 'slab',
      footprint: { x: 16, y: 40, w: 15, h: 16 },
      height: 7,
      facing: 1,
      accent: 'none',
      entrance: { x: 31, y: 47 },
      rooms: rooms('building_operations', [
        { name: 'Floor A', level: 0, kind: 'workstation', ax: 3, ay: 13 },
        { name: 'Floor B', level: 0, kind: 'workstation', ax: 11, ay: 13 },
        { name: 'Floor C', level: 1, kind: 'workstation', ax: 13, ay: 5 },
        { name: 'Coordination Room', level: 1, kind: 'meeting', ax: 2, ay: 4 },
        { name: 'Review Bay', level: 1, kind: 'review', ax: 7, ay: 14 },
      ]),
    },
    {
      id: 'building_research',
      name: 'Research Building',
      code: 'RS-03',
      style: 'lab',
      footprint: { x: 66, y: 34, w: 14, h: 13 },
      height: 10,
      facing: 3,
      accent: 'blue',
      entrance: { x: 65, y: 40 },
      rooms: rooms('building_research', [
        { name: 'Lab North', level: 0, kind: 'workstation', ax: 2, ay: 11 },
        { name: 'Lab South', level: 0, kind: 'workstation', ax: 11, ay: 11 },
        { name: 'Clean Room', level: 1, kind: 'workstation', ax: 12, ay: 3 },
        { name: 'Findings Room', level: 1, kind: 'review', ax: 2, ay: 2 },
      ]),
    },
    {
      id: 'building_automation',
      name: 'Automation Facility',
      code: 'AU-04',
      style: 'annex',
      footprint: { x: 66, y: 52, w: 15, h: 14 },
      height: 8,
      facing: 3,
      accent: 'none',
      entrance: { x: 65, y: 58 },
      rooms: rooms('building_automation', [
        { name: 'Line One', level: 0, kind: 'workstation', ax: 3, ay: 12 },
        { name: 'Line Two', level: 0, kind: 'workstation', ax: 11, ay: 12 },
        { name: 'Control Booth', level: 1, kind: 'review', ax: 13, ay: 4 },
      ]),
    },
    {
      id: 'building_archive',
      name: 'Memory Archive',
      code: 'AR-05',
      style: 'vault',
      footprint: { x: 18, y: 62, w: 13, h: 12 },
      height: 9,
      facing: 0,
      accent: 'silver',
      entrance: { x: 24, y: 61 },
      rooms: rooms('building_archive', [
        { name: 'Cold Stacks', level: 0, kind: 'workstation', ax: 3, ay: 10 },
        { name: 'Index Hall', level: 1, kind: 'open', ax: 10, ay: 10, capacity: 4 },
        { name: 'Retrieval Desk', level: 0, kind: 'review', ax: 6, ay: 1 },
      ]),
    },
    {
      id: 'building_security',
      name: 'Security Center',
      code: 'SC-06',
      style: 'bunker',
      footprint: { x: 38, y: 66, w: 12, h: 11 },
      height: 6,
      facing: 0,
      accent: 'none',
      entrance: { x: 43, y: 65 },
      rooms: rooms('building_security', [
        { name: 'Watch Floor', level: 0, kind: 'workstation', ax: 3, ay: 9, capacity: 4 },
        { name: 'Containment', level: 0, kind: 'review', ax: 9, ay: 9 },
        { name: 'Gate House', level: 0, kind: 'transit', ax: 5, ay: 1 },
      ]),
    },
    {
      id: 'building_comms',
      name: 'Communications Center',
      code: 'CM-07',
      style: 'cylinder',
      footprint: { x: 56, y: 68, w: 12, h: 12 },
      height: 13,
      facing: 0,
      accent: 'blue',
      entrance: { x: 61, y: 67 },
      rooms: rooms('building_comms', [
        { name: 'Uplink Ring', level: 2, kind: 'workstation', ax: 6, ay: 10 },
        { name: 'Relay Floor', level: 1, kind: 'workstation', ax: 2, ay: 7 },
        { name: 'Conference Drum', level: 0, kind: 'meeting', ax: 9, ay: 7 },
      ]),
    },
    {
      id: 'building_studio',
      name: 'Build Studio',
      code: 'BS-08',
      style: 'studio',
      footprint: { x: 16, y: 20, w: 14, h: 13 },
      height: 6,
      facing: 2,
      accent: 'none',
      entrance: { x: 23, y: 33 },
      rooms: rooms('building_studio', [
        { name: 'Bay One', level: 0, kind: 'workstation', ax: 3, ay: 11 },
        { name: 'Bay Two', level: 0, kind: 'workstation', ax: 10, ay: 11 },
        { name: 'Assembly Floor', level: 0, kind: 'open', ax: 6, ay: 6, capacity: 8 },
      ]),
    },
    {
      id: 'building_owner_suite',
      name: 'Owner Command Suite',
      code: 'OS-09',
      style: 'suite',
      footprint: { x: 60, y: 16, w: 12, h: 10 },
      height: 21,
      facing: 2,
      accent: 'gold',
      ownerOnly: true,
      entrance: { x: 62, y: 26 },
      rooms: rooms('building_owner_suite', [
        { name: 'Strategic Floor', level: 6, kind: 'open', ax: 6, ay: 8, capacity: 6 },
        { name: 'Approval Chamber', level: 6, kind: 'approval', ax: 10, ay: 6 },
        { name: 'Private Terrace', level: 6, kind: 'open', ax: 2, ay: 8, capacity: 4 },
      ]),
    },
    {
      id: 'building_transport',
      name: 'Transportation Hub',
      code: 'TR-10',
      style: 'hub',
      footprint: { x: 36, y: 80, w: 20, h: 9 },
      height: 5,
      facing: 0,
      accent: 'silver',
      entrance: { x: 43, y: 79 },
      rooms: rooms('building_transport', [
        { name: 'Platform North', level: 0, kind: 'transit', ax: 4, ay: 7, capacity: 10 },
        { name: 'Platform South', level: 0, kind: 'transit', ax: 15, ay: 7, capacity: 10 },
        { name: 'Dispatch', level: 1, kind: 'workstation', ax: 10, ay: 2 },
      ]),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Circulation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Walkways. The plaza itself is one large paved rectangle; every other entry
 * is a spoke connecting a building entrance back to it.
 */
export function defaultPaths(): GridRect[] {
  return [
    PLAZA,
    // Command Tower approach
    { x: 46, y: 33, w: 3, h: 4 },
    // Owner Command Suite approach (north-east)
    { x: 58, y: 27, w: 3, h: 10 },
    { x: 58, y: 24, w: 6, h: 3 },
    // Main Operations
    { x: 31, y: 46, w: 6, h: 3 },
    // Research
    { x: 60, y: 39, w: 6, h: 3 },
    // Automation
    { x: 60, y: 57, w: 6, h: 3 },
    // Security + Transportation spine (runs due south from the plaza)
    { x: 42, y: 59, w: 3, h: 21 },
    // Memory Archive
    { x: 24, y: 58, w: 13, h: 3 },
    { x: 24, y: 58, w: 3, h: 4 },
    // Communications
    { x: 58, y: 59, w: 3, h: 9 },
    { x: 58, y: 65, w: 4, h: 3 },
    // Build Studio
    { x: 23, y: 35, w: 14, h: 3 },
    { x: 22, y: 33, w: 3, h: 5 },
  ];
}

/** Reflecting pools flanking the plaza monument. */
export function defaultWater(): GridRect[] {
  return [
    { x: 38, y: 43, w: 5, h: 10 },
    { x: 53, y: 43, w: 5, h: 10 },
    // Reflecting basin in the southern forecourt, clear of the Security
    // Center's footprint and of the plaza's north–south spine.
    { x: 46, y: 62, w: 8, h: 4 },
  ];
}

/** Undeveloped land reserved for future campus sectors. */
export function defaultPlots(): GridRect[] {
  return [
    { x: 6, y: 6, w: 11, h: 11 },
    { x: 80, y: 8, w: 12, h: 11 },
    { x: 82, y: 74, w: 11, h: 13 },
    { x: 8, y: 80, w: 13, h: 10 },
  ];
}

/* ------------------------------------------------------------------ */
/* Landscaping                                                          */
/* ------------------------------------------------------------------ */

export function defaultProps(): PropConfig[] {
  const props: PropConfig[] = [];
  let n = 0;
  const add = (kind: PropConfig['kind'], x: number, y: number, scale?: number): void => {
    props.push({ id: `prop_${String(++n).padStart(3, '0')}`, kind, at: { x, y }, ...(scale ? { scale } : {}) });
  };

  // The monument sits dead centre and reads ecosystem status.
  add('monument', PLAZA_CENTER.x, PLAZA_CENTER.y, 1);

  // Restrained tree lines along the plaza edges — evenly spaced, never dense.
  for (let i = 0; i < 6; i++) {
    const y = 38 + i * 4;
    add('tree', 35, y);
    add('tree', 60, y);
  }
  for (let i = 0; i < 5; i++) {
    const x = 38 + i * 5;
    add('tree', x, 35);
    add('tree', x, 60);
  }

  // Ground lighting bordering the main axes. Widely spaced on purpose — the
  // plaza is lit by architecture, not by a grid of lamp posts.
  for (let i = 0; i < 5; i++) {
    add('lamp', 45, 38 + i * 5);
    add('lamp', 51, 38 + i * 5);
  }
  for (let i = 0; i < 3; i++) {
    add('lamp', 38 + i * 7, 47);
    add('lamp', 38 + i * 7, 50);
  }

  // Seating clusters, kept to two quiet corners.
  add('bench', 44, 58);
  add('bench', 46, 58);
  add('bench', 50, 58);
  add('bench', 52, 58);
  add('bench', 44, 39);
  add('bench', 52, 39);

  // Digital campus signage at each plaza approach.
  add('sign', 47, 36);
  add('sign', 36, 47);
  add('sign', 59, 47);
  add('sign', 47, 59);

  // Planters framing the monument.
  add('planter', 45, 45);
  add('planter', 51, 45);
  add('planter', 45, 51);
  add('planter', 51, 51);

  // Bollards guarding the tower approach.
  for (let i = 0; i < 4; i++) {
    add('bollard', 45, 33 + i);
    add('bollard', 49, 33 + i);
  }

  // Transit stops on the southern spine.
  add('shuttle_stop', 43, 62);
  add('shuttle_stop', 43, 76);
  add('shuttle_stop', 44, 57);

  return props;
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

/**
 * Placeholder roster. Names and roles are labels only — the simulation never
 * branches on them, and the owner replaces them from the interface.
 */
const AGENT_SEED: Array<[string, string, AgentConfig['presentation'], string, number]> = [
  ['Agent 01', 'Unassigned', 'suit_black', 'building_command_tower', 0],
  ['Agent 02', 'Unassigned', 'suit_alt', 'building_command_tower', 0],
  ['Agent 03', 'Unassigned', 'suit_black', 'building_operations', 0],
  ['Agent 04', 'Unassigned', 'suit_alt', 'building_operations', 1],
  ['Agent 05', 'Unassigned', 'suit_black', 'building_operations', 0],
  ['Agent 06', 'Unassigned', 'suit_alt', 'building_research', 2],
  ['Agent 07', 'Unassigned', 'suit_black', 'building_research', 0],
  ['Agent 08', 'Unassigned', 'suit_black', 'building_automation', 0],
  ['Agent 09', 'Unassigned', 'suit_alt', 'building_automation', 3],
  ['Agent 10', 'Unassigned', 'suit_black', 'building_archive', 0],
  ['Agent 11', 'Unassigned', 'suit_alt', 'building_security', 1],
  ['Agent 12', 'Unassigned', 'suit_black', 'building_security', 0],
  ['Agent 13', 'Unassigned', 'suit_alt', 'building_comms', 0],
  ['Agent 14', 'Unassigned', 'suit_black', 'building_studio', 0],
  ['Agent 15', 'Unassigned', 'suit_alt', 'building_studio', 2],
  ['Agent 16', 'Unassigned', 'suit_black', 'building_transport', 0],
  ['Agent 17', 'Unassigned', 'suit_alt', 'building_research', 1],
  ['Agent 18', 'Unassigned', 'suit_black', 'building_operations', 0],
];

export function defaultAgents(buildings: BuildingConfig[]): AgentConfig[] {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const roomCursor = new Map<string, number>();

  return AGENT_SEED.map(([name, role, presentation, homeBuildingId, suitVariant], i) => {
    const building = byId.get(homeBuildingId) ?? buildings[0];
    const workRooms = building.rooms.filter((r) => r.kind === 'workstation');
    const pool = workRooms.length > 0 ? workRooms : building.rooms;
    const cursor = roomCursor.get(building.id) ?? 0;
    roomCursor.set(building.id, cursor + 1);

    return {
      id: `agent_${String(i + 1).padStart(3, '0')}`,
      name,
      role,
      presentation,
      suitVariant,
      homeBuildingId: building.id,
      homeRoomId: pool[cursor % pool.length].id,
      // Slight per-agent variance so a crowd never marches in lockstep.
      speed: 2.6 + ((i * 37) % 11) / 20,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export function defaultSettings(): CampusSettings {
  return {
    timeOfDay: 'night',
    weather: 'clear',
    animationSpeed: 1,
    showAgentLabels: true,
    showStatusTags: true,
    showActivityTrails: false,
    showTaskPackets: true,
    ambientActivity: true,
    reducedMotion: false,
    performanceMode: 'high',
    soundEnabled: false,
    soundVolume: 0.4,
    allowTeleport: false,
    autoResolveApprovals: true,
    cameraEdgePan: false,
    showGrid: false,
  };
}

/* ------------------------------------------------------------------ */
/* Document                                                             */
/* ------------------------------------------------------------------ */

/** Glass skybridges. Purely architectural — they carry no routing meaning. */
export function defaultBridges(): CampusDocument['bridges'] {
  return [
    {
      id: 'bridge_tower_suite',
      fromBuildingId: 'building_command_tower',
      toBuildingId: 'building_owner_suite',
      height: 17,
      width: 1.1,
    },
    {
      id: 'bridge_research_automation',
      fromBuildingId: 'building_research',
      toBuildingId: 'building_automation',
      height: 6,
      width: 0.9,
    },
  ];
}

export function createDefaultCampus(): CampusDocument {
  const buildings = defaultBuildings();
  return {
    version: CAMPUS_SCHEMA_VERSION,
    campusName: 'Obsidian Campus',
    gridSize: { w: GRID_W, h: GRID_H },
    buildings,
    agents: defaultAgents(buildings),
    settings: defaultSettings(),
    themeId: DEFAULT_THEME_ID,
    props: defaultProps(),
    paths: defaultPaths(),
    water: defaultWater(),
    plots: defaultPlots(),
    bridges: defaultBridges(),
  };
}
