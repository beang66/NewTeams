import type { Envelope } from '@orch/protocol/messages'
import type { RunState } from '@orch/store/state'
import type { AgentConfig } from '../api/client'
import { usageSources } from './lanes'
import { providerOf } from './provider'

export interface UsageView {
  byProvider: Record<'claude' | 'codex', { tokens: number; cached: number }>
  apiSpendUsd: number
  apiCapUsd: number
  paused?: { reason: string; until?: Date; remainingMs?: number; needsHuman: boolean }
}

export function usageView(events: Envelope[], state: RunState, agents: AgentConfig | null, now: Date, apiCapUsd = 8): UsageView {
  const byProvider = { claude: { tokens: 0, cached: 0 }, codex: { tokens: 0, cached: 0 } }
  for (const e of events) {
    for (const s of usageSources(e)) {
      const b = byProvider[providerOf(s.role, agents)]
      b.tokens += s.usage.in + s.usage.out
      b.cached += s.usage.cached
    }
  }
  const view: UsageView = { byProvider, apiSpendUsd: state.apiSpendUsd, apiCapUsd }
  if (state.paused) {
    const until = state.paused.until ? new Date(state.paused.until) : undefined
    const valid = until && !Number.isNaN(until.getTime()) ? until : undefined
    const pausedAt = events.map((e) => e.type).lastIndexOf('PAUSED')
    const needsHuman = pausedAt >= 0 && events.slice(pausedAt + 1).some((e) => {
      const reason = (e.payload as { reason?: unknown } | null)?.reason
      return e.type === 'HUMAN_REQUIRED' && state.humanRequired.includes(e.id) && (reason === 'auth' || reason === 'openai_cap')
    })
    view.paused = { reason: state.paused.reason, until: valid, remainingMs: valid ? Math.max(0, valid.getTime() - now.getTime()) : undefined, needsHuman }
  }
  return view
}
