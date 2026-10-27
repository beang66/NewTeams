import { describe, it, expect } from 'vitest'
import { applyEvent, rebuildState, initialState } from '../../src/store/state.js'
import type { Envelope, MessageType } from '../../src/protocol/messages.js'

let n = 0
const e = (type: MessageType, extra: Partial<Envelope> = {}): Envelope =>
  ({ id: `msg-${String(++n).padStart(4, '0')}`, ts: 't', type, from: 'a', to: 'b', payload: {}, ...extra })
const assign = (task: string, round: number) => e('ASSIGN', { task, round })
const reviewReq = (task: string) => e('REVIEW_REQUEST', { task })
const reject = (task: string, round: number) => e('REJECT', { task, round })
const approve = (task: string) => e('APPROVE', { task })

describe('state reducer', () => {
  it('반려 → 승인', () => {
    const s = rebuildState([assign('t1', 1), reviewReq('t1'), reject('t1', 1), assign('t1', 2), approve('t1')])
    expect(s.tasks.t1).toMatchObject({ status: 'approved', round: 2 })
  })
  it('PAUSED/RESUMED, HUMAN_REQUIRED/GUIDANCE', () => {
    const s = rebuildState([
      e('PAUSED', { payload: { reason: 'rate_limit', until: '2026-10-26T14:20:00Z' } }),
      e('HUMAN_REQUIRED', { id: 'msg-0002' }),
      e('RESUMED'),
      e('GUIDANCE', { payload: { resolves: 'msg-0002' } }),
    ])
    expect(s.paused).toBeUndefined(); expect(s.humanRequired).toEqual([])
  })
  it('PAUSED는 reason/until 저장', () => {
    const s = applyEvent(initialState, e('PAUSED', { payload: { reason: 'x', until: 'u' } }))
    expect(s.paused).toEqual({ reason: 'x', until: 'u' })
  })
  it('STATE_CHANGE 필드들', () => {
    const s = rebuildState([
      e('STATE_CHANGE', { payload: { stage: 'BUILD', masterSessionId: 'm', apiSpendUsd: 1.5, seed: { model: 'opus', sessionId: 's1' } } }),
      e('STATE_CHANGE', { task: 't9', payload: { taskStatus: 'blocked', sessionId: 'x', worktree: '/w' } }),
    ])
    expect(s).toMatchObject({ stage: 'BUILD', masterSessionId: 'm', apiSpendUsd: 1.5, seedSessionIds: { opus: 's1' } })
    expect(s.tasks.t9).toEqual({ status: 'blocked', round: 0, sessionId: 'x', worktree: '/w' })
  })
  it('lastEventId 갱신, 순수 함수', () => {
    const before = JSON.stringify(initialState)
    const ev = e('CHAT')
    expect(applyEvent(initialState, ev).lastEventId).toBe(ev.id)
    expect(JSON.stringify(initialState)).toBe(before)
  })
  it('중복 HUMAN_REQUIRED는 한 번만, ASSIGN이 없는 task의 REJECT는 무시', () => {
    const h = e('HUMAN_REQUIRED')
    const s = rebuildState([h, h, reject('nope', 1)])
    expect(s.humanRequired).toEqual([h.id]); expect(s.tasks.nope).toBeUndefined()
  })
})
