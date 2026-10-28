import type { Envelope } from '@orch/protocol/messages'
import type { RunState } from '@orch/store/state'

export interface DoneStats {
  tasks: number
  rejects: number
  harnessRejects: number
  reviewerRejects: number
  approves: number
  humanCalls: number
  firstId?: string
  lastId?: string
  lastTs?: string
  durationMs?: number
}

/** Plain counts derived from the event log and run state; nothing is estimated. */
export function doneStats(events: Envelope[], state: RunState): DoneStats {
  const count = (type: Envelope['type']) => events.filter((e) => e.type === type).length
  const first = events[0]
  const last = events[events.length - 1]
  const t0 = first ? Date.parse(first.ts) : NaN
  const t1 = last ? Date.parse(last.ts) : NaN
  return {
    tasks: Object.keys(state.tasks).length,
    rejects: count('REJECT'),
    harnessRejects: events.filter((e) => e.type === 'REJECT' && e.from === 'harness').length,
    reviewerRejects: events.filter((e) => e.type === 'REJECT' && e.from === 'reviewer').length,
    approves: count('APPROVE'),
    humanCalls: count('HUMAN_REQUIRED'),
    firstId: first?.id,
    lastId: last?.id,
    lastTs: last?.ts,
    durationMs: Number.isNaN(t0) || Number.isNaN(t1) ? undefined : Math.max(0, t1 - t0),
  }
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 1) return '1분 미만'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? (m > 0 ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`
}

export function clock(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}
