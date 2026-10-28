import type { Envelope, Finding, MessageType } from '@orch/protocol/messages'
import type { Plan } from '@orch/protocol/plan'
import { initialState, type RunState, type TaskStatus } from '@orch/store/state'
import type { AgentConfig } from '../../src/api/client'

export const t = (min: number): number => Date.parse('2026-10-27T00:00:00Z') + min * 60_000
let seq = 0
export function mk(type: MessageType, from: string, to: string, extra: Partial<Envelope> = {}): Envelope {
  seq += 1
  return { id: `msg-${String(seq).padStart(4, '0')}`, ts: new Date(t(seq)).toISOString(), type, from, to, payload: {}, ...extra }
}
export const assign = (task: string, x: Partial<Envelope> = {}): Envelope => mk('ASSIGN', 'controller', 'dev', { task, round: 1, ...x })
export const report = (task: string, x: Partial<Envelope> = {}): Envelope => mk('REPORT', 'dev', 'reviewer', { task, ...x })
export const reviewReq = (task: string, x: Partial<Envelope> = {}): Envelope => mk('REVIEW_REQUEST', 'dev', 'reviewer', { task, ...x })
export const reject = (task: string, findings: Finding[] = [], x: Partial<Envelope> = {}): Envelope => mk('REJECT', 'reviewer', 'dev', { task, payload: { findings }, ...x })
export const approve = (task: string, x: Partial<Envelope> = {}): Envelope => mk('APPROVE', 'reviewer', 'controller', { task, ...x })
export const guidance = (task: string, text: string, x: Partial<Envelope> = {}): Envelope => mk('GUIDANCE', 'master', 'dev', { task, payload: { action: 'retry', text }, ...x })
export const human = (id: string, task: string | undefined, reason: string, detail = ''): Envelope => mk('HUMAN_REQUIRED', 'controller', 'user', { id, task, payload: { reason, detail } })
export const paused = (ms: number, until?: string): Envelope => mk('PAUSED', 'controller', 'user', { ts: new Date(ms).toISOString(), payload: { reason: 'rate_limit', until } })
export const resumed = (ms: number): Envelope => mk('RESUMED', 'controller', 'user', { ts: new Date(ms).toISOString() })
export const F = (id: string): Finding => ({ id, severity: 'major', issue: `issue ${id}` })
export const withUsage = (e: Envelope, tokens: number, cached: number): Envelope => ({ ...e, usage: { in: tokens, out: 0, cached } })

export function stateWith(tasks: Record<string, TaskStatus>, extra: Partial<RunState> = {}): RunState {
  return { ...initialState, tasks: Object.fromEntries(Object.entries(tasks).map(([k, status]) => [k, { status, round: 1 }])), ...extra }
}
const role = (provider: 'claude' | 'codex') => ({ provider, model: 'm' })
export const AGENTS_CLAUDE_WORKER: AgentConfig = {
  roles: { master: role('claude'), planner: role('claude'), dev: role('claude'), qa: role('claude'), reviewer: role('codex') },
}
export const PLAN: Plan = {
  tasks: ['a', 'b', 'c', 'd'].map((id) => ({ id, title: `태스크 ${id}`, deps: [], ownedFiles: [], difficulty: 'low' as const, acceptance: [], qaScenarios: [] })),
  testCommands: [], devCommand: '',
}
