import type { EventBus } from '../bus/eventBus.js'
import type { Envelope, MessageType } from '../protocol/messages.js'

export interface Notifier { notify(event: Envelope): Promise<void> }
export const NOTIFY_TYPES: MessageType[] = ['HUMAN_REQUIRED', 'STATE_CHANGE', 'PAUSED', 'CHAT']

export function attachNotifier(bus: EventBus, notifier: Notifier, types: MessageType[] = NOTIFY_TYPES): () => void {
  return bus.subscribe((event) => {
    if (!types.includes(event.type)) return
    const payload = event.payload as Record<string, unknown>
    if (event.type === 'STATE_CHANGE' && typeof payload.stage !== 'string') return
    if (event.type === 'CHAT' && payload.specApprovalRequired !== true) return
    void Promise.resolve().then(() => notifier.notify(event)).catch((error: unknown) => console.error('Notifier failed', error))
  })
}

export const consoleNotifier: Notifier = {
  async notify(event) { console.log(`[${event.ts}] ${event.type} ${JSON.stringify(event.payload)}`) },
}
