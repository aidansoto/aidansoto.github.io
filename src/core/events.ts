/**
 * Modular event bus.
 *
 * The simulation (or, later, a real agent backend) publishes typed events here.
 * The renderer, the HUD and the activity log all subscribe. Neither side holds
 * a reference to the other — this is the seam between visuals and agent logic.
 */

import type { CampusEvent, CampusEventMap, CampusEventType } from './types';

type Handler<T extends CampusEventType> = (event: CampusEvent<T>) => void;
type AnyHandler = (event: CampusEvent) => void;

export class EventBus {
  private handlers = new Map<CampusEventType, Set<AnyHandler>>();
  private wildcards = new Set<AnyHandler>();
  private history: CampusEvent[] = [];
  private historyLimit: number;

  constructor(historyLimit = 400) {
    this.historyLimit = historyLimit;
  }

  on<T extends CampusEventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as AnyHandler);
    return () => set!.delete(handler as AnyHandler);
  }

  /** Subscribe to every event. Used by the activity log. */
  onAny(handler: AnyHandler): () => void {
    this.wildcards.add(handler);
    return () => this.wildcards.delete(handler);
  }

  emit<T extends CampusEventType>(type: T, payload: CampusEventMap[T]): CampusEvent<T> {
    const event: CampusEvent<T> = {
      event_type: type,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.history.push(event as CampusEvent);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }

    const set = this.handlers.get(type);
    if (set) {
      for (const h of set) {
        h(event as CampusEvent);
      }
    }
    for (const h of this.wildcards) {
      h(event as CampusEvent);
    }
    return event;
  }

  /**
   * Ingest an event produced elsewhere (e.g. a future agent backend posting
   * JSON over IPC). Shape is validated loosely; unknown types are dropped so a
   * malformed backend message can never crash the renderer.
   */
  ingest(raw: unknown): CampusEvent | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Partial<CampusEvent>;
    if (typeof candidate.event_type !== 'string') return null;
    if (!candidate.payload || typeof candidate.payload !== 'object') return null;
    return this.emit(
      candidate.event_type as CampusEventType,
      candidate.payload as CampusEventMap[CampusEventType],
    );
  }

  recent(limit = 100): CampusEvent[] {
    return this.history.slice(-limit);
  }

  clear(): void {
    this.history = [];
  }

  removeAll(): void {
    this.handlers.clear();
    this.wildcards.clear();
  }
}

/** Application-wide bus. */
export const bus = new EventBus();
