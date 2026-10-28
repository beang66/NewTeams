import { describe, expect, it } from 'vitest'
import { sinceLastVisit, sinceText } from '../../src/model/since'
import { approve, human, mk, paused, reject, resumed, t } from './helpers'

const seen = mk('CHAT', 'user', 'master')
const busy = () => [seen, approve('a'), approve('b'), approve('c'), reject('a'), reject('b'), paused(t(1)), resumed(t(2))]

describe('since', () => {
  it('승인·반려·일시정지 집계와 자동 재개', () => {
    const s = sinceLastVisit(busy(), seen.id)!
    expect(s).toMatchObject({ approved: 3, rejected: 2, paused: 1, autoResumed: true, humanOpen: 0, fromTs: seen.ts })
    expect(s.ids).toHaveLength(7)
  })
  it('재개되지 않았거나 주의가 열려 있을 때', () => {
    const h = human('h1', 't1', 'auth')
    const s = sinceLastVisit([seen, paused(t(1)), h], seen.id)!
    expect(s).toMatchObject({ paused: 1, autoResumed: false, humanOpen: 1 })
    const resolved = mk('GUIDANCE', 'user', 'dev', { payload: { action: 'guidance', text: 'x', resolves: 'h1' } })
    expect(sinceLastVisit([seen, h, resolved], seen.id)!.humanOpen).toBe(0)
  })
  it('lastSeenId가 없거나 이후 이벤트가 없으면 null', () => {
    expect(sinceLastVisit([seen, approve('a')], null)).toBeNull()
    expect(sinceLastVisit([seen], seen.id)).toBeNull()
    expect(sinceLastVisit([seen, approve('a')], 'nope')).toBeNull()
  })
  it('문구: 0인 항목 생략, 주의는 항상', () => {
    const s = sinceLastVisit(busy(), seen.id)!
    const at = (ms: number) => new Date(Date.parse(seen.ts) + ms)
    expect(sinceText(s, at(2 * 3_600_000))).toBe('2시간 전부터 · 승인 3 · 반려 2 · 일시정지 1회(자동 재개됨) · 주의 0')
    const only = sinceLastVisit([seen, approve('a')], seen.id)!
    expect(sinceText(only, at(5 * 60_000))).toBe('5분 전부터 · 승인 1 · 주의 0')
    expect(sinceText(only, at(3 * 86_400_000))).toBe('3일 전부터 · 승인 1 · 주의 0')
  })
})
