import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryStore, parseAndNormalize, createAutosave } from '@/persistence/storage';
import { createDefaultCampus } from '@/config/defaultCampus';
import { EventBus } from '@/core/events';

describe('MemoryStore', () => {
  it('seeds the default campus on first load', async () => {
    const store = new MemoryStore();
    const { doc } = await store.load();
    expect(doc.buildings).toHaveLength(10);
  });

  it('persists a saved document across loads', async () => {
    const store = new MemoryStore();
    const { doc } = await store.load();

    doc.campusName = 'Northgate Estate';
    doc.settings.weather = 'rain';
    doc.settings.animationSpeed = 1.75;
    doc.buildings[0].name = 'Central Spire';
    await store.save(doc);

    const reloaded = await store.load();
    expect(reloaded.doc.campusName).toBe('Northgate Estate');
    expect(reloaded.doc.settings.weather).toBe('rain');
    expect(reloaded.doc.settings.animationSpeed).toBe(1.75);
    expect(reloaded.doc.buildings[0].name).toBe('Central Spire');
  });

  it('restores defaults on reset', async () => {
    const store = new MemoryStore();
    const { doc } = await store.load();
    doc.campusName = 'Temporary';
    await store.save(doc);

    const fresh = await store.reset();
    expect(fresh.campusName).toBe('Obsidian Campus');

    const reloaded = await store.load();
    expect(reloaded.doc.campusName).toBe('Obsidian Campus');
  });
});

describe('parseAndNormalize', () => {
  it('recovers from unreadable JSON without throwing', () => {
    const { doc, repairs } = parseAndNormalize('{ this is not json');
    expect(doc.buildings.length).toBe(10);
    expect(repairs.some((r) => r.includes('unreadable'))).toBe(true);
  });

  it('repairs a partially valid document', () => {
    const { doc } = parseAndNormalize(JSON.stringify({ campusName: 'Half Built', buildings: [] }));
    expect(doc.campusName).toBe('Half Built');
    expect(doc.buildings.length).toBe(10);
  });
});

describe('createAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses a burst of writes into one', async () => {
    const store = new MemoryStore();
    const spy = vi.spyOn(store, 'save');
    const autosave = createAutosave(store, 200);

    const doc = createDefaultCampus();
    for (let i = 0; i < 40; i++) {
      autosave.schedule({ ...doc, campusName: `Draft ${i}` });
    }
    expect(spy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].campusName).toBe('Draft 39');
  });

  it('flush writes immediately and cancels the pending timer', async () => {
    const store = new MemoryStore();
    const spy = vi.spyOn(store, 'save');
    const autosave = createAutosave(store, 500);

    autosave.schedule(createDefaultCampus());
    await autosave.flush();
    expect(spy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', async () => {
    const store = new MemoryStore();
    const spy = vi.spyOn(store, 'save');
    await createAutosave(store, 200).flush();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('EventBus', () => {
  it('delivers typed events to subscribers', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('alert', (e) => seen.push(e.payload.message));

    bus.emit('alert', { severity: 'info', message: 'hello' });
    expect(seen).toEqual(['hello']);
  });

  it('delivers to wildcard subscribers', () => {
    const bus = new EventBus();
    let count = 0;
    bus.onAny(() => count++);

    bus.emit('alert', { severity: 'info', message: 'a' });
    bus.emit('task_created', { task_id: 't1', label: 'Job', risk: 'standard' });
    expect(count).toBe(2);
  });

  it('unsubscribes cleanly', () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on('alert', () => count++);

    bus.emit('alert', { severity: 'info', message: 'a' });
    off();
    bus.emit('alert', { severity: 'info', message: 'b' });
    expect(count).toBe(1);
  });

  it('stamps every event with a type and an ISO timestamp', () => {
    const bus = new EventBus();
    const event = bus.emit('alert', { severity: 'warn', message: 'x' });
    expect(event.event_type).toBe('alert');
    expect(() => new Date(event.timestamp).toISOString()).not.toThrow();
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('bounds its history', () => {
    const bus = new EventBus(10);
    for (let i = 0; i < 50; i++) {
      bus.emit('alert', { severity: 'info', message: String(i) });
    }
    const recent = bus.recent(100);
    expect(recent).toHaveLength(10);
    expect((recent[9].payload as { message: string }).message).toBe('49');
  });

  it('ingests well-formed backend events and rejects malformed ones', () => {
    const bus = new EventBus();
    let count = 0;
    bus.onAny(() => count++);

    expect(
      bus.ingest({
        event_type: 'agent_state_changed',
        payload: {
          agent_id: 'agent_001',
          previous_state: 'idle',
          new_state: 'working',
          task_id: 'task_001',
          building_id: 'building_002',
          location_id: 'workspace_004',
        },
      }),
    ).not.toBeNull();

    expect(bus.ingest(null)).toBeNull();
    expect(bus.ingest({ payload: {} })).toBeNull();
    expect(bus.ingest({ event_type: 'alert' })).toBeNull();
    expect(count).toBe(1);
  });
});
