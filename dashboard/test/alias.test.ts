import { it, expect } from 'vitest'

it('@orch 별칭으로 오케스트레이터 리듀서를 가져온다', async () => {
  const { applyEvent, initialState } = await import('@orch/store/state')
  expect(applyEvent(initialState, { id: 'msg-0001', ts: '2026-10-27T00:00:00Z', type: 'STATE_CHANGE', from: 'controller', to: 'all', payload: { stage: 'BUILD' } }).stage).toBe('BUILD')
})
