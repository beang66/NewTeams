import { describe, expect, it } from 'vitest'
import { initialState, type Stage } from '@orch/store/state'
import type { Envelope } from '@orch/protocol/messages'
import type { AgentConfig } from '../../src/api/client'
import type { RunView } from '../../src/api/useRun'
import { pipelineView } from '../../src/model/pipeline'
import { AGENTS_CLAUDE_WORKER, assign, human, mk, reject, reviewReq, stateWith, withUsage } from './helpers'

const runAt = (stage: Stage, extra: Partial<RunView> = {}): RunView => ({ state: { ...initialState, stage }, events: [], plan: null, agents: null, connected: true, loading: false, ...extra })
const runWith = (events: Envelope[]): RunView => runAt('BUILD', { events })
const runWithAgents = (roles: AgentConfig['roles']): RunView => runAt('BUILD', { agents: { roles: { ...AGENTS_CLAUDE_WORKER.roles, ...roles } } })
const harnessReject = (task: string) => reject(task, [], { from: 'harness' })

describe('pipelineView', () => {
  it('지금 단계는 now, 지난 단계는 done', () => {
    expect(pipelineView(runAt('BUILD')).intake.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done'])
    expect(pipelineView(runAt('SEED')).intake.map((s) => s.state)).toEqual(['done', 'done', 'now', 'future'])
    expect(pipelineView(runAt('INTAKE')).intake.map((s) => s.state)).toEqual(['now', 'human', 'future', 'future'])
    expect(pipelineView(runAt('FINAL_QA')).finish.map((s) => s.state)).toEqual(['done', 'now', 'future', 'future'])
  })
  it('하네스 반려와 검수 반려를 따로 센다', () => {
    expect(pipelineView(runWith([harnessReject('t1'), reject('t1'), reject('t2')])).loop).toMatchObject({ harnessRejects: 1, reviewRejects: 2 })
  })
  it('고정 조건은 agents 설정을 반영한다', () => {
    expect(pipelineView(runWithAgents({ dev: { provider: 'codex', model: 'codex-default' } })).fixed).toMatch(/^작업 G codex-default/)
    expect(pipelineView(runAt('BUILD')).fixed).toBe('작업 C 기본 · 검수 G 읽기 전용 · 병렬 3 · 반려 상한 3 · 같은 지적 2회 · API $8')
  })
  it('교착, 사람 대기, 검수 중 태스크', () => {
    const h = human('msg-9001', 't3', 'repeat_finding')
    const run = runAt('BUILD', { events: [mk('ESCALATE', 'controller', 'master', { task: 't3' }), h], state: stateWith({ t2: 'review', t3: 'rejected' }, { stage: 'BUILD', humanRequired: ['msg-9001'] }) })
    expect(pipelineView(run).loop).toMatchObject({ deadlocks: 1, humanOpen: ['t3'], reviewingTask: 't2' })
  })
  it('태스크별 반려 수와 역할별 토큰·캐시 퍼센트', () => {
    const events = [assign('t1'), withUsage(mk('REPORT', 'dev', 'reviewer', { task: 't1' }), 200, 50), reject('t1'), reviewReq('t1'), withUsage(mk('APPROVE', 'reviewer', 'controller', { task: 't1' }), 0, 0)]
    const v = pipelineView(runAt('BUILD', { events, state: stateWith({ t1: 'approved' }, { stage: 'BUILD' }), agents: AGENTS_CLAUDE_WORKER }))
    expect(v.tasks).toEqual([{ id: 't1', title: 't1', round: 1, rejects: 1, status: 'approved' }])
    expect(v.tokens).toEqual([{ role: 'dev', provider: 'C', tokens: 200, cachedPct: 25 }, { role: 'reviewer', provider: 'G', tokens: 0, cachedPct: 0 }])
  })
})
