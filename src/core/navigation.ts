/**
 * Campus navigation.
 *
 * Builds a walkability grid from the campus document, then runs A* over it.
 * Paths are smoothed so agents cut diagonals across the plaza instead of
 * stair-stepping like a tile game — the movement has to read as *people
 * crossing a courtyard*, not sprites on a chessboard.
 */

import type { CampusDocument, GridPoint, GridRect } from './types';
import { distance, rectContains } from './iso';

export const enum Cell {
  Blocked = 0,
  Ground = 1,
  Path = 2,
  Interior = 3,
  Entrance = 4,
}

export class NavGrid {
  readonly w: number;
  readonly h: number;
  private cells: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cells = new Uint8Array(w * h).fill(Cell.Ground);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Cell {
    if (!this.inBounds(x, y)) return Cell.Blocked;
    return this.cells[this.idx(x, y)] as Cell;
  }

  set(x: number, y: number, c: Cell): void {
    if (!this.inBounds(x, y)) return;
    this.cells[this.idx(x, y)] = c;
  }

  fill(r: GridRect, c: Cell): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        this.set(x, y, c);
      }
    }
  }

  walkable(x: number, y: number): boolean {
    return this.get(x, y) !== Cell.Blocked;
  }

  /** Movement cost — paths are cheaper so traffic naturally follows walkways. */
  cost(x: number, y: number): number {
    switch (this.get(x, y)) {
      case Cell.Path:
        return 1;
      case Cell.Entrance:
        return 1;
      case Cell.Interior:
        return 1.1;
      case Cell.Ground:
        return 1.9;
      default:
        return Infinity;
    }
  }
}

/**
 * Rasterise the campus document into a navigation grid.
 * Water and building masses block; entrances punch a hole through the mass so
 * agents can actually get inside.
 */
export function buildNavGrid(doc: CampusDocument): NavGrid {
  const grid = new NavGrid(doc.gridSize.w, doc.gridSize.h);

  // Order matters and mirrors how the campus is built: paving is laid first,
  // then water is cut through it, then building masses are set down. Filling
  // water first would let the plaza paving overwrite the pools and leave
  // agents walking across open water.
  for (const p of doc.paths) grid.fill(p, Cell.Path);
  for (const w of doc.water) grid.fill(w, Cell.Blocked);

  for (const b of doc.buildings) {
    // Interior tiles are reachable but only via the entrance.
    grid.fill(b.footprint, Cell.Blocked);
    if (!b.locked) {
      // Carve a single-tile interior lobby corridor from the entrance inward.
      const c = { x: Math.floor(b.footprint.x + b.footprint.w / 2), y: Math.floor(b.footprint.y + b.footprint.h / 2) };
      carveCorridor(grid, b.entrance, c);
      grid.set(b.entrance.x, b.entrance.y, Cell.Entrance);
      for (const room of b.rooms) {
        const rx = b.footprint.x + room.anchor.x;
        const ry = b.footprint.y + room.anchor.y;
        carveCorridor(grid, c, { x: rx, y: ry });
        grid.set(rx, ry, Cell.Interior);
      }
    }
  }

  // Locked expansion plots read as dark land but stay walkable-adjacent, so
  // agents route *around* them rather than through.
  for (const plot of doc.plots) grid.fill(plot, Cell.Blocked);

  return grid;
}

function carveCorridor(grid: NavGrid, from: GridPoint, to: GridPoint): void {
  let x = from.x;
  let y = from.y;
  const guard = grid.w + grid.h;
  let steps = 0;
  while ((x !== to.x || y !== to.y) && steps++ < guard) {
    grid.set(x, y, Cell.Interior);
    if (x !== to.x) x += Math.sign(to.x - x);
    else if (y !== to.y) y += Math.sign(to.y - y);
  }
  grid.set(to.x, to.y, Cell.Interior);
}

/* ------------------------------------------------------------------ */
/* A*                                                                  */
/* ------------------------------------------------------------------ */

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

const NEIGHBOURS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * A* over the nav grid. Returns tile centres, or an empty array when no route
 * exists. `maxNodes` bounds the search so a pathological request can never
 * stall a frame.
 */
