/**
 * Campus simulation.
 *
 * This module stands in for the future agent backend. It owns agent runtime
 * state, task lifecycle and derived building status, and it publishes every
 * change on the event bus in exactly the shape a real backend would.
 *
 * The renderer never reads from here directly — it reads the snapshot the
 * simulation produces. Swapping this class for a live IPC feed should require
 * no renderer changes at all.
 */

import type {
  AgentConfig,
  AgentRuntime,
  AgentState,
  BuildingConfig,
  BuildingStatus,
  CampusDocument,
  GridPoint,
  RoomConfig,
  SystemMode,
  TaskRisk,
  TaskRuntime,
  TaskStage,
} from '@/core/types';
import { EventBus } from '@/core/events';
import { NavGrid, buildNavGrid, findPath, nearestWalkable } from '@/core/navigation';
import { distance } from '@/core/iso';
import { Rng } from './rng';

/** Screen height-units per building floor. */
export const FLOOR_HEIGHT = 3;

/** How long an agent lingers in each state, in simulation seconds. */
const STATE_DURATION: Record<AgentState, [number, number]> = {
  idle: [3, 11],
  receiving_task: [1.2, 2.2],
  planning: [3.5, 7],
  working: [9, 20],
  using_tool: [2.5, 5],
  collaborating: [7, 14],
  reviewing: [4, 8],
  waiting: [3, 8],
  waiting_for_approval: [40, 70],
  paused: [Infinity, Infinity],
  blocked: [5, 10],
  failed: [3, 5],
  completed: [2.5, 4],
  offline: [Infinity, Infinity],
};

const TASK_LABELS = [
  'Inbound Request',
  'Queued Item',
  'Work Order',
  'Data Parcel',
  'Change Set',
  'Analysis Job',
  'Batch Run',
  'Review Packet',
  'Signal Report',
  'Pipeline Job',
];

const TOOL_LABELS = [
  'Retrieval',
  'Compute',
  'Index',
  'Transform',
  'Validation',
  'Synthesis',
  'Uplink',
  'Archive I/O',
];

/** What an agent intends to do once it finishes walking. */
interface Intent {
  arriveState: AgentState | null;
  buildingId: string | null;
  roomId: string | null;
  targetElevation: number;
}

export interface SimSnapshot {
  mode: SystemMode;
  agents: AgentRuntime[];
  tasks: TaskRuntime[];
  buildingStatus: Record<string, BuildingStatus>;
  approvals: TaskRuntime[];
  simTime: number;
  /** 0..1 aggregate — drives the plaza monument. */
  activityLevel: number;
}

export interface SimOptions {
  seed?: number;
  /** Seconds between inbound task arrivals, as [min, max]. */
  taskInterval?: [number, number];
  /** Cap on concurrently live tasks. */
  maxActiveTasks?: number;
}

export class CampusSimulation {
  private doc: CampusDocument;
  private bus: EventBus;
  private rng: Rng;
  private nav: NavGrid;

  private agentCfg = new Map<string, AgentConfig>();
  private buildings = new Map<string, BuildingConfig>();
  private intents = new Map<string, Intent>();

  readonly agents = new Map<string, AgentRuntime>();
  readonly tasks = new Map<string, TaskRuntime>();
  readonly buildingStatus = new Map<string, BuildingStatus>();

  mode: SystemMode = 'running';
  simTime = 0;

  private taskSeq = 0;
  private nextTaskIn = 2;
  private taskInterval: [number, number];
  private maxActiveTasks: number;
  private statusRecalcIn = 0;

  constructor(doc: CampusDocument, bus: EventBus, opts: SimOptions = {}) {
    this.doc = doc;
    this.bus = bus;
    this.rng = new Rng(opts.seed ?? 0x5eed1234);
    this.taskInterval = opts.taskInterval ?? [6, 14];
    this.maxActiveTasks = opts.maxActiveTasks ?? 14;
    this.nav = buildNavGrid(doc);
    this.seedAgents();
    this.recalcBuildingStatus(true);
  }

  /* ---------------------------------------------------------------- */
  /* Setup                                                             */
  /* ---------------------------------------------------------------- */

