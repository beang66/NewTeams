import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Envelope } from '@orch/protocol/messages'
import { initialState } from '@orch/store/state'
import type { RunView } from '../../src/api/useRun'
import { ControlScreen } from '../../src/screens/ControlScreen'
import { stubFetch } from '../fakes'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

const BASE = Date.parse('2026-10-27T00:00:00Z')
const events: Envelope[] = [1, 2, 3].map((n) => ({
  id: `msg-000${n}`, ts: new Date(BASE + n * 1000).toISOString(), type: 'ASSIGN', from: 'controller', to: 'dev', task: 't1', payload: {},
}))
const run: RunView = {
  state: { ...initialState, stage: 'BUILD', tasks: { t1: { status: 'running', round: 1 } } },
  events, plan: null, agents: null, connected: true, loading: false,
}
const stubMedia = (matches: boolean) => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })))

describe('ControlScreen 레인 영역', () => {
  it('넓은 화면은 레인, 768px 이하는 시간순 목록', () => {
    stubFetch({}); stubMedia(false)
    const { unmount } = render(<ControlScreen run={run} />)
    expect(screen.getByRole('group', { name: '실시간 레인' })).toBeInTheDocument()
    unmount()
    stubMedia(true)
    render(<ControlScreen run={run} />)
    expect(screen.getByRole('list', { name: '이벤트 목록' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '실시간 레인' })).toBeNull()
  })
  it('SinceBar 요약을 누르면 그 이벤트들의 화살표가 강조된다 (바 닫힘이 ids를 삼키지 않음)', async () => {
    stubFetch({}); stubMedia(false)
    localStorage.setItem(`orch.lastSeen.${events[0]!.id}.${events[0]!.ts}`, 'msg-0001')
    render(<ControlScreen run={run} />)
    await userEvent.click(screen.getByRole('button', { name: /전부터/ }))
    expect(screen.getByRole('button', { name: /msg-0002$/ })).toHaveClass('is-highlight')
    expect(screen.getByRole('button', { name: /msg-0003$/ })).toHaveClass('is-highlight')
    expect(screen.getByRole('button', { name: /msg-0001$/ })).not.toHaveClass('is-highlight')
  })
  it('화살표를 누르면 선택 상태가 ControlScreen에 올라간다', async () => {
    stubFetch({}); stubMedia(false)
    render(<ControlScreen run={run} />)
    await userEvent.click(screen.getByRole('button', { name: /msg-0002$/ }))
    expect(screen.getByRole('button', { name: /msg-0002$/ })).toHaveClass('is-selected')
  })
})
