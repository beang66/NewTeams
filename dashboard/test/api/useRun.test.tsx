import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { initialState } from '@orch/store/state'
import { api, ApiError } from '../../src/api/client'
import { useRun } from '../../src/api/useRun'
import { FakeEventSource, ev, stubFetch } from '../fakes'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const initial = ['msg-0001', 'msg-0002', 'msg-0003', 'msg-0004', 'msg-0005'].map((id) => ev(id))
const serverState = { ...initialState, stage: 'PLAN', lastEventId: 'msg-0005' }
const agents = { groups: [], roles: { builder: { provider: 'claude', model: 'm' } } }
const routes = () => ({
  '/api/state': [200, serverState] as [number, unknown],
  '/api/plan': [404, { error: 'plan 없음' }] as [number, unknown],
  '/api/agents': [200, agents] as [number, unknown],
  '/api/events': [200, initial] as [number, unknown],
})

describe('useRun', () => {
  it('초기 상태보다 먼저 온 이벤트는 lastEventId 이후 것만 한 번 적용', async () => {
    const es = new FakeEventSource()
    stubFetch(routes())
    const { result } = renderHook(() => useRun({ eventSourceFactory: () => es.asEventSource() }))
    act(() => {
      es.emit(ev('msg-0005', 'STATE_CHANGE', { stage: 'PLAN' }))
      es.emit(ev('msg-0006', 'STATE_CHANGE', { stage: 'BUILD' }))
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state.stage).toBe('BUILD')
    expect(result.current.events.map((e) => e.id)).toEqual([...initial.map((e) => e.id), 'msg-0006'])
    expect(result.current.plan).toBeNull()
    expect(result.current.agents?.roles.builder.model).toBe('m')
  })

  it('재연결 후 같은 id가 다시 와도 중복되지 않는다', async () => {
    const es = new FakeEventSource()
    stubFetch(routes())
    const { result } = renderHook(() => useRun({ eventSourceFactory: () => es.asEventSource() }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => es.emit(ev('msg-0007')))
    act(() => es.fail())
    expect(result.current.connected).toBe(false)
    act(() => { es.emit(ev('msg-0007')); es.emit(ev('msg-0008')) })
    expect(result.current.events.filter((e) => e.id === 'msg-0007')).toHaveLength(1)
    expect(result.current.events.at(-1)?.id).toBe('msg-0008')
    expect(result.current.connected).toBe(true)
  })

  it('stage 변경 또는 새 task가 나오면 plan만 다시 받는다', async () => {
    const es = new FakeEventSource()
    const { calls } = stubFetch(routes())
    const { result } = renderHook(() => useRun({ eventSourceFactory: () => es.asEventSource() }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const planCalls = () => calls.filter((c) => c.endsWith('/api/plan')).length
    expect(planCalls()).toBe(1)
    act(() => es.emit(ev('msg-0006', 'STATE_CHANGE', { stage: 'BUILD' })))
    await waitFor(() => expect(planCalls()).toBe(2))
    act(() => es.emit(ev('msg-0007', 'ASSIGN', {}, { task: 'T9' })))
    await waitFor(() => expect(planCalls()).toBe(3))
    act(() => es.emit(ev('msg-0008', 'ASSIGN', {}, { task: 'T9' })))
    act(() => es.emit(ev('msg-0009')))
    expect(planCalls()).toBe(3)
    expect(calls.filter((c) => c.endsWith('/api/state'))).toHaveLength(1)
  })

  it('초기 로드 실패 시 error를 설정하고 3초마다 재시도, 언마운트 시 닫는다', async () => {
    vi.useFakeTimers()
    const es = new FakeEventSource()
    let fail = true
    stubFetch({ ...routes(), '/api/state': () => (fail ? [500, { error: 'x' }] : [200, serverState]) })
    const { result, unmount } = renderHook(() => useRun({ eventSourceFactory: () => es.asEventSource() }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('서버에 연결할 수 없습니다')
    fail = false
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(result.current.error).toBeUndefined()
    expect(result.current.state.stage).toBe('PLAN')
    unmount()
    expect(es.closed).toBe(true)
  })
})

describe('api', () => {
  it('409 응답은 서버 메시지를 담은 ApiError', async () => {
    stubFetch({ 'POST /api/chat': [409, { error: 'chat은 INTAKE 단계에서만 가능' }] })
    const err = await api.chat('x').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, message: 'chat은 INTAKE 단계에서만 가능' })
  })
  it('error 필드가 없으면 HTTP <status>', async () => {
    stubFetch({ 'POST /api/resume': [500, 'boom'] })
    await expect(api.resume()).rejects.toMatchObject({ status: 500, message: 'HTTP 500' })
  })
  it('human 404는 null, 경로 조각마다 인코딩', async () => {
    const { calls } = stubFetch({})
    expect(await api.human('a b/spec.draft.md')).toBeNull()
    expect(calls[0]).toBe('GET /api/human/a%20b/spec.draft.md')
  })
  it('plan 404는 null, ask는 answer 문자열', async () => {
    stubFetch({ '/api/plan': [404, {}], 'POST /api/ask': [200, { answer: 'hi' }] })
    expect(await api.plan()).toBeNull()
    expect(await api.ask('q')).toBe('hi')
  })
})