  private seedAgents(): void {
    this.buildings.clear();
    for (const b of this.doc.buildings) this.buildings.set(b.id, b);

    this.agentCfg.clear();
    for (const a of this.doc.agents) this.agentCfg.set(a.id, a);

    for (const cfg of this.doc.agents) {
      if (this.agents.has(cfg.id)) continue;
      const home = this.buildings.get(cfg.homeBuildingId);
      const room = home?.rooms.find((r) => r.id === cfg.homeRoomId) ?? home?.rooms[0];
      const spot = home && room ? this.roomPosition(home, room) : { pos: { x: 48, y: 48 }, elevation: 0 };
      this.agents.set(cfg.id, {
        id: cfg.id,
        state: 'idle',
        pos: { ...spot.pos },
        elevation: spot.elevation,
        indoors: true,
        heading: 0,
        buildingId: home?.id ?? null,
        locationId: room?.id ?? null,
        taskId: null,
        progress: 0,
        tool: null,
        path: [],
        pathIndex: 0,
        stateTimer: this.rng.range(0.5, 8),
        trail: [],
        transport: null,
      });
      this.intents.set(cfg.id, {
        arriveState: null,
        buildingId: home?.id ?? null,
        roomId: room?.id ?? null,
        targetElevation: spot.elevation,
      });
    }

    // Drop runtimes for agents that no longer exist in the document.
    for (const id of [...this.agents.keys()]) {
      if (!this.agentCfg.has(id)) {
        this.agents.delete(id);
        this.intents.delete(id);
      }
    }
  }

  /**
   * Re-seat the simulation on a new campus document (a building moved, an
   * agent was added). Runtime state is preserved where possible.
   */
  rebuild(doc: CampusDocument): void {
    this.doc = doc;
    this.nav = buildNavGrid(doc);
    this.seedAgents();

    // A config edit can leave an agent standing inside a new wall.
    for (const rt of this.agents.values()) {
      if (!this.nav.walkable(Math.floor(rt.pos.x), Math.floor(rt.pos.y))) {
        const safe = nearestWalkable(this.nav, rt.pos);
        if (safe) {
          rt.pos = safe;
          rt.path = [];
          rt.pathIndex = 0;
        }
      }
      if (rt.buildingId && !this.buildings.has(rt.buildingId)) {
        rt.buildingId = null;
        rt.locationId = null;
      }
    }
    this.recalcBuildingStatus(true);
  }

  /* ---------------------------------------------------------------- */
  /* Geometry helpers                                                  */
  /* ---------------------------------------------------------------- */

  private roomPosition(b: BuildingConfig, r: RoomConfig): { pos: GridPoint; elevation: number } {
    return {
      pos: { x: b.footprint.x + r.anchor.x + 0.5, y: b.footprint.y + r.anchor.y + 0.5 },
      elevation: Math.min(r.level * FLOOR_HEIGHT, Math.max(0, b.height - 2)),
    };
  }

  private findRoom(
    buildingId: string | null,
    kind: RoomConfig['kind'],
  ): { building: BuildingConfig; room: RoomConfig } | null {
    const preferred = buildingId ? this.buildings.get(buildingId) : null;
    if (preferred) {
      const room = preferred.rooms.find((r) => r.kind === kind);
      if (room) return { building: preferred, room };
    }
    for (const b of this.buildings.values()) {
      if (b.locked) continue;
      const room = b.rooms.find((r) => r.kind === kind);
      if (room) return { building: b, room };
    }
    return null;
  }

  private homeSpot(cfg: AgentConfig): { building: BuildingConfig; room: RoomConfig } | null {
    const b = this.buildings.get(cfg.homeBuildingId);
    if (!b) return null;
    const r = b.rooms.find((x) => x.id === cfg.homeRoomId) ?? b.rooms[0];
    return r ? { building: b, room: r } : null;
  }

  /* ---------------------------------------------------------------- */
  /* Movement                                                          */
  /* ---------------------------------------------------------------- */

