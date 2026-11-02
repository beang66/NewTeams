import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DecisionQueue } from '../../src/components/DecisionQueue'
import type { AttentionItem } from '../../src/model/attention'
import { decisionsOf, waited } from '../../src/model/decisions'
import { pipelineIdle } from '../../src/components/PipelineControl'
import { initialState } from '@orch/store/state'

afterEach(cleanup)

const items: AttentionItem[] = [
  { kind: 'human', eventId: 'e2', task: 't2', reason: 'merge_conflict', detail: '', findings: [], tried: [], since: '2026-11-02T10:00:00Z' },
  { kind: 'login', eventId: 'e1', since: '2026-11-02T09:00:00Z' },
  { kind: 'spec', draftPath: 'spec.draft.md' },
]

describe('결정 큐', () => {
  it('스펙 승인을 맨 앞, 나머지는 오래 기다린 순서로 둔다', () => {
    expect(decisionsOf(items).map((d) => d.key)).toEqual(['spec', 'e1', 'e2'])
    const merge = decisionsOf(items).find((d) => d.key === 'e2')!
    expect(merge).toMatchObject({ title: '병합 충돌', task: 't2' })
    expect(merge.why).toContain('병합 충돌')
  })

  it('기다린 시간을 읽기 쉽게 쓴다', () => {
    const now = new Date('2026-11-02T12:00:00Z')
    expect(waited('2026-11-02T11:55:00Z', now)).toBe('5분째')
    expect(waited('2026-11-02T09:00:00Z', now)).toBe('3시간째')
    expect(waited(undefined, now)).toBe('')
  })

  it('j/k로 고르고 Enter(클릭)로 연다', () => {
    const onOpen = vi.fn()
    render(<DecisionQueue decisions={decisionsOf(items)} onOpen={onOpen} />)
    const rows = screen.getAllByRole('button')
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    fireEvent.keyDown(document, { key: 'j' })
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(rows[1]).toHaveFocus()
    fireEvent.click(rows[1]!)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'e1' }))
  })

  it('사람이 시작하지 않은 파이프라인은 시작 결정을 맨 앞에 둔다', () => {
    expect(decisionsOf([], 'not_started')[0]).toMatchObject({ key: 'start', title: '파이프라인 시작' })
    expect(decisionsOf([], 'stopped')[0]).toMatchObject({ key: 'start', title: '다시 시작' })
    expect(pipelineIdle({ ...initialState, stage: 'SPEC_APPROVED' })).toBe('not_started')
    expect(pipelineIdle({ ...initialState, stage: 'BUILD', pipeline: 'running' })).toBeUndefined()
    expect(pipelineIdle(initialState)).toBeUndefined() // INTAKE
  })

  it('할 일이 없으면 한 줄로 알린다', () => {
    render(<DecisionQueue decisions={[]} onOpen={() => undefined} />)
    expect(screen.getByText(/결정할 일이 없습니다/)).toBeInTheDocument()
  })
})
