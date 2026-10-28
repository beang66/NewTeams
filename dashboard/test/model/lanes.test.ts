import { describe, expect, it } from 'vitest'
import { buildLanes, laneKey, windowArrows, type Arrow } from '../../src/model/lanes'
import { AGENTS_CLAUDE_WORKER as A, approve, assign, mk, paused, reject, resumed, reviewReq, stateWith, t } from './helpers'

const S = stateWith({ t1: 'running' })
const arrow = (ts: number): Arrow => ({ id: `a${ts}`, from: 'master', to: 'dev:t1', ts, type: 'ASSIGN', tone: 'neutral' })

describe('lanes', () => {
  it('dev/qa는 태스크별 레인, harness는 system 레인', () => {
    expect(laneKey('dev', 't1')).toBe('dev:t1'); expect(laneKey('qa', 't1')).toBe('qa:t1')
    expect(laneKey('harness')).toBe('system'); expect(laneKey('controller')).toBe('system'); expect(laneKey('reviewer')).toBe('reviewer')
  })
  it('레인 배지는 /api/agents의 provider', () => {
    const { lanes } = buildLanes([assign('t1'), reviewReq('t1')], stateWith({ t1: 'review' }), A)
    expect(lanes.find((l) => l.key === 'dev:t1')!.badge).toBe('C'); expect(lanes.find((l) => l.key === 'reviewer')!.badge).toBe('G')
  })
  it('레인 순서와 user 레인 조건', () => {
    const keys = buildLanes([assign('t1')], stateWith({ t1: 'running', t2: 'pending' }), A).lanes.map((l) => l.key)
    expect(keys).toEqual(['master', 'planner', 'dev:t1', 'dev:t2', 'qa:t1', 'qa:t2', 'reviewer', 'system'])
    expect(buildLanes([mk('CHAT', 'user', 'master')], S, A).lanes.at(-1)!.key).toBe('user')
  })
  it('반려 화살표는 bad, 승인은 ok, 실행 중 지시는 accent', () => {
    const { arrows } = buildLanes([assign('t1'), reject('t1'), approve('t1')], S, A)
    expect(arrows.map((a) => a.tone)).toEqual(['accent', 'bad', 'ok'])
    expect(arrows[0]).toMatchObject({ from: 'system', to: 'dev:t1' })
  })
  it('PAUSED~RESUMED 구간, 열린 구간', () => {
    expect(buildLanes([paused(t(1)), resumed(t(5))], S, A).pausedSpans).toEqual([{ start: t(1), end: t(5) }])
    expect(buildLanes([paused(t(1))], S, A).pausedSpans).toEqual([{ start: t(1) }])
  })
  it('상태 도출: 일시정지·완료·검수 중·막힘', () => {
    const st = stateWith({ t1: 'approved', t2: 'review', t3: 'blocked' })
    const by = (s = st) => Object.fromEntries(buildLanes([], s, A).lanes.map((l) => [l.key, l.status]))
    expect(by()).toMatchObject({ 'dev:t1': 'done', 'qa:t2': 'running', reviewer: 'running', 'dev:t3': 'blocked', master: 'waiting' })
    expect(by({ ...st, paused: { reason: 'rate_limit' } })).toMatchObject({ 'dev:t2': 'paused', system: 'waiting' })
  })
  it('windowArrows는 창 안의 것만', () => {
    const arrows = Array.from({ length: 3000 }, (_, i) => arrow(i * 1000))
    expect(windowArrows(arrows, 10_000, 20_000)).toHaveLength(11)
    expect(windowArrows(arrows, 5_000_000, 6_000_000)).toHaveLength(0)
  })
})