  private travel(
    rt: AgentRuntime,
    building: BuildingConfig,
    room: RoomConfig,
    arriveState: AgentState | null,
  ): void {
    const target = this.roomPosition(building, room);
    const dist = distance(rt.pos, target.pos);

    const settings = this.doc.settings;
    let transport: AgentRuntime['transport'] = 'walk';
    if (settings.allowTeleport && dist > 26) transport = 'teleport';
    else if (dist > 30) transport = 'tram';
    else if (dist > 16) transport = 'shuttle';

    this.intents.set(rt.id, {
      arriveState,
      buildingId: building.id,
      roomId: room.id,
      targetElevation: target.elevation,
    });

    if (transport === 'teleport') {
      rt.pos = { ...target.pos };
      rt.elevation = target.elevation;
      rt.path = [];
      rt.pathIndex = 0;
      rt.transport = null;
      this.arrive(rt);
      return;
    }

    const path = findPath(this.nav, rt.pos, target.pos);
    if (path.length === 0) {
      // No route (a building may have sealed the entrance). Fall back to a
      // direct glide rather than freezing the agent in place.
      rt.path = [target.pos];
    } else {
      rt.path = path;
      // Final hop lands exactly on the room anchor.
      rt.path[rt.path.length - 1] = { ...target.pos };
    }
    rt.pathIndex = 0;
    rt.transport = transport;
  }

  private advanceMovement(rt: AgentRuntime, cfg: AgentConfig, dt: number): void {
    const intent = this.intents.get(rt.id);

    if (rt.path.length > 0 && rt.pathIndex < rt.path.length) {
      const speedMul = rt.transport === 'tram' ? 3.4 : rt.transport === 'shuttle' ? 2.2 : 1;
      let budget = cfg.speed * speedMul * dt;

      while (budget > 0 && rt.pathIndex < rt.path.length) {
        const next = rt.path[rt.pathIndex];
        const d = distance(rt.pos, next);
        if (d <= budget) {
          rt.pos = { ...next };
          budget -= d;
          rt.pathIndex++;
        } else {
          const t = budget / d;
          rt.heading = Math.atan2(next.y - rt.pos.y, next.x - rt.pos.x);
          rt.pos = { x: rt.pos.x + (next.x - rt.pos.x) * t, y: rt.pos.y + (next.y - rt.pos.y) * t };
          budget = 0;
        }
      }

      if (rt.pathIndex >= rt.path.length) {
        rt.path = [];
        rt.pathIndex = 0;
        rt.transport = null;
        this.arrive(rt);
      }
    }

    // Vertical movement is the elevator: it runs whether or not the agent is
    // still walking, and always at a fixed, mechanical rate.
    const targetElev = intent?.targetElevation ?? 0;
    if (Math.abs(rt.elevation - targetElev) > 0.01) {
      const step = 5 * dt;
      const delta = targetElev - rt.elevation;
      rt.elevation += Math.sign(delta) * Math.min(step, Math.abs(delta));
    }

    const b = rt.buildingId ? this.buildings.get(rt.buildingId) : null;
    rt.indoors = b
      ? rt.pos.x >= b.footprint.x &&
        rt.pos.x < b.footprint.x + b.footprint.w &&
        rt.pos.y >= b.footprint.y &&
        rt.pos.y < b.footprint.y + b.footprint.h
      : false;
  }

  private arrive(rt: AgentRuntime): void {
    const intent = this.intents.get(rt.id);
    if (!intent) return;
    const prevBuilding = rt.buildingId;
    const prevLocation = rt.locationId;
    rt.buildingId = intent.buildingId;
    rt.locationId = intent.roomId;
    if (prevBuilding !== rt.buildingId || prevLocation !== rt.locationId) {
      this.bus.emit('agent_moved', {
        agent_id: rt.id,
        building_id: rt.buildingId,
        location_id: rt.locationId,
      });
    }
    if (intent.arriveState) {
      this.setState(rt, intent.arriveState);
      intent.arriveState = null;
    }
  }

  private get isMoving(): (rt: AgentRuntime) => boolean {
    return (rt) => rt.path.length > 0;
  }

  /* ---------------------------------------------------------------- */
  /* State machine                                                     */
  /* ---------------------------------------------------------------- */

