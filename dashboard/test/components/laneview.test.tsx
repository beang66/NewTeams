import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Envelope } from '@orch/protocol/messages'
import { LaneView } from '../../src/components/LaneView'
import { TimelineList } from '../../src/components/TimelineList'
import { AGENTS_CLAUDE_WORKER, assign, paused, reject, resumed, stateWith, t } from '../model/helpers'

const S = stateWith({ t1: 'running' })
const A = AGENTS_CLAUDE_WORKER
const BASE = Date.parse('2026-10-27T00:00:00Z')

/** n events 1초 간격 (지시/보고 번갈아). */
function manyEvents(n: number): Envelope[] {
  return Array.from({ length: n }, (_, i) => {
    const even = i % 2 === 0
    return {
      id: `msg-${String(i + 1).padStart(4, '0')}`, ts: new Date(BASE + i * 1000).toISOString(),
      type: even ? 'ASSIGN' : 'REPORT', from: even ? 'controller' : 'dev', to: even ? 'dev' : 'reviewer', task: 't1', payload: {},
    } satisfies Envelope
  })
}
afterEach(cleanup)

describe('LaneView', () => {
  it('창 밖 화살표는 DOM에 없다', () => { // Review Focus 4
    const events = manyEvents(3000)
    render(<LaneView events={events} state={S} agents={A} windowMs={60_000} follow onSelectEvent={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /→/ }).length).toBeLessThanOrEqual(61)
  })
  it('화살표를 Enter로 선택', async () => {
    const on = vi.fn(); render(<LaneView events={[assign('t1', { id: 'msg-0001' })]} state={S} agents={A} onSelectEvent={on} />)
    screen.getByRole('button', { name: /지시 msg-0001/ }).focus(); await userEvent.keyboard('{Enter}'); expect(on).toHaveBeenCalledWith('msg-0001')
  })
  it('화살표 aria-label은 발신 → 수신: 종류 id', () => {
    render(<LaneView events={[assign('t1', { id: 'msg-0001' })]} state={S} agents={A} onSelectEvent={vi.fn()} />)
    expect(screen.getByRole('button', { name: '시스템 → 개발 t1: 지시 msg-0001' })).toBeInTheDocument()
  })
  it('반려 화살표는 bad 톤 클래스', () => {
    render(<LaneView events={[reject('t1')]} state={S} agents={A} onSelectEvent={vi.fn()} />)
    expect(screen.getByRole('button', { name: /반려/ })).toHaveClass('tone-bad')
  })
  it('일시정지 구간 빗금', () => {
    const { container } = render(<LaneView events={[paused(t(1)), resumed(t(5))]} state={S} agents={A} onSelectEvent={vi.fn()} />)
    expect(container.querySelector('rect.paused-span')).not.toBeNull()
  })
  it('완료 레인 접기', async () => {
    render(<LaneView events={[assign('t1')]} state={stateWith({ t1: 'approved' })} agents={A} onSelectEvent={vi.fn()} />)
    expect(screen.getAllByText('완료 · 접힘').length).toBeGreaterThan(0)
    const toggle = screen.getByRole('button', { name: '완료 레인 접기' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('완료 · 접힘')).toBeNull()
  })
  it('레인 머리에 C/G 배지와 상태 칩', () => {
    const { container } = render(<LaneView events={[assign('t1')]} state={S} agents={A} onSelectEvent={vi.fn()} />)
    const head = container.querySelector('[data-lane="reviewer"]') as HTMLElement
    expect(within(head).getByText('G')).toBeInTheDocument()
    const dev = container.querySelector('[data-lane="dev:t1"]') as HTMLElement
    expect(within(dev).getByText('C')).toBeInTheDocument()
    expect(within(dev).getByText('실행 중')).toHaveClass('is-accent')
  })
  it('확대 3단계 버튼, 누르면 따라가기가 꺼지고 토글로 다시 켠다', async () => {
    render(<LaneView events={manyEvents(10)} state={S} agents={A} onSelectEvent={vi.fn()} />)
    const group = screen.getByRole('group', { name: '시간 창' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['5분', '1시간', '전체'])
    expect(within(group).getByRole('button', { name: '5분' })).toHaveAttribute('aria-pressed', 'true')
    const follow = screen.getByRole('button', { name: '실시간 따라가기' })
    expect(follow).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(group).getByRole('button', { name: '1시간' }))
    expect(within(group).getByRole('button', { name: '1시간' })).toHaveAttribute('aria-pressed', 'true')
    expect(follow).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(follow)
    expect(follow).toHaveAttribute('aria-pressed', 'true')
  })
  it('가로 스크롤하면 따라가기가 꺼지고 창이 과거로 이동', () => {
    const events = manyEvents(600)
    const { container } = render(<LaneView events={events} state={S} agents={A} windowMs={60_000} width={800} onSelectEvent={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /msg-0001$/ })).toBeNull()
    fireEvent.wheel(container.querySelector('svg')!, { deltaX: -3000 })
    expect(screen.getByRole('button', { name: '실시간 따라가기' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: /msg-0600$/ })).toBeNull()
  })
  it('전체 보기는 모든 화살표를 그린다', async () => {
    render(<LaneView events={manyEvents(400)} state={S} agents={A} windowMs={60_000} onSelectEvent={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '전체' }))
    expect(screen.getAllByRole('button', { name: /→/ }).length).toBe(400)
  })
  it('highlightIds의 화살표는 is-highlight, 선택된 화살표는 is-selected', () => {
    const events = manyEvents(4)
    render(<LaneView events={events} state={S} agents={A} highlightIds={['msg-0003', 'msg-0004']} selectedId="msg-0002" onSelectEvent={vi.fn()} />)
    expect(screen.getByRole('button', { name: /msg-0003$/ })).toHaveClass('is-highlight')
    expect(screen.getByRole('button', { name: /msg-0001$/ })).not.toHaveClass('is-highlight')
    expect(screen.getByRole('button', { name: /msg-0002$/ })).toHaveClass('is-selected')
  })
  it('화살표 클릭 → onSelectEvent', async () => {
    const on = vi.fn(); render(<LaneView events={manyEvents(2)} state={S} agents={A} onSelectEvent={on} />)
    await userEvent.click(screen.getByRole('button', { name: /msg-0002$/ }))
    expect(on).toHaveBeenCalledWith('msg-0002')
  })
})

describe('TimelineList', () => {
  it('TimelineList는 최신이 아래, 가상 스크롤로 일부만 렌더', () => {
    render(<TimelineList events={manyEvents(3000)} onSelectEvent={vi.fn()} />)
    const list = screen.getByRole('list', { name: '이벤트 목록' })
    const items = within(list).getAllByRole('listitem')
    expect(items.length).toBeLessThan(100)
    expect(items.length).toBeGreaterThan(0)
    expect(items.at(-1)).toHaveTextContent('msg-3000')
  })
  it('항목을 누르면 onSelectEvent(id), 선택 항목은 aria-pressed', async () => {
    const on = vi.fn(); render(<TimelineList events={manyEvents(3)} selectedId="msg-0002" onSelectEvent={on} />)
    expect(screen.getByRole('button', { name: /msg-0002/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /msg-0003/ }))
    expect(on).toHaveBeenCalledWith('msg-0003')
  })
})
