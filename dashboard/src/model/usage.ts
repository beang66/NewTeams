import type { Envelope } from '@orch/protocol/messages'
import type { RunState } from '@orch/store/state'
import type { AgentConfig } from '../api/client'
import { usageSources } from './lanes'
import { providerOf } from './provider'

export interface UsageView {
  byProvider: Record<'claude' | 'codex', { tokens: number; cached: number }>
  totalTokens: number
  recordedCostUsd: number
  hasRecordedCost: boolean
  byDay: { date: string; tokens: number; cached: number; costUsd: number; hasCost: boolean }[]
  apiSpendUsd: number
  apiCapUsd: number
  paused?: { reason: string; until?: Date; remainingMs?: number; needsHuman: boolean }
}

function seoulDateKey(ts: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ts))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function usageView(events: Envelope[], state: RunState, agents: AgentConfig | null, now: Date, apiCapUsd = 8): UsageView {
  const byProvider = { claude: { tokens: 0, cached: 0 }, codex: { tokens: 0, cached: 0 } }
  const days = new Map<string, { date: string; tokens: number; cached: number; costUsd: number; hasCost: boolean }>()
  let totalTokens = 0
  let recordedCostUsd = 0
  let hasRecordedCost = false
  for (const e of events) {
    for (const s of usageSources(e)) {
      const tokens = s.usage.in + s.usage.out
      const costUsd = s.usage.costUsd ?? 0
      const hasCost = s.usage.costUsd !== undefined
      const b = byProvider[providerOf(s.role, agents)]
      b.tokens += tokens
      b.cached += s.usage.cached
      totalTokens += tokens
      recordedCostUsd += costUsd
      hasRecordedCost ||= hasCost
      const date = seoulDateKey(e.ts)
      const day = days.get(date) ?? { date, tokens: 0, cached: 0, costUsd: 0, hasCost: false }
      day.tokens += tokens
      day.cached += s.usage.cached
      day.costUsd += costUsd
      day.hasCost ||= hasCost
      days.set(date, day)
    }
  }
  const view: UsageView = {
    byProvider,
    totalTokens,
    recordedCostUsd,
    hasRecordedCost,
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    apiSpendUsd: state.apiSpendUsd,
    apiCapUsd,
  }
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