  private setState(rt: AgentRuntime, next: AgentState, note?: string): void {
    if (rt.state === next) return;
    const previous = rt.state;
    rt.state = next;
    const [lo, hi] = STATE_DURATION[next];
    rt.stateTimer = Number.isFinite(lo) ? this.rng.range(lo, hi) : Infinity;

    rt.trail.push({ label: note ?? humanState(next), at: Date.now() });
    if (rt.trail.length > 3) rt.trail.shift();

    if (next !== 'using_tool') rt.tool = null;

    this.bus.emit('agent_state_changed', {
      agent_id: rt.id,
      previous_state: previous,
      new_state: next,
      task_id: rt.taskId,
      building_id: rt.buildingId,
      location_id: rt.locationId,
    });
  }

  /** Public: used by the owner interface to pause/resume a single agent. */
  setAgentState(agentId: string, next: AgentState): void {
    const rt = this.agents.get(agentId);
    if (!rt) return;
    this.setState(rt, next);
  }

  private tickAgent(rt: AgentRuntime, dt: number): void {
    const cfg = this.agentCfg.get(rt.id);
    if (!cfg) return;

    if (rt.state === 'offline' || rt.state === 'paused') return;

    this.advanceMovement(rt, cfg, dt);

    // While walking, the state clock is suspended — an agent crossing the
    // plaza should not "finish planning" halfway there.
    if (this.isMoving(rt)) return;

    if (Number.isFinite(rt.stateTimer)) rt.stateTimer -= dt;

    const task = rt.taskId ? this.tasks.get(rt.taskId) : null;

    if (rt.state === 'working' && task) {
      rt.progress = Math.min(1, rt.progress + dt * this.rng.range(0.035, 0.06));
      task.progress = rt.progress;

      // Occasional interruptions keep the floor feeling like real work.
      if (this.rng.chance(dt * 0.05)) {
        rt.tool = this.rng.pick(TOOL_LABELS) ?? 'Compute';
        this.setState(rt, 'using_tool', `Using ${rt.tool}`);
        return;
      }
      if (this.rng.chance(dt * 0.012)) {
        this.setState(rt, 'blocked', 'Blocked on dependency');
        return;
      }
      if (this.rng.chance(dt * 0.02)) {
        this.startCollaboration(rt);
        return;
      }
      if (rt.progress >= 1) {
        this.sendToReview(rt, task);
        return;
      }
    }

    if (rt.stateTimer > 0) return;

    switch (rt.state) {
      case 'idle': {
        // Nonessential movement: idle drift can be disabled entirely. Task
        // travel elsewhere in the machine is unaffected.
        if (!this.doc.settings.idleMovement) {
          rt.stateTimer = this.rng.range(4, 12);
          break;
        }
        // Idle agents drift: back to their desk, or a short walk to the plaza.
        const home = this.homeSpot(cfg);
        if (home && this.rng.chance(0.55)) {
          this.travel(rt, home.building, home.room, 'idle');
        } else if (home) {
          const other = this.rng.pick([...this.buildings.values()].filter((b) => !b.locked && !b.ownerOnly));
          const room = other ? this.rng.pick(other.rooms) : null;
          if (other && room) this.travel(rt, other, room, 'idle');
        }
        rt.stateTimer = this.rng.range(4, 12);
        break;
      }

      case 'receiving_task': {
        this.setState(rt, 'planning');
        break;
      }

      case 'planning': {
        const home = this.homeSpot(cfg);
        if (home) this.travel(rt, home.building, home.room, 'working');
        else this.setState(rt, 'working');
        break;
      }

      case 'using_tool': {
        this.setState(rt, 'working');
        break;
      }

      case 'collaborating': {
        const home = this.homeSpot(cfg);
        if (home) this.travel(rt, home.building, home.room, 'working');
        else this.setState(rt, 'working');
        break;
      }

      case 'reviewing': {
        if (task) {
          if (this.rng.chance(0.45)) this.requestApproval(rt, task);
          else this.completeTask(rt, task);
        } else {
          this.setState(rt, 'idle');
        }
        break;
      }

      case 'waiting': {
        this.setState(rt, task ? 'working' : 'idle');
        break;
      }

      case 'waiting_for_approval': {
        if (task && task.stage === 'approval' && this.doc.settings.autoResolveApprovals) {
          this.resolveApproval(task.id, this.rng.chance(0.85));
        } else {
          rt.stateTimer = 20;
        }
        break;
      }

      case 'blocked': {
        if (this.rng.chance(0.6)) {
          this.setState(rt, 'working', 'Unblocked');
        } else {
          this.setState(rt, 'failed');
        }
        break;
      }

      case 'failed': {
        if (task) this.setTaskStage(task, 'failed');
        this.releaseTask(rt);
        this.setState(rt, 'idle');
        break;
      }

      case 'completed': {
        this.releaseTask(rt);
        this.setState(rt, 'idle');
        break;
      }

      default:
        break;
    }
  }