export function findPath(
  grid: NavGrid,
  start: GridPoint,
  goal: GridPoint,
  maxNodes = 6000,
): GridPoint[] {
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const gx = Math.floor(goal.x);
  const gy = Math.floor(goal.y);

  if (!grid.inBounds(sx, sy) || !grid.inBounds(gx, gy)) return [];
  if (sx === gx && sy === gy) return [{ x: gx + 0.5, y: gy + 0.5 }];
  if (!grid.walkable(gx, gy)) return [];

  const open: Node[] = [];
  const best = new Map<number, number>();
  const startNode: Node = { x: sx, y: sy, g: 0, f: heuristic(sx, sy, gx, gy), parent: null };
  open.push(startNode);
  best.set(grid.idx(sx, sy), 0);

  let visited = 0;
  while (open.length > 0 && visited++ < maxNodes) {
    // Small open sets: a linear scan beats heap overhead here.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];

    if (current.x === gx && current.y === gy) {
      return smooth(grid, reconstruct(current));
    }

    for (const [dx, dy, stepCost] of NEIGHBOURS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!grid.walkable(nx, ny)) continue;
      // Disallow cutting through a blocked corner diagonally.
      if (dx !== 0 && dy !== 0) {
        if (!grid.walkable(current.x + dx, current.y) || !grid.walkable(current.x, current.y + dy)) {
          continue;
        }
      }
      const g = current.g + stepCost * grid.cost(nx, ny);
      const key = grid.idx(nx, ny);
      const known = best.get(key);
      if (known !== undefined && known <= g) continue;
      best.set(key, g);
      open.push({ x: nx, y: ny, g, f: g + heuristic(nx, ny, gx, gy), parent: current });
    }
  }

  return [];
}

function heuristic(x: number, y: number, gx: number, gy: number): number {
  // Octile distance, scaled slightly under the cheapest terrain cost so the
  // search stays admissible.
  const dx = Math.abs(x - gx);
  const dy = Math.abs(y - gy);
  return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function reconstruct(node: Node): GridPoint[] {
  const out: GridPoint[] = [];
  let cur: Node | null = node;
  while (cur) {
    out.push({ x: cur.x + 0.5, y: cur.y + 0.5 });
    cur = cur.parent;
  }
  return out.reverse();
}

/**
 * String-pulling: drop intermediate waypoints whenever the straight line
 * between the anchor and the lookahead point stays walkable.
 */
export function smooth(grid: NavGrid, path: GridPoint[]): GridPoint[] {
  if (path.length <= 2) return path;
  const out: GridPoint[] = [path[0]];
  let anchor = 0;
  for (let i = 2; i < path.length; i++) {
    if (!lineClear(grid, path[anchor], path[i])) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Sample the segment densely enough that a one-tile obstacle can't be missed. */
export function lineClear(grid: NavGrid, a: GridPoint, b: GridPoint): boolean {
  const steps = Math.ceil(distance(a, b) * 4);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(a.x + (b.x - a.x) * t);
    const y = Math.floor(a.y + (b.y - a.y) * t);
    if (!grid.walkable(x, y)) return false;
  }
  return true;
}

/**
 * Nearest walkable tile to a point, spiralling outward. Used when a config edit
 * leaves an agent standing inside a newly-placed building.
 */
export function nearestWalkable(grid: NavGrid, p: GridPoint, maxRadius = 12): GridPoint | null {
  const px = Math.floor(p.x);
  const py = Math.floor(p.y);
  if (grid.walkable(px, py)) return { x: px + 0.5, y: py + 0.5 };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (grid.walkable(px + dx, py + dy)) {
          return { x: px + dx + 0.5, y: py + dy + 0.5 };
        }
      }
    }
  }
  return null;
}

/** Does this point fall inside any building footprint? Returns the id. */
export function buildingAt(doc: CampusDocument, p: GridPoint): string | null {
  for (const b of doc.buildings) {
    if (rectContains(b.footprint, p)) return b.id;
  }
  return null;
}
