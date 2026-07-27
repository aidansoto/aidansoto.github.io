import { describe, it, expect } from 'vitest';
import {
  NavGrid,
  Cell,
  buildNavGrid,
  findPath,
  lineClear,
  nearestWalkable,
  buildingAt,
  smooth,
} from '@/core/navigation';
import { createDefaultCampus } from '@/config/defaultCampus';
import { distance } from '@/core/iso';

describe('NavGrid', () => {
  it('treats out-of-bounds tiles as blocked', () => {
    const g = new NavGrid(10, 10);
    expect(g.walkable(-1, 5)).toBe(false);
    expect(g.walkable(10, 5)).toBe(false);
    expect(g.walkable(5, 5)).toBe(true);
  });

  it('makes walkways cheaper than open ground so traffic follows paths', () => {
    const g = new NavGrid(10, 10);
    g.set(1, 1, Cell.Path);
    expect(g.cost(1, 1)).toBeLessThan(g.cost(2, 2));
    g.set(3, 3, Cell.Blocked);
    expect(g.cost(3, 3)).toBe(Infinity);
  });

  it('fills rectangles', () => {
    const g = new NavGrid(10, 10);
    g.fill({ x: 2, y: 2, w: 3, h: 3 }, Cell.Blocked);
    expect(g.walkable(2, 2)).toBe(false);
    expect(g.walkable(4, 4)).toBe(false);
    expect(g.walkable(5, 5)).toBe(true);
  });
});

describe('buildNavGrid', () => {
  const doc = createDefaultCampus();
  const grid = buildNavGrid(doc);

  it('sizes itself from the campus document', () => {
    expect(grid.w).toBe(doc.gridSize.w);
    expect(grid.h).toBe(doc.gridSize.h);
  });

  it('blocks water', () => {
    const pool = doc.water[0];
    expect(grid.walkable(pool.x + 1, pool.y + 1)).toBe(false);
  });

  it('blocks reserved expansion plots', () => {
    const plot = doc.plots[0];
    expect(grid.walkable(plot.x + 2, plot.y + 2)).toBe(false);
  });

  it('leaves every building entrance reachable', () => {
    for (const b of doc.buildings) {
      expect(
        grid.walkable(b.entrance.x, b.entrance.y),
        `${b.name} entrance is walled off`,
      ).toBe(true);
    }
  });

  it('carves interior corridors so every room can be reached', () => {
    for (const b of doc.buildings) {
      for (const room of b.rooms) {
        const rx = b.footprint.x + room.anchor.x;
        const ry = b.footprint.y + room.anchor.y;
        expect(grid.walkable(rx, ry), `${b.name} / ${room.name} is unreachable`).toBe(true);
      }
    }
  });

  it('still blocks the solid parts of a building mass', () => {
    // A corner tile of a large footprint is neither corridor nor room anchor.
    const archive = doc.buildings.find((b) => b.id === 'building_archive')!;
    expect(grid.walkable(archive.footprint.x, archive.footprint.y)).toBe(false);
  });
});

describe('findPath', () => {
  const doc = createDefaultCampus();
  const grid = buildNavGrid(doc);

  it('returns a single waypoint when start and goal share a tile', () => {
    const path = findPath(grid, { x: 48.2, y: 48.4 }, { x: 48.8, y: 48.1 });
    expect(path).toHaveLength(1);
  });

  it('routes across the plaza', () => {
    const path = findPath(grid, { x: 40, y: 40 }, { x: 56, y: 56 });
    expect(path.length).toBeGreaterThan(0);
    const end = path[path.length - 1];
    expect(distance(end, { x: 56.5, y: 56.5 })).toBeLessThan(1.5);
  });

  it('produces a path that never crosses a blocked tile', () => {
    const path = findPath(grid, { x: 34, y: 40 }, { x: 62, y: 56 });
    expect(path.length).toBeGreaterThan(1);
    for (let i = 1; i < path.length; i++) {
      expect(lineClear(grid, path[i - 1], path[i])).toBe(true);
    }
  });

  it('routes from the plaza into every building entrance', () => {
    for (const b of doc.buildings) {
      const path = findPath(grid, { x: 48.5, y: 48.5 }, { x: b.entrance.x + 0.5, y: b.entrance.y + 0.5 });
      expect(path.length, `no route to ${b.name}`).toBeGreaterThan(0);
    }
  });

  it('routes from the plaza to every room in every building', () => {
    for (const b of doc.buildings) {
      for (const room of b.rooms) {
        const target = {
          x: b.footprint.x + room.anchor.x + 0.5,
          y: b.footprint.y + room.anchor.y + 0.5,
        };
        const path = findPath(grid, { x: 48.5, y: 48.5 }, target);
        expect(path.length, `no route to ${b.name} / ${room.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('returns an empty path when the goal is unreachable', () => {
    const pool = doc.water[0];
    const path = findPath(grid, { x: 48.5, y: 48.5 }, { x: pool.x + 1.5, y: pool.y + 1.5 });
    expect(path).toEqual([]);
  });

  it('smooths a stair-stepped path into straight runs', () => {
    const open = new NavGrid(20, 20);
    const stepped = [
      { x: 1.5, y: 1.5 },
      { x: 2.5, y: 1.5 },
      { x: 3.5, y: 1.5 },
      { x: 4.5, y: 1.5 },
      { x: 5.5, y: 1.5 },
    ];
    // Nothing blocks the run, so every intermediate waypoint is redundant.
    expect(smooth(open, stepped)).toHaveLength(2);
  });
});

describe('recovery helpers', () => {
  const doc = createDefaultCampus();
  const grid = buildNavGrid(doc);

  it('finds the nearest walkable tile when an agent is stranded in a wall', () => {
    const archive = doc.buildings.find((b) => b.id === 'building_archive')!;
    const stranded = { x: archive.footprint.x + 0.5, y: archive.footprint.y + 0.5 };
    expect(grid.walkable(Math.floor(stranded.x), Math.floor(stranded.y))).toBe(false);

    const safe = nearestWalkable(grid, stranded);
    expect(safe).not.toBeNull();
    expect(grid.walkable(Math.floor(safe!.x), Math.floor(safe!.y))).toBe(true);
  });

  it('returns the point unchanged when it is already walkable', () => {
    const safe = nearestWalkable(grid, { x: 48.2, y: 48.9 });
    expect(safe).toEqual({ x: 48.5, y: 48.5 });
  });

  it('identifies which building contains a point', () => {
    const tower = doc.buildings.find((b) => b.id === 'building_command_tower')!;
    const inside = { x: tower.footprint.x + 2, y: tower.footprint.y + 2 };
    expect(buildingAt(doc, inside)).toBe('building_command_tower');
    expect(buildingAt(doc, { x: 48.5, y: 48.5 })).toBeNull();
  });
});