  private startCollaboration(rt: AgentRuntime): void {
    const spot = this.findRoom(rt.buildingId, 'meeting');
    if (!spot) {
      this.setState(rt, 'waiting');
      return;
    }
    this.travel(rt, spot.building, spot.room, 'collaborating');

    // Pull in one nearby peer so collaboration reads as two people meeting.
    const peer = [...this.agents.values()].find(
      (o) =>
        o.id !== rt.id &&
        o.state === 'working' &&
        o.buildingId === rt.buildingId &&
        o.path.length === 0,
    );
    if (peer) this.travel(peer, spot.building, spot.room, 'collaborating');
  }

  private sendToReview(rt: AgentRuntime, task: TaskRuntime): void {
    const spot = this.findRoom(rt.buildingId, 'review');
    this.setTaskStage(task, 'review');
    if (spot) this.travel(rt, spot.building, spot.room, 'reviewing');
    else this.setState(rt, 'reviewing');
  }

  private requestApproval(rt: AgentRuntime, task: TaskRuntime): void {
    this.setTaskStage(task, 'approval');
    const spot = this.findRoom(null, 'approval');
    if (spot) this.travel(rt, spot.building, spot.room, 'waiting_for_approval');
    else this.setState(rt, 'waiting_for_approval');
    this.bus.emit('approval_requested', {
      task_id: task.id,
      agent_id: rt.id,
      building_id: spot?.building.id ?? rt.buildingId,
    });
  }

  private completeTask(rt: AgentRuntime, task: TaskRuntime): void {
    this.setTaskStage(task, 'archived');
    const archive =
      [...this.buildings.values()].find((b) => b.style === 'vault') ??
      [...this.buildings.values()][0];
    if (archive) {
      task.packet = {
        from: { ...rt.pos },
        to: { x: archive.entrance.x + 0.5, y: archive.entrance.y + 0.5 },
        t: 0,
      };
    }
    this.setState(rt, 'completed');
  }

  private releaseTask(rt: AgentRuntime): void {
    rt.taskId = null;
    rt.progress = 0;
    rt.tool = null;
  }

  /* ---------------------------------------------------------------- */
  /* Tasks                                                             */
  /* ---------------------------------------------------------------- */

  private setTaskStage(task: TaskRuntime, stage: TaskStage): void {
    if (task.stage === stage) return;
    const previous = task.stage;
    task.stage = stage;
    this.bus.emit('task_stage_changed', {
      task_id: task.id,
      previous_stage: previous,
      new_stage: stage,
      agent_id: task.assignedAgentId,
      building_id: task.buildingId,
    });
  }

  private spawnTask(): void {
    const active = [...this.tasks.values()].filter(
      (t) => t.stage !== 'archived' && t.stage !== 'failed',
    );
    if (active.length >= this.maxActiveTasks) return;

    const tower =
      [...this.buildings.values()].find((b) => b.style === 'tower') ??
      [...this.buildings.values()][0];
    const candidates = [...this.buildings.values()].filter(
      (b) => !b.locked && !b.ownerOnly && b.id !== tower?.id,
    );
    const target = this.rng.pick(candidates) ?? tower;
    if (!tower || !target) return;

    const risk: TaskRisk = this.rng.chance(0.08)
      ? 'secure'
      : this.rng.chance(0.2)
        ? 'elevated'
        : 'standard';

    const id = `task_${String(++this.taskSeq).padStart(3, '0')}`;
    const task: TaskRuntime = {
      id,
      label: `${this.rng.pick(TASK_LABELS) ?? 'Task'} ${String(this.taskSeq).padStart(3, '0')}`,
      stage: 'inbound',
      risk,
      hue: this.rng.int(0, 5),
      assignedAgentId: null,
      buildingId: target.id,
      progress: 0,
      createdAt: Date.now(),
      packet: {
        from: { x: tower.entrance.x + 0.5, y: tower.entrance.y + 0.5 },
        to: { x: target.entrance.x + 0.5, y: target.entrance.y + 0.5 },
        t: 0,
      },
    };
    this.tasks.set(id, task);
    this.bus.emit('task_created', { task_id: id, label: task.label, risk });
  }

