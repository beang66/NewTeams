import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RunView } from '../../src/api/useRun'
import { ControlScreen } from '../../src/screens/ControlScreen'
import { PipelineOverview } from '../../src/screens/PipelineOverview'
import { stubFetch } from '../fakes'
import { AGENTS_CLAUDE_WORKER, PLAN, assign, human, mk, reject, reviewReq, stateWith } from '../model/helpers'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

const events = [
  assign('t1'), assign('t3'), reject('t3'), reject('t3'), reject('t3', [], { from: 'harness' }),
  mk('ESCALATE', 'controller', 'master', { task: 't3' }), human('msg-9100', 't3', 'repeat_finding'), reviewReq('t2'),
]
const state = stateWith({ t1: 'merged', t2: 'review', t3: 'rejected' }, { stage: 'BUILD', humanRequired: ['msg-9100'] })
state.tasks.t3 = { status: 'rejected', round: 3 }
const RUN: RunView = {
  state, events, agents: AGENTS_CLAUDE_WORKER, connected: true, loading: false,
  plan: { ...PLAN, tasks: ['t1', 't2', 't3'].map((id) => ({ ...PLAN.tasks[0]!, id, title: id === 't3' ? '새로고침 복원' : `태스크 ${id}` })) },
}

describe('PipelineOverview', () => {
  it('표의 반려 수와 지금 위치 강조', () => {
    render(<PipelineOverview run={RUN} />)
    expect(screen.getByRole('row', { name: /t3.*3.*3/ })).toBeInTheDocument()
    expect(document.querySelector('.stp.now')).not.toBeNull()
    expect(screen.getByText(/작업 C m · 검수 G 읽기 전용/)).toBeInTheDocument()
  })
  it('세 구간과 반려 횟수, 지금 검수 중인 태스크', () => {
    render(<PipelineOverview run={RUN} />)
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(expect.arrayContaining(['요구사항에서 계획까지', '태스크마다 승인될 때까지 도는 루프', '합쳐서 다시 확인하고 마무리']))
    expect(screen.getByText(/이번 프로젝트 2회/)).toBeInTheDocument()
    expect(screen.getByText(/하네스 반려.*\(1회\)/)).toBeInTheDocument()
    expect(screen.getByText(/지금 .*t2.* 검수 중/)).toBeInTheDocument()
  })
  it('태스크 링크와 메시지 ID 링크가 콜백을 부른다', async () => {
    const onTask = vi.fn(); const onRaw = vi.fn()
    render(<PipelineOverview run={RUN} onOpenTask={onTask} onShowRaw={onRaw} />)
    await userEvent.click(within(screen.getByRole('row', { name: /t3/ })).getByRole('button', { name: /t3/ }))
    expect(onTask).toHaveBeenCalledWith('t3')
    await userEvent.click(screen.getByRole('button', { name: events[0]!.id }))
    expect(onRaw).toHaveBeenCalledWith(events[0]!.id)
  })
})

describe('관제 | 개요 전환', () => {
  it('개요를 고르면 보드가 사라지고 개요가 보이며 묻기 바는 남는다', async () => {
    stubFetch({})
    render(<ControlScreen run={RUN} />)
    expect(screen.getByLabelText('태스크 보드')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '개요' }))
    expect(screen.queryByLabelText('태스크 보드')).toBeNull()
    expect(screen.getByRole('region', { name: '파이프라인 개요' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '마스터에게 묻기' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('row', { name: /t3/ })).getByRole('button', { name: /t3/ }))
    expect(screen.getByLabelText('태스크 보드')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '파이프라인 개요' })).toBeNull()
  })
})

describe('루프 박스 상태는 태스크 상태에서 나온다', () => {
  const run = (tasks: Record<string, 'pending' | 'review' | 'merged'>, evs: RunView['events'] = []): RunView =>
    ({ ...RUN, events: evs, state: stateWith(tasks, { stage: 'BUILD' }) })
  const loopStates = () => [...document.querySelectorAll('.ov-loop .ov-row .stp')].map((e) => e.className.replace('stp ', ''))
  it('전부 대기면 아무것도 done이 아니다', () => {
    render(<PipelineOverview run={run({ t1: 'pending', t2: 'pending' })} />)
    expect(loopStates()).toEqual(['muted', 'muted', 'muted', 'muted', 'muted'])
  })
  it('검수 중 태스크가 있으면 하네스·QA·검수가 now', () => {
    render(<PipelineOverview run={run({ t1: 'review', t2: 'pending' })} />)
    expect(loopStates()).toEqual(['muted', 'now', 'now', 'now', 'muted'])
  })
  it('task 없는 HUMAN_REQUIRED는 전체로 표시', () => {
    const h = human('msg-9200', undefined, 'auth')
    render(<PipelineOverview run={{ ...run({ t1: 'pending' }, [h]), state: stateWith({ t1: 'pending' }, { stage: 'BUILD', humanRequired: ['msg-9200'] }) }} />)
    expect(screen.getByText('전체')).toBeInTheDocument()
  })
})
