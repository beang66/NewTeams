import type { Envelope } from '@orch/protocol/messages'

export interface SinceSummary { fromTs: string | null; approved: number; rejected: number; paused: number; autoResumed: boolean; humanOpen: number; ids: string[] }
/** unknown: 첫 방문이거나 lastSeenId를 못 찾음(기준점 다시 잡기). none: 새 이벤트 없음. */
export type Since = { kind: 'unknown' } | { kind: 'none' } | ({ kind: 'some' } & SinceSummary)

/** A login/cap request is closed by the human [재개], which the server records only as RESUMED. */
const resumedAfter = (e: Envelope, later: Envelope[]): boolean => {
  const reason = (e.payload as { reason?: unknown } | null)?.reason
  return (reason === 'auth' || reason === 'openai_cap') && later.some((x) => x.type === 'RESUMED')
}

export function sinceLastVisit(events: Envelope[], lastSeenId: string | null): Since {
  if (!lastSeenId) return { kind: 'unknown' }
  const idx = events.findIndex((e) => e.id === lastSeenId)
  if (idx < 0) return { kind: 'unknown' }
  if (idx === events.length - 1) return { kind: 'none' }
  const after = events.slice(idx + 1)
  const count = (type: Envelope['type']): number => after.filter((e) => e.type === type).length
  const lastPaused = after.map((e) => e.type).lastIndexOf('PAUSED')
  const resolved = new Set(after.flatMap((e) => {
    const r = e.type === 'GUIDANCE' ? (e.payload as { resolves?: unknown } | null)?.resolves : undefined
    return typeof r === 'string' ? [r] : []
  }))
  return {
    kind: 'some',
    fromTs: events[idx]!.ts,
    approved: count('APPROVE'),
    rejected: count('REJECT'),
    paused: count('PAUSED'),
    autoResumed: lastPaused >= 0 && after.slice(lastPaused + 1).some((e) => e.type === 'RESUMED'),
    humanOpen: after.filter((e, i) => e.type === 'HUMAN_REQUIRED' && !resolved.has(e.id) && !resumedAfter(e, after.slice(i + 1))).length,
    ids: after.map((e) => e.id),
  }
}

function ago(fromTs: string | null, now: Date): string {
  const min = Math.max(1, Math.floor((now.getTime() - Date.parse(fromTs ?? '')) / 60_000))
  if (Number.isNaN(min)) return ''
  if (min < 60) return `${min}분 전부터`
  if (min < 1440) return `${Math.floor(min / 60)}시간 전부터`
  return `${Math.floor(min / 1440)}일 전부터`
}

export function sinceText(s: Extract<Since, { kind: 'some' }>, now: Date): string {
  const parts = [ago(s.fromTs, now)].filter(Boolean)
  if (s.approved) parts.push(`승인 ${s.approved}`)
  if (s.rejected) parts.push(`반려 ${s.rejected}`)
  if (s.paused) parts.push(`일시정지 ${s.paused}회${s.autoResumed ? '(자동 재개됨)' : ''}`)
  parts.push(`주의 ${s.humanOpen}`)
  return parts.join(' · ')
}
