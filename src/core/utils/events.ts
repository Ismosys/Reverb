/**
 * Minimal strongly-typed event emitter. Avoids the loose typing of Node's
 * EventEmitter while keeping a tiny, dependency-free surface.
 */
export type Listener<T> = (payload: T) => void

export class TypedEmitter<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<Listener<unknown>>>()

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener<unknown>)
    return () => this.off(event, listener)
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      try {
        ;(listener as Listener<Events[K]>)(payload)
      } catch {
        // A misbehaving listener must never break the emitter.
      }
    }
  }

  removeAll(): void {
    this.listeners.clear()
  }
}
