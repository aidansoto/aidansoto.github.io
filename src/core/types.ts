/**
 * Shared domain types.
 *
 * IMPORTANT ARCHITECTURAL RULE
 * ---------------------------
 * Nothing in this file encodes *what an agent does* or *what a building is
 * for*. Buildings carry a `name` and a `style`; agents carry a `role` string.
 * Both are free-form, user-editable labels. The visual layer is a renderer of
 * state, never an authority on behaviour.
 */

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

/**
 * Architectural archetypes. These drive silhouette only — they say nothing
 * about function. A "vault" building can be renamed and repurposed freely.
 */
export type BuildingStyle =
  | 'tower' // tall stepped obsidian tower
  | 'slab' // low wide horizontal facility
  | 'lab' // glass laboratory with clerestory
  | 'bunker' // secure low mass with angled buttresses
  | 'vault' // windowless archive block with silver ribs
  | 'studio' // open workshop with sawtooth roof
  | 'cylinder' // circular communications drum
  | 'suite' // elevated cantilevered private suite
  | 'hub' // transit canopy with open sides
  | 'annex'; // generic expansion block

export type BuildingStatus =
  | 'normal'
  | 'active'
  | 'productive'
  | 'blocked'
  | 'paused'
  | 'offline'
  | 'approval';

export interface RoomConfig {
  id: string;
  name: string;
  /** Floor index, 0 = ground. */
  level: number;
  /** Anchor offset within the building footprint, in tiles. */
  anchor: GridPoint;
  kind: 'workstation' | 'meeting' | 'review' | 'approval' | 'transit' | 'open';
  capacity: number;
}

