import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { initialState } from '@orch/store/state'
import { api, type Routine } from '../../src/api/client'
import type { RunView } from '../../src/api/useRun'
import { RoutinesCard } from '../../src/components/RoutinesCard'
import { SkillsCard } from '../../src/components/SkillsCard'
import { WorkspaceScreen } from '../../src/screens/WorkspaceScreen'

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

describe('스킬 실행 상세', () => {
  it('기록을 선택해 열고 닫을 수 있다', async () => {
    vi.spyOn(api, 'skills').mockResolvedValue([{ name: 'writer', desc: '글 작성', source: 'user' }])
    vi.spyOn(api, 'pinnedSkills').mockResolvedValue(['writer'])
    vi.spyOn(api, 'skillRuns').mockResolvedValue([{ id: 'run-1', skill: 'writer', input: '', model: '기본 모델', effort: '기본', status: 'done', startedAt: '2026-11-02T01:00:00Z', text: '완료 결과' }])
    render(<SkillsCard />)
    expect(await screen.findByText('실행 기록 1건')).toBeInTheDocument()
    expect(screen.queryByText('완료 결과')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /writer.*완료/ }))
    expect(screen.getByText('완료 결과')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByText('완료 결과')).toBeNull()
  })
})

describe('루틴 편집', () => {
  const routine: Routine = { id: 'routine-1', name: '아침 글', skill: 'writer', input: '써줘', model: '기본 모델', effort: '기본', enabled: true, schedule: { kind: 'daily', time: '07:30' }, createdAt: '2026-11-01T00:00:00Z' }

  it('새 루틴은 선택 없음에서 시작하고 취소할 수 있다', async () => {
    vi.spyOn(api, 'routines').mockResolvedValue([])
    vi.spyOn(api, 'skills').mockResolvedValue([{ name: 'writer', desc: '글 작성', source: 'user' }])
    render(<RoutinesCard />)
    fireEvent.click(await screen.findByRole('button', { name: '+ 루틴' }))
    const select = screen.getByLabelText('실행할 스킬')
    expect(select).toHaveValue('')
    expect(screen.getByRole('option', { name: '선택 없음' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByLabelText('실행할 스킬')).toBeNull()
  })

  it('생성된 루틴에 끄기·고치기·삭제가 있다', async () => {
    vi.spyOn(api, 'routines').mockResolvedValue([routine])
    vi.spyOn(api, 'skills').mockResolvedValue([{ name: 'writer', desc: '글 작성', source: 'user' }])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<RoutinesCard />)
    expect(await screen.findByText('아침 글')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '끄기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '고치기' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(window.confirm).toHaveBeenCalled()
  })
})

describe('확장 대시보드', () => {
  const run: RunView = { state: initialState, events: [], plan: null, agents: null, connected: true, loading: false }
  it('브랜드 라이브러리에서 항목을 추가한다', async () => {
    render(<WorkspaceScreen path="/brand" run={run} />)
    expect(screen.getByRole('heading', { name: '브랜드 라이브러리' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ 브랜드 항목' }))
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '보조 로고' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByText('보조 로고')).toBeInTheDocument())
    const card = screen.getByText('보조 로고').closest('article')!
    fireEvent.click(within(card).getByRole('button', { name: '수정' }))
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '보조 로고 v2' } })
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }))
    expect(screen.getByText('보조 로고 v2')).toBeInTheDocument()
  })
})
