/** Tiny event emitter (node:events is not available in browsers). */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(data: never) => void>>();

  on<E extends keyof Events>(event: E, cb: (data: Events[E]) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb as (data: never) => void);
    return () => void this.listeners.get(event)?.delete(cb as (data: never) => void);
  }

  emit<E extends keyof Events>(event: E, data: Events[E]) {
    for (const cb of [...(this.listeners.get(event) ?? [])]) {
      try {
        (cb as (d: Events[E]) => void)(data);
      } catch (e) {
        console.error(`[kiosk] listener for ${String(event)} failed`, e);
      }
    }
  }
}