  private routeTask(task: TaskRuntime): void {
    this.setTaskStage(task, 'routing');
    const inBuilding = [...this.agents.values()].filter(
      (a) =>
        a.taskId === null &&
        (a.state === 'idle' || a.state === 'waiting') &&
        this.agentCfg.get(a.id)?.homeBuildingId === task.buildingId,
    );
    const anywhere = [...this.agents.values()].filter(
      (a) => a.taskId === null && (a.state === 'idle' || a.state === 'waiting'),
    );
    const chosen = this.rng.pick(inBuilding.length > 0 ? inBuilding : anywhere);

    if (!chosen) {
      // Nobody free — the packet waits at the door rather than vanishing.
      task.packet = null;
      return;
    }

    task.assignedAgentId = chosen.id;
    chosen.taskId = task.id;
    chosen.progress = 0;
    task.packet = null;
    this.setTaskStage(task, 'assigned');
    this.setState(chosen, 'receiving_task', `Received ${task.label}`);
  }

  private tickTasks(dt: number): void {
    for (const task of this.tasks.values()) {
      if (task.packet) {
        task.packet.t = Math.min(1, task.packet.t + dt * 0.42);
        if (task.packet.t >= 1) {
          if (task.stage === 'inbound') {
            this.routeTask(task);
          } else {
            task.packet = null;
          }
        }
      }

      if (task.stage === 'routing' && !task.assignedAgentId) {
        // Retry assignment periodically until somebody frees up.
        if (this.rng.chance(dt * 0.5)) this.routeTask(task);
      }
    }

    // Retire archived/failed tasks so the map does not accumulate clutter.
    for (const [id, task] of [...this.tasks.entries()]) {
      if ((task.stage === 'archived' || task.stage === 'failed') && !task.packet) {
        if (Date.now() - task.createdAt > 20000) this.tasks.delete(id);
      }
    }
  }

  /** Owner action. Approving archives the task; rejecting fails it. */
  resolveApproval(taskId: string, approved: boolean): void {
    const task = this.tasks.get(taskId);
    if (!task || task.stage !== 'approval') return;
    const agent = task.assignedAgentId ? this.agents.get(task.assignedAgentId) : null;

    this.bus.emit('approval_resolved', { task_id: taskId, approved });

    if (!agent) {
      this.setTaskStage(task, approved ? 'archived' : 'failed');
      return;
    }

    if (approved) {
      this.completeTask(agent, task);
    } else {
      this.setTaskStage(task, 'failed');
      this.setState(agent, 'failed', 'Approval declined');
    }
  }

  approvals(): TaskRuntime[] {
    return [...this.tasks.values()].filter((t) => t.stage === 'approval');
  }

  /* ---------------------------------------------------------------- */
  /* Building status                                                   */
  /* ---------------------------------------------------------------- */

  private recalcBuildingStatus(silent = false): void {
    for (const b of this.doc.buildings) {
      const next = this.deriveStatus(b);
      const prev = this.buildingStatus.get(b.id);
      if (prev !== next) {
        this.buildingStatus.set(b.id, next);
        if (!silent && prev) {
          this.bus.emit('building_status_changed', {
            building_id: b.id,
            previous_status: prev,
            new_status: next,
          });
        }
      }
    }
  }

  private deriveStatus(b: BuildingConfig): BuildingStatus {
    if (b.locked) return 'offline';
    if (this.mode === 'stopped') return 'offline';
    if (this.mode === 'paused') return 'paused';

    let active = 0;
    let blocked = 0;
    let approval = 0;
    let completedRecently = 0;

    for (const rt of this.agents.values()) {
      if (rt.buildingId !== b.id) continue;
      switch (rt.state) {
        case 'blocked':
        case 'failed':
          blocked++;
          break;
        case 'waiting_for_approval':
          approval++;
          break;
        case 'completed':
          completedRecently++;
          active++;
          break;
        case 'working':
        case 'using_tool':
        case 'planning':
        case 'collaborating':
        case 'reviewing':
        case 'receiving_task':
          active++;
          break;
        default:
          break;
      }
    }

    if (blocked > 0) return 'blocked';
    if (approval > 0) return 'approval';
    if (completedRecently > 0 || active >= 3) return 'productive';
    if (active > 0) return 'active';
    return 'normal';
  }

