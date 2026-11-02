import type { Envelope, MessageType, Usage } from '@orch/protocol/messages'
import type { RunState } from '@orch/store/state'
import type { AgentConfig } from '../api/client'
import { providerOf } from './provider'

export interface Lane { key: string; title: string; role: string; badge?: 'C' | 'G'; task?: string; status: 'running' | 'waiting' | 'blocked' | 'paused' | 'done'; round?: number; tokens: number }
export interface Arrow { id: string; from: string; to: string; ts: number; type: MessageType; task?: string; tone: 'accent' | 'ok' | 'bad' | 'warn' | 'neutral' }

const SYSTEM = new Set(['harness', 'orchestrator', 'controller'])
export function laneKey(side: string, task?: string): string {
  if (SYSTEM.has(side)) return 'system'
  return (side === 'dev' || side === 'qa') && task ? `${side}:${task}` : side
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export { usageSources } from '@orch/usage/usage'
import { usageSources } from '@orch/usage/usage'

const TONE: Partial<Record<MessageType, Arrow['tone']>> = {
  ASSIGN: 'accent', REJECT: 'bad', APPROVE: 'ok', ESCALATE: 'warn', HUMAN_REQUIRED: 'warn',
}
const NO_ARROW = new Set<MessageType>(['STATE_CHANGE', 'PAUSED', 'RESUMED'])
const TITLES: Record<string, string> = { master: '마스터', planner: '기획', reviewer: '리뷰어', system: '시스템', user: '사용자' }
const PAST_PLAN = new Set(['BUILD', 'INTEGRATE', 'FINAL_QA', 'REPORT', 'DONE'])

export function buildLanes(events: Envelope[], state: RunState, agents: AgentConfig | null): { lanes: Lane[]; arrows: Arrow[]; pausedSpans: { start: number; end?: number }[] } {
  const arrows: Arrow[] = []
  const pausedSpans: { start: number; end?: number }[] = []
  const tokens = new Map<string, number>()
  const taskIds = Object.keys(state.tasks)
  let hasUser = false
  for (const e of events) {
    const ts = Date.parse(e.ts)
    if (e.task && !taskIds.includes(e.task)) taskIds.push(e.task)
    if (e.type === 'CHAT') hasUser = true
    if (e.type === 'PAUSED') { if (pausedSpans.at(-1)?.end !== undefined || pausedSpans.length === 0) pausedSpans.push({ start: ts }) }
    else if (e.type === 'RESUMED') { const last = pausedSpans.at(-1); if (last && last.end === undefined) last.end = ts }
    for (const s of usageSources(e)) {
      const k = laneKey(s.role, e.task)
      tokens.set(k, (tokens.get(k) ?? 0) + s.usage.in + s.usage.out)
    }
    if (NO_ARROW.has(e.type)) continue
    arrows.push({ id: e.id, from: laneKey(e.from, e.task), to: laneKey(e.to, e.task), ts, type: e.type, task: e.task, tone: TONE[e.type] ?? 'neutral' })
  }

  const blockedTasks = new Set<string>()
  for (const id of state.humanRequired) {
    const t = events.find((e) => e.id === id)?.task
    if (t) blockedTasks.add(t)
  }
  const statusOf = (task: string | undefined, role: string): Lane['status'] => {
    const done = task && ['approved', 'merged'].includes(state.tasks[task]?.status ?? '')
    if (state.paused && !done) return 'paused'
    if (role === 'master' || role === 'planner') return role === 'planner' && state.stage === 'PLAN' ? 'running' : role === 'planner' && PAST_PLAN.has(state.stage) ? 'done' : 'waiting'
    if (role === 'reviewer') return Object.values(state.tasks).some((t) => t.status === 'review') ? 'running' : 'waiting'
    const st = task ? state.tasks[task]?.status : undefined
    if (task && (st === 'blocked' || blockedTasks.has(task))) return 'blocked'
    if (st === 'approved' || st === 'merged') return 'done'
    if (role === 'dev') return st === 'running' || st === 'rejected' ? 'running' : 'waiting'
    return st === 'review' ? 'running' : 'waiting'
  }
  const badgeOf = (role: string): Lane['badge'] => (role === 'system' || role === 'user' ? undefined : providerOf(role, agents) === 'claude' ? 'C' : 'G')
  const lane = (key: string, title: string, role: string, task?: string): Lane => {
    const l: Lane = { key, title, role, task, status: key === 'system' || key === 'user' ? 'waiting' : statusOf(task, role), tokens: tokens.get(key) ?? 0 }
    const badge = badgeOf(role)
    if (badge) l.badge = badge
    if (task) l.round = state.tasks[task]?.round
    return l
  }

  const lanes: Lane[] = [lane('master', TITLES.master!, 'master'), lane('planner', TITLES.planner!, 'planner')]
  for (const t of taskIds) lanes.push(lane(`dev:${t}`, `개발 ${t}`, 'dev', t))
  for (const t of taskIds) lanes.push(lane(`qa:${t}`, `QA ${t}`, 'qa', t))
  lanes.push(lane('reviewer', TITLES.reviewer!, 'reviewer'), lane('system', TITLES.system!, 'system'))
  if (hasUser) lanes.push(lane('user', TITLES.user!, 'user'))
  return { lanes, arrows, pausedSpans }
}

/** ts 오름차순 arrows에서 [fromMs, toMs] 안의 것만 (이진 탐색). */
export function windowArrows(arrows: Arrow[], fromMs: number, toMs: number): Arrow[] {
  const bound = (pred: (a: Arrow) => boolean): number => {
    let lo = 0, hi = arrows.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pred(arrows[mid]!)) hi = mid; else lo = mid + 1 }
    return lo
  }
  return arrows.slice(bound((a) => a.ts >= fromMs), bound((a) => a.ts > toMs))
}
