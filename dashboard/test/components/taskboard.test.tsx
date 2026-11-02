import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plan } from '@orch/protocol/plan'
import { initialState, type RunState, type TaskStatus } from '@orch/store/state'
import { TaskBoard } from '../../src/components/TaskBoard'
import { PLAN } from '../model/helpers'

type Spec = TaskStatus | [TaskStatus, number]
function stateWith(tasks: Record<string, Spec>): RunState {
  return {
    ...initialState,
    tasks: Object.fromEntries(Object.entries(tasks).map(([k, v]) => [k, { status: Array.isArray(v) ? v[0] : v, round: Array.isArray(v) ? v[1] : 1 }])),
  }
}
const planWithTitle = (id: string, title: string): Plan => ({ ...PLAN, tasks: PLAN.tasks.map((t) => (t.id === id ? { ...t, title } : t)) })
afterEach(cleanup)
const S = stateWith({ a: 'running', b: 'pending' })

describe('TaskBoard', () => {
  it('그룹 머리에 개수, 반려 태스크에 회차 rN/상한', () => {
    render(<TaskBoard state={stateWith({ a: ['rejected', 3] })} plan={PLAN} onSelect={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '반려 1' })).toBeInTheDocument(); expect(screen.getByText('r3/3')).toBeInTheDocument()
  })
  it('긴 한글 제목은 말줄임 + title에 전체 문구', () => {
    const long = '사용자가 할 일을 추가하고 완료 표시를 한 뒤 새로고침해도 목록이 그대로 복원되는지 확인하는 기능 구현'.repeat(2)
    render(<TaskBoard state={stateWith({ a: 'running' })} plan={planWithTitle('a', long)} onSelect={vi.fn()} />)
    expect(screen.getByTitle(long)).toHaveClass('truncate')
  })
  it('클릭하면 onSelect(taskId), 선택된 항목은 aria-pressed', () => {
    const onSelect = vi.fn(); render(<TaskBoard state={S} plan={PLAN} selectedTask="a" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /^b\b/ })); expect(onSelect).toHaveBeenCalledWith('b')
    expect(screen.getByRole('button', { name: /^a\b/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('계획이 없으면 안내 문구', () => {
    render(<TaskBoard state={initialState} plan={null} onSelect={vi.fn()} />)
    expect(screen.getByText('기획이 끝나면 태스크가 여기에 나타납니다')).toBeInTheDocument()
  })
  it('상태별 칩 문구', () => {
    render(<TaskBoard state={stateWith({ a: 'review', b: 'merged', c: 'approved', d: 'blocked' })} plan={PLAN} onSelect={vi.fn()} />)
    for (const c of ['검수', '병합', '승인', '건너뜀']) expect(screen.getAllByText(c).length).toBeGreaterThan(0)
  })
})
