import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { initialState } from '@orch/store/state'
import { api, ApiError, type LibraryItem, type Routine } from '../../src/api/client'
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
  const item: LibraryItem = { file: '보조-로고.md', title: '보조 로고', kind: '로고', status: '사용 중', tags: [], body: '# 보조 로고\n흰 배경용', updated: '2026-11-02T00:00:00Z', mtimeMs: 10 }

  it('브랜드 라이브러리: Vault 목록, 카드 링크, 사이드바 탭, localStorage 이전', async () => {
    localStorage.setItem('newteams.workspace.brand', JSON.stringify([{ title: '옛 항목', type: '로고', note: 'n', status: '사용 중' }]))
    const create = vi.spyOn(api, 'createLibraryItem').mockResolvedValue(item)
    vi.spyOn(api, 'library').mockResolvedValue([item])
    render(<WorkspaceScreen path="/brand" run={run} />)
    expect(screen.getByRole('heading', { name: '브랜드 라이브러리' })).toBeInTheDocument()
    const card = await screen.findByRole('listitem', { name: '보조 로고 열기' })
    expect(card).toHaveAttribute('href', `#/brand/${encodeURIComponent('보조-로고.md')}`)
    expect(create).toHaveBeenCalledWith('brand', expect.objectContaining({ title: '옛 항목', kind: '로고', body: 'n' }))
    expect(localStorage.getItem('newteams.workspace.brand')).toBeNull()
    const nav = screen.getByRole('navigation', { name: '다른 대시보드' })
    expect(within(nav).getByRole('link', { name: '브랜드 라이브러리' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: '아이디어 패드' })).toHaveAttribute('href', '#/ideas')
  })

  it('상세 페이지에서 전체 내용을 읽고 수정한다', async () => {
    vi.spyOn(api, 'libraryItem').mockResolvedValue(item)
    const update = vi.spyOn(api, 'updateLibraryItem').mockResolvedValue({ ...item, title: '보조 로고 v2', mtimeMs: 20 })
    render(<WorkspaceScreen path={`/brand/${encodeURIComponent('보조-로고.md')}`} run={run} />)
    expect(await screen.findByText('흰 배경용')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '보조 로고 v2' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '보조 로고 v2' })).toBeInTheDocument())
    expect(update).toHaveBeenCalledWith('brand', '보조-로고.md', expect.objectContaining({ title: '보조 로고 v2', mtimeMs: 10 }))
  })

  it('최근 산출물 상세 페이지는 실행 결과 전체를 보여 준다', async () => {
    vi.spyOn(api, 'skillRuns').mockResolvedValue([{ id: 'r1', skill: 'writer', input: '주간 로그 써 줘', model: '기본 모델', effort: '기본', status: 'done', startedAt: '2026-11-02T01:00:00Z', text: '## 완료\n세 가지', files: ['log.md'] }])
    render(<WorkspaceScreen path="/outputs/r1" run={run} />)
    expect(await screen.findByRole('heading', { name: '주간 로그 써 줘' })).toBeInTheDocument()
    expect(screen.getByText('세 가지')).toBeInTheDocument()
    expect(screen.getByText(/log\.md/)).toBeInTheDocument()
  })

  it('수정 충돌(409)이면 다시 불러오기를 안내한다', async () => {
    vi.spyOn(api, 'libraryItem').mockResolvedValue(item)
    vi.spyOn(api, 'updateLibraryItem').mockRejectedValue(new ApiError(409, '다른 곳에서 바뀐 노트입니다.'))
    render(<WorkspaceScreen path="/brand/x.md" run={run} />)
    fireEvent.click(await screen.findByRole('button', { name: '수정' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('button', { name: '다시 불러오기' })).toBeInTheDocument()
  })
})
