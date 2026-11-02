import type { Envelope } from '../protocol/messages.js'

export type Stage = 'INTAKE' | 'SPEC_APPROVED' | 'SEED' | 'PLAN' | 'BUILD' | 'INTEGRATE' | 'FINAL_QA' | 'REPORT' | 'DONE'
export type TaskStatus = 'pending' | 'running' | 'review' | 'rejected' | 'approved' | 'merged' | 'blocked'
export interface TaskState { status: TaskStatus; round: number; sessionId?: string; worktree?: string }
export interface RunState {
  stage: Stage
  seedSessionIds: Record<string, string>
  masterSessionId?: string
  tasks: Record<string, TaskState>
  paused?: { reason: string; until?: string }
  /** 사람이 켠 파이프라인 실행 상태. 없으면 아직 한 번도 시작하지 않은 것(첫 시작은 항상 사람). */
  pipeline?: 'running' | 'stopped'
  humanRequired: string[]
  lastEventId?: string
  apiSpendUsd: number
}

export const initialState: RunState = {
  stage: 'INTAKE',
  seedSessionIds: {},
  tasks: {},
  humanRequired: [],
  apiSpendUsd: 0,
}

interface StateChangePayload {
  stage?: Stage
  taskStatus?: TaskStatus
  seed?: { model: string; sessionId: string }
  masterSessionId?: string
  sessionId?: string
  worktree?: string
  apiSpendUsd?: number
  pipeline?: 'running' | 'stopped'
}

function obj(p: unknown): Record<string, unknown> {
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
}

function setTask(s: RunState, id: string, patch: Partial<TaskState>, create: boolean): RunState {
  const cur = s.tasks[id]
  if (!cur && !create) return s
  const next: TaskState = { ...(cur ?? { status: 'pending', round: 0 }), ...patch }
  return { ...s, tasks: { ...s.tasks, [id]: next } }
}

export function applyEvent(s: RunState, e: Envelope): RunState {
  let n: RunState = s
  switch (e.type) {
    case 'ASSIGN':
      if (e.task) n = setTask(s, e.task, { status: 'running', round: e.round ?? s.tasks[e.task]?.round ?? 0 }, true)
      break
    case 'REVIEW_REQUEST':
      if (e.task) n = setTask(s, e.task, { status: 'review' }, false)
      break
    case 'REJECT':
      if (e.task) n = setTask(s, e.task, { status: 'rejected' }, false)
      break
    case 'APPROVE':
      if (e.task) n = setTask(s, e.task, { status: 'approved' }, false)
      break
    case 'PAUSED': {
      const p = obj(e.payload)
      n = { ...s, paused: { reason: String(p.reason ?? ''), until: typeof p.until === 'string' ? p.until : undefined } }
      break
    }
    case 'RESUMED': {
      const { paused: _paused, ...rest } = s
      n = rest
      break
    }
    case 'HUMAN_REQUIRED':
      if (!s.humanRequired.includes(e.id)) n = { ...s, humanRequired: [...s.humanRequired, e.id] }
      break
    case 'GUIDANCE': {
      const r = obj(e.payload).resolves
      if (typeof r === 'string') n = { ...s, humanRequired: s.humanRequired.filter((id) => id !== r) }
      break
    }
    case 'STATE_CHANGE': {
      const p = obj(e.payload) as StateChangePayload
      if (p.stage) n = { ...n, stage: p.stage }
      if (p.pipeline === 'running' || p.pipeline === 'stopped') n = { ...n, pipeline: p.pipeline }
      if (typeof p.masterSessionId === 'string') n = { ...n, masterSessionId: p.masterSessionId }
      if (typeof p.apiSpendUsd === 'number') n = { ...n, apiSpendUsd: p.apiSpendUsd }
      if (p.seed) n = { ...n, seedSessionIds: { ...n.seedSessionIds, [p.seed.model]: p.seed.sessionId } }
      if (e.task) {
        const patch: Partial<TaskState> = {}
        if (p.taskStatus) patch.status = p.taskStatus
        if (typeof p.sessionId === 'string') patch.sessionId = p.sessionId
        if (typeof p.worktree === 'string') patch.worktree = p.worktree
        if (Object.keys(patch).length) n = setTask(n, e.task, patch, true)
      }
      break
    }
    default:
      break
  }
  return { ...n, lastEventId: e.id }
}

export function rebuildState(events: Envelope[]): RunState {
  return events.reduce(applyEvent, initialState)
}
