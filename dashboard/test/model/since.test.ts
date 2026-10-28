import { describe, expect, it } from 'vitest'
import { sinceLastVisit, sinceText, type Since } from '../../src/model/since'
import { approve, human, mk, paused, reject, resumed, t } from './helpers'

const some = (s: Since) => { if (s.kind !== 'some') throw new Error(s.kind); return s }
const seen = mk('CHAT', 'user', 'master')
const busy = () => [seen, approve('a'), approve('b'), approve('c'), reject('a'), reject('b'), paused(t(1)), resumed(t(2))]

describe('since', () => {
  it('승인·반려·일시정지 집계와 자동 재개', () => {
    const s = some(sinceLastVisit(busy(), seen.id))
    expect(s).toMatchObject({ approved: 3, rejected: 2, paused: 1, autoResumed: true, humanOpen: 0, fromTs: seen.ts })
    expect(s.ids).toHaveLength(7)
  })
  it('재개되지 않았거나 주의가 열려 있을 때', () => {
    const h = human('h1', 't1', 'auth')
    const s = some(sinceLastVisit([seen, paused(t(1)), h], seen.id))
    expect(s).toMatchObject({ paused: 1, autoResumed: false, humanOpen: 1 })
    const resolved = mk('GUIDANCE', 'user', 'dev', { payload: { action: 'guidance', text: 'x', resolves: 'h1' } })
    expect(some(sinceLastVisit([seen, h, resolved], seen.id)).humanOpen).toBe(0)
  })
  it('재개로 닫힌 로그인 요청은 주의에 세지 않는다', () => {
    const h = human('h1', undefined, 'auth')
    expect(some(sinceLastVisit([seen, paused(t(1)), h, resumed(t(2))], seen.id)).humanOpen).toBe(0)
    expect(some(sinceLastVisit([seen, human('h2', 't1', 'repeat_finding'), resumed(t(2))], seen.id)).humanOpen).toBe(1)
  })
  it('unknown(첫 방문·모르는 id)과 none(새 이벤트 없음)을 구분', () => {
    expect(sinceLastVisit([seen, approve('a')], null)).toEqual({ kind: 'unknown' })
    expect(sinceLastVisit([seen, approve('a')], 'nope')).toEqual({ kind: 'unknown' })
    expect(sinceLastVisit([seen], seen.id)).toEqual({ kind: 'none' })
  })
  it('문구: 0인 항목 생략, 주의는 항상', () => {
    const s = some(sinceLastVisit(busy(), seen.id))
    const at = (ms: number) => new Date(Date.parse(seen.ts) + ms)
    expect(sinceText(s, at(2 * 3_600_000))).toBe('2시간 전부터 · 승인 3 · 반려 2 · 일시정지 1회(자동 재개됨) · 주의 0')
    const only = some(sinceLastVisit([seen, approve('a')], seen.id))
    expect(sinceText(only, at(5 * 60_000))).toBe('5분 전부터 · 승인 1 · 주의 0')
    expect(sinceText(only, at(3 * 86_400_000))).toBe('3일 전부터 · 승인 1 · 주의 0')
  })
})
