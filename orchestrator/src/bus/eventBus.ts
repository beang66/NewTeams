import type { Clock } from '../clock.js'
import type { Envelope, NewEnvelope } from '../protocol/messages.js'
import type { ProjectStore } from '../store/projectStore.js'

type Subscriber = (e: Envelope) => void

export class EventBus {
  private seq: number
  private readonly subs = new Set<Subscriber>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly store: ProjectStore, private readonly clock: Clock, lastId?: string) {
    const m = lastId ? /(\d+)$/.exec(lastId) : null
    this.seq = m ? parseInt(m[1], 10) : 0
  }

  publish(e: NewEnvelope): Promise<Envelope> {
    const run = async (): Promise<Envelope> => {
      const next = this.seq + 1
      const full: Envelope = {
        ...e,
        id: `msg-${String(next).padStart(4, '0')}`,
        ts: this.clock.now().toISOString(),
      }
      await this.store.appendEvent(full)
      this.seq = next
      for (const fn of [...this.subs]) {
        try { fn(full) } catch (err) { console.error('EventBus subscriber failed', err) }
      }
      return full
    }
    const result = this.queue.then(run)
    this.queue = result.catch(() => undefined)
    return result
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn)
    return () => { this.subs.delete(fn) }
  }
}