  /* ---------------------------------------------------------------- */
  /* Control                                                           */
  /* ---------------------------------------------------------------- */

  setMode(mode: SystemMode, reason: string): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.bus.emit('system_mode_changed', { mode, reason });

    if (mode === 'paused') {
      for (const rt of this.agents.values()) {
        if (rt.state !== 'offline') this.setState(rt, 'paused');
      }
    } else if (mode === 'stopped') {
      for (const rt of this.agents.values()) {
        rt.path = [];
        rt.pathIndex = 0;
        rt.transport = null;
        this.setState(rt, 'offline');
      }
      for (const task of this.tasks.values()) {
        task.packet = null;
      }
      this.bus.emit('alert', {
        severity: 'error',
        message: 'Emergency stop engaged. All agents offline.',
      });
    } else {
      for (const rt of this.agents.values()) {
        if (rt.state === 'paused' || rt.state === 'offline') {
          this.setState(rt, rt.taskId ? 'working' : 'idle');
        }
      }
    }
    this.recalcBuildingStatus();
  }

  emergencyStop(): void {
    this.setMode('stopped', 'Owner engaged emergency stop');
  }

  /* ---------------------------------------------------------------- */
  /* Tick                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Advance the simulation. `dtMs` is wall-clock elapsed time; the caller has
   * already applied the animation-speed multiplier.
   */
  tick(dtMs: number): void {
    if (this.mode !== 'running') return;
    // Clamp so a backgrounded window does not resume with a 30-second jump.
    const dt = Math.min(dtMs, 250) / 1000;
    if (dt <= 0) return;

    this.simTime += dt;

    this.nextTaskIn -= dt;
    if (this.nextTaskIn <= 0) {
      this.spawnTask();
      this.nextTaskIn = this.rng.range(this.taskInterval[0], this.taskInterval[1]);
    }

    for (const rt of this.agents.values()) this.tickAgent(rt, dt);
    this.tickTasks(dt);

    this.statusRecalcIn -= dt;
    if (this.statusRecalcIn <= 0) {
      this.statusRecalcIn = 0.4;
      this.recalcBuildingStatus();
    }
  }

  /** Immutable-enough view for the renderer and the interface. */
  snapshot(): SimSnapshot {
    const agents = [...this.agents.values()];
    const busy = agents.filter((a) =>
      ['working', 'using_tool', 'planning', 'collaborating', 'reviewing'].includes(a.state),
    ).length;
    const trouble = agents.filter((a) => a.state === 'blocked' || a.state === 'failed').length;

    return {
      mode: this.mode,
      agents,
      tasks: [...this.tasks.values()],
      buildingStatus: Object.fromEntries(this.buildingStatus),
      approvals: this.approvals(),
      simTime: this.simTime,
      activityLevel:
        agents.length === 0 ? 0 : Math.max(0, Math.min(1, (busy - trouble * 0.5) / agents.length)),
    };
  }
}

/** Human-readable label for an agent state. Used in labels and the log. */
export function humanState(s: AgentState): string {
  switch (s) {
    case 'idle':
      return 'Idle';
    case 'receiving_task':
      return 'Receiving';
    case 'planning':
      return 'Planning';
    case 'working':
      return 'Working';
    case 'using_tool':
      return 'Using Tool';
    case 'collaborating':
      return 'Collaborating';
    case 'reviewing':
      return 'Reviewing';
    case 'waiting':
      return 'Waiting';
    case 'waiting_for_approval':
      return 'Awaiting Approval';
    case 'paused':
      return 'Paused';
    case 'blocked':
      return 'Blocked';
    case 'failed':
      return 'Failed';
    case 'completed':
      return 'Completed';
    case 'offline':
      return 'Offline';
  }
}