export interface BuildingConfig {
  id: string;
  name: string;
  /** Short label drawn on campus signage. Optional. */
  code?: string;
  style: BuildingStyle;
  footprint: GridRect;
  /** Height in height-units (see tokens.iso.heightUnit). */
  height: number;
  /** Rotation of the primary facade: 0..3 quarter turns. */
  facing: 0 | 1 | 2 | 3;
  /** Tint multiplier applied to the base graphite mass. */
  accent?: 'silver' | 'blue' | 'gold' | 'none';
  /** Entrance tile in world grid coordinates. */
  entrance: GridPoint;
  rooms: RoomConfig[];
  /** Owner-only structures are gated in the interface. */
  ownerOnly?: boolean;
  /** Purely cosmetic marker for undeveloped expansion plots. */
  locked?: boolean;
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

/**
 * The full agent state vocabulary. The renderer maps each to a distinct
 * silhouette pose, indicator colour and label tag.
 */
export const AGENT_STATES = [
  'idle',
  'receiving_task',
  'planning',
  'working',
  'using_tool',
  'collaborating',
  'reviewing',
  'waiting',
  'waiting_for_approval',
  'paused',
  'blocked',
  'failed',
  'completed',
  'offline',
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

/**
 * Drives the dress system only. `presentation` selects a suit palette;
 * it carries no behavioural meaning.
 */
export type AgentPresentation = 'suit_black' | 'suit_alt';

export interface AgentConfig {
  id: string;
  name: string;
  /** Free-form label. Assigned by the owner later. */
  role: string;
  presentation: AgentPresentation;
  /** Index into the alternate suit palette (ignored for suit_black). */
  suitVariant: number;
  /** Building the agent is currently assigned to. */
  homeBuildingId: string;
  /** Room within the home building. */
  homeRoomId: string;
  /** Movement speed in tiles per second. */
  speed: number;
}

export interface AgentActionRecord {
  label: string;
  at: number;
}

export interface AgentRuntime {
  id: string;
  state: AgentState;
  /** Fractional world grid position. */
  pos: GridPoint;
  /** Height above ground in height-units. Non-zero on upper building floors. */
  elevation: number;
  /** True while the agent is inside a building mass (drawn through the glass). */
  indoors: boolean;
  /** Facing direction in radians on the iso plane (for sprite mirroring). */
  heading: number;
  buildingId: string | null;
  locationId: string | null;
  taskId: string | null;
  /** 0..1 progress on the current task. */
  progress: number;
  /** Tool name shown in the inspector. Free-form. */
  tool: string | null;
  path: GridPoint[];
  pathIndex: number;
  /** Seconds remaining in the current state before the sim reconsiders. */
  stateTimer: number;
  /** Ring buffer of the last few actions, newest last. */
  trail: AgentActionRecord[];
  /** Set when riding a shuttle/tram rather than walking. */
  transport: 'walk' | 'shuttle' | 'tram' | 'teleport' | null;
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type TaskStage =
  | 'inbound'
  | 'routing'
  | 'assigned'
  | 'in_progress'
  | 'review'
  | 'approval'
  | 'archived'
  | 'failed';

export type TaskRisk = 'standard' | 'elevated' | 'secure';

export interface TaskRuntime {
  id: string;
  label: string;
  stage: TaskStage;
  risk: TaskRisk;
  /** Colour key used for the agent's task indicator. */
  hue: number;
  assignedAgentId: string | null;
  buildingId: string | null;
  progress: number;
  createdAt: number;
  /** Position of the free-floating data packet, when in transit. */
  packet: { from: GridPoint; to: GridPoint; t: number } | null;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export interface CampusEventMap {
  agent_state_changed: {
    agent_id: string;
    previous_state: AgentState;
    new_state: AgentState;
    task_id: string | null;
    building_id: string | null;
    location_id: string | null;
  };
  agent_moved: { agent_id: string; building_id: string | null; location_id: string | null };
  task_created: { task_id: string; label: string; risk: TaskRisk };
  task_stage_changed: {
    task_id: string;
    previous_stage: TaskStage;
    new_stage: TaskStage;
    agent_id: string | null;
    building_id: string | null;
  };
  approval_requested: { task_id: string; agent_id: string; building_id: string | null };
  approval_resolved: { task_id: string; approved: boolean };
  building_status_changed: {
    building_id: string;
    previous_status: BuildingStatus;
    new_status: BuildingStatus;
  };
  system_mode_changed: { mode: SystemMode; reason: string };
  alert: { severity: 'info' | 'warn' | 'error'; message: string };
}

export type CampusEventType = keyof CampusEventMap;

export interface CampusEvent<T extends CampusEventType = CampusEventType> {
  event_type: T;
  timestamp: string;
  payload: CampusEventMap[T];
}

/* ------------------------------------------------------------------ */
/* System                                                             */
/* ------------------------------------------------------------------ */

export type SystemMode = 'running' | 'paused' | 'stopped';

export type WeatherKind = 'clear' | 'rain' | 'fog' | 'snow';
export type TimeOfDay = 'night' | 'day' | 'auto';

export interface CampusSettings {
  timeOfDay: TimeOfDay;
  weather: WeatherKind;
  /** Global multiplier on all simulation + animation motion. */
  animationSpeed: number;
  showAgentLabels: boolean;
  showStatusTags: boolean;
  showActivityTrails: boolean;
  showTaskPackets: boolean;
  ambientActivity: boolean;
  reducedMotion: boolean;
  performanceMode: 'high' | 'balanced' | 'efficient';
  soundEnabled: boolean;
  soundVolume: number;
  /** Optional visual transport shortcut. */
  allowTeleport: boolean;
  /**
   * When true the simulation resolves stale approval requests on its own so an
   * unattended campus keeps flowing. Turn off to make every approval require
   * the owner. Simulation-only — it grants no authority to the visual layer.
   */
  autoResolveApprovals: boolean;
  cameraEdgePan: boolean;
  showGrid: boolean;
}

export interface CampusTheme {
  id: string;
  name: string;
  skyTop: number;
  skyBottom: number;
  ground: number;
  pathLight: number;
  accent: number;
  buildingBase: number;
  glass: number;
  ambientLight: number;
}

/** The complete persisted document. */
export interface CampusDocument {
  version: number;
  campusName: string;
  gridSize: { w: number; h: number };
  buildings: BuildingConfig[];
  agents: AgentConfig[];
  settings: CampusSettings;
  themeId: string;
  /** Decorative props: trees, water, benches, signage, lamps. */
  props: PropConfig[];
  /** Walkable path tiles laid out as rectangles for compactness. */
  paths: GridRect[];
  /** Water features. */
  water: GridRect[];
  /** Reserved future-expansion plots rendered as dark undeveloped land. */
  plots: GridRect[];
  /** Glass skybridges linking building pairs at height. */
  bridges: BridgeConfig[];
}

export interface BridgeConfig {
  id: string;
  fromBuildingId: string;
  toBuildingId: string;
  /** Height in height-units at which the bridge crosses. */
  height: number;
  /** Half-width of the tube, in tiles. */
  width: number;
}

export type PropKind =
  | 'tree'
  | 'lamp'
  | 'bench'
  | 'sign'
  | 'monument'
  | 'planter'
  | 'bollard'
  | 'shuttle_stop';

export interface PropConfig {
  id: string;
  kind: PropKind;
  at: GridPoint;
  /** Optional per-prop scale. */
  scale?: number;
}
