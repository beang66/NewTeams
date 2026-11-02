import { describe, expect, it } from 'vitest'
import { usageView } from '../../src/model/usage'
import { AGENTS_CLAUDE_WORKER as A, approve, human, mk, report, reviewReq, stateWith, withUsage } from './helpers'

const NOW = new Date('2026-10-27T05:00:00Z')
const pausedState = (until: string) => stateWith({}, { paused: { reason: 'rate_limit', until } })

describe('usage', () => {
  it('provider별 토큰 합과 재개까지 남은 시간', () => {
    const u = usageView([withUsage(report('t1'), 1000, 800), withUsage(approve('t1'), 500, 0)], pausedState('2026-10-27T05:30:00Z'), A, NOW)
    expect(u.byProvider.claude).toEqual({ tokens: 1000, cached: 800 }); expect(u.byProvider.codex.tokens).toBe(500)
    expect(u.paused!.remainingMs).toBe(30 * 60_000); expect(u.paused!.needsHuman).toBe(false)
  })
  it('qa 메타 usage는 qa 역할, GUIDANCE는 master', () => {
    const rr = reviewReq('t1', { payload: { qa: { usage: { in: 70, out: 30, cached: 5 } } } })
    const g = withUsage(mk('GUIDANCE', 'master', 'dev', { task: 't1' }), 10, 0)
    const u = usageView([rr, g], stateWith({}), { roles: { ...A.roles, qa: { provider: 'codex', model: 'x' } } }, NOW)
    expect(u.byProvider.codex).toEqual({ tokens: 100, cached: 5 }); expect(u.byProvider.claude.tokens).toBe(10)
  })
  it('providerOf: reviewer는 codex 고정, 누락·null은 claude', () => {
    const ev = [withUsage(approve('t1'), 5, 0), withUsage(report('t1'), 7, 0)]
    for (const a of [{ roles: {} }, null]) {
      const u = usageView(ev, stateWith({}), a, NOW)
      expect([u.byProvider.codex.tokens, u.byProvider.claude.tokens]).toEqual([5, 7])
    }
  })
  it('API 지출과 기본 상한 8', () => {
    const u = usageView([], stateWith({}, { apiSpendUsd: 1.5 }), null, NOW)
    expect(u).toMatchObject({ apiSpendUsd: 1.5, apiCapUsd: 8 }); expect(u.paused).toBeUndefined()
  })
  it('서울 날짜별 토큰과 기록 비용을 합산한다', () => {
    const before = withUsage(report('t1', { ts: '2026-11-01T14:59:00Z' }), 1200, 200)
    before.usage = { ...before.usage!, costUsd: 0.12 }
    const after = withUsage(report('t1', { ts: '2026-11-01T15:00:00Z' }), 800, 100)
    after.usage = { ...after.usage!, costUsd: 0.08 }
    const u = usageView([before, after], stateWith({}), A, NOW)
    expect(u.totalTokens).toBe(2000)
    expect(u.recordedCostUsd).toBeCloseTo(0.2)
    expect(u.byDay).toEqual([
      { date: '2026-11-01', tokens: 1200, cached: 200, costUsd: 0.12, hasCost: true },
      { date: '2026-11-02', tokens: 800, cached: 100, costUsd: 0.08, hasCost: true },
    ])
    expect(u.hasRecordedCost).toBe(true)
  })
  it('일시정지 뒤 열린 auth HUMAN_REQUIRED면 needsHuman', () => {
    const ev = [mk('PAUSED', 'controller', 'user', { payload: { reason: 'rate_limit' } }), human('msg-h', undefined, 'auth')]
    const s = { ...pausedState('2026-10-27T04:00:00Z'), humanRequired: ['msg-h'] }
    expect(usageView(ev, s, A, NOW).paused).toMatchObject({ needsHuman: true, remainingMs: 0 })
  })
})
