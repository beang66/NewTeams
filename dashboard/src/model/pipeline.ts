import type { Stage, TaskStatus } from '@orch/store/state'
import type { RunView } from '../api/useRun'
import { boardGroups } from './board'
import { doneStats } from './doneStats'
import { STAGE_ORDER } from './labels'
import { usageSources } from './lanes'
import { providerOf } from './provider'

export type StepState = 'done' | 'now' | 'future' | 'human'

/** The dashboard has no config endpoint, so the orchestrator defaults live here and nowhere else. */
export const PIPELINE_DEFAULTS = { maxParallel: 3, rejectLimit: 3, repeatFindingLimit: 2, apiCapUsd: 8 } as const

export interface PipelineView {
  fixed: string
  intake: { stage: Stage; state: StepState; note: string }[]
  loop: { harnessRejects: number; reviewRejects: number; deadlocks: number; humanOpen: string[]; reviewingTask?: string }
  finish: { stage: Stage; state: StepState }[]
  tasks: { id: string; title: string; round: number; rejects: number; status: TaskStatus }[]
  tokens: { role: string; provider: 'C' | 'G'; tokens: number; cachedPct: number }[]
}

/** humanOpen entry for a HUMAN_REQUIRED event that has no task. */
export const WHOLE_RUN = '전체'
const ROLE_ORDER = ['master', 'planner', 'dev', 'qa', 'reviewer']

/** done before the current stage, now at it, future after it. */
export function stepState(stage: Stage, current: Stage): StepState {
  const a = STAGE_ORDER.indexOf(stage)
  const b = STAGE_ORDER.indexOf(current)
  return a < b ? 'done' : a === b ? 'now' : 'future'
}

export function pipelineView(run: RunView): PipelineView {
  const { state, events, agents, plan } = run
  const stats = doneStats(events, state)
  const d = PIPELINE_DEFAULTS
  const worker = providerOf('dev', agents) === 'claude' ? 'C' : 'G'
  const fixed = `작업 ${worker} ${agents?.roles?.dev?.model || '기본'} · 검수 G 읽기 전용 · 병렬 ${d.maxParallel} · 반려 상한 ${d.rejectLimit} · 같은 지적 ${d.repeatFindingLimit}회 · API $${d.apiCapUsd}`

  const chats = events.filter((e) => e.type === 'CHAT' && e.from === 'user').length
  const seeds = Object.keys(state.seedSessionIds).length
  const planned = plan?.tasks.length ?? Object.keys(state.tasks).filter((id) => id !== 'plan' && id !== 'final').length
  const intake: PipelineView['intake'] = [
    { stage: 'INTAKE', state: stepState('INTAKE', state.stage), note: chats > 0 ? `대화 ${chats}턴` : '' },
    { stage: 'SPEC_APPROVED', state: state.stage === 'INTAKE' ? 'human' : 'done', note: '' },
    { stage: 'SEED', state: stepState('SEED', state.stage), note: seeds > 0 ? `모델별 시드 ${seeds}개` : '' },
    { stage: 'PLAN', state: stepState('PLAN', state.stage), note: planned > 0 ? `태스크 ${planned}개` : '' },
  ]

  // A HUMAN_REQUIRED event without a task concerns the whole run (shown as 전체).
  const humanOpen = [...new Set(state.humanRequired.map((id) => events.find((e) => e.id === id)).filter((e) => e !== undefined).map((e) => e.task ?? WHOLE_RUN))]
  const reviewingTask = Object.entries(state.tasks).find(([, t]) => t.status === 'review')?.[0]
  const rejectsBy = new Map<string, number>()
  for (const e of events) if (e.type === 'REJECT' && e.task) rejectsBy.set(e.task, (rejectsBy.get(e.task) ?? 0) + 1)
  const order = plan?.tasks.map((t) => t.id) ?? []
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i }
  const tasks = boardGroups(state, plan).flatMap((g) => g.tasks)
    .map((t) => ({ ...t, rejects: rejectsBy.get(t.id) ?? 0 }))
    .sort((a, b) => rank(a.id) - rank(b.id))

  const acc = new Map<string, { tokens: number; in: number; cached: number }>()
  for (const e of events) {
    for (const s of usageSources(e)) {
      const a = acc.get(s.role) ?? { tokens: 0, in: 0, cached: 0 }
      a.tokens += s.usage.in + s.usage.out
      a.in += s.usage.in
      a.cached += s.usage.cached
      acc.set(s.role, a)
    }
  }
  const roles = [...ROLE_ORDER.filter((r) => acc.has(r)), ...[...acc.keys()].filter((r) => !ROLE_ORDER.includes(r))]
  const tokens = roles.map((role) => {
    const a = acc.get(role)!
    return { role, provider: providerOf(role, agents) === 'claude' ? ('C' as const) : ('G' as const), tokens: a.tokens, cachedPct: a.in > 0 ? Math.round((a.cached / a.in) * 100) : 0 }
  })

  return {
    fixed, intake,
    loop: { harnessRejects: stats.harnessRejects, reviewRejects: stats.reviewerRejects, deadlocks: events.filter((e) => e.type === 'ESCALATE').length, humanOpen, ...(reviewingTask ? { reviewingTask } : {}) },
    finish: (['INTEGRATE', 'FINAL_QA', 'REPORT', 'DONE'] as Stage[]).map((stage) => ({ stage, state: stepState(stage, state.stage) })),
    tasks, tokens,
  }
}
