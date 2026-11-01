import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Envelope } from '@orch/protocol/messages'
import { initialState } from '@orch/store/state'
import { api, ApiError } from '../../src/api/client'
import type { RunView } from '../../src/api/useRun'
import { App } from '../../src/App'
import { AskBar } from '../../src/components/AskBar'
import { DoneScreen } from '../../src/screens/DoneScreen'
import { IntakeScreen } from '../../src/screens/IntakeScreen'
import { ev } from '../fakes'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const mk = (stage: RunView['state']['stage'], events: Envelope[] = [], extra: Partial<RunView> = {}): RunView => ({
  state: { ...initialState, stage }, events, plan: null, agents: null, connected: true, loading: false, ...extra,
})
const intakeRun = (events: Envelope[]) => mk('INTAKE', events)
const doneRun = mk('DONE', [
  ev('msg-0001', 'ASSIGN', {}, { task: 't1' }), ev('msg-0002', 'REJECT', {}, { task: 't1' }), ev('msg-0003', 'APPROVE', {}, { task: 't1' }),
], { state: { ...initialState, stage: 'DONE', tasks: { t1: { status: 'merged', round: 2 } }, apiSpendUsd: 0.5 } })

describe('IntakeScreen', () => {
  it('빈 상태 문구', () => {
    render(<IntakeScreen run={intakeRun([])} draft={null} />)
    expect(screen.getByText('만들고 싶은 것을 마스터에게 설명해 주세요. 대화가 끝나면 오른쪽에 스펙 초안이 채워집니다.')).toBeInTheDocument()
  })
  it('초안이 없으면 스펙 승인 비활성', () => {
    render(<IntakeScreen run={intakeRun([])} draft={null} />)
    expect(screen.getByRole('button', { name: '스펙 승인' })).toBeDisabled()
  })
  it('초안이 있으면 스펙 승인 활성, 승인 → api.approveSpec', async () => {
    const approve = vi.spyOn(api, 'approveSpec').mockResolvedValue()
    render(<IntakeScreen run={intakeRun([])} draft={'# 스펙'} />)
    await userEvent.click(screen.getByRole('button', { name: '스펙 승인' }))
    expect(approve).toHaveBeenCalledTimes(1)
  })
  it('대화 전송 → api.chat, 응답에 specDraft 있으면 초안 다시 불러옴', async () => {
    const chat = vi.spyOn(api, 'chat').mockResolvedValue({ reply: '정리했습니다', specDraft: 'spec.draft.md' })
    const human = vi.spyOn(api, 'human').mockResolvedValue('# 새 초안')
    render(<IntakeScreen run={intakeRun([])} draft={null} />)
    await userEvent.type(screen.getByRole('textbox', { name: '마스터에게 보내기' }), '앱을 만들어 줘{Enter}')
    expect(chat).toHaveBeenCalledWith('앱을 만들어 줘')
    expect(await screen.findByRole('heading', { name: '새 초안' })).toBeInTheDocument()
    expect(human).toHaveBeenCalledWith('spec.draft.md')
    expect(screen.getByRole('button', { name: '스펙 승인' })).toBeEnabled()
  })
  it('Shift+Enter는 줄바꿈, Enter는 전송', async () => {
    const chat = vi.spyOn(api, 'chat').mockResolvedValue({ reply: 'ok' })
    render(<IntakeScreen run={intakeRun([])} draft={null} />)
    const box = screen.getByRole('textbox', { name: '마스터에게 보내기' })
    await userEvent.type(box, '가{Shift>}{Enter}{/Shift}나')
    expect(chat).not.toHaveBeenCalled()
    expect(box).toHaveValue('가\n나')
    await userEvent.type(box, '{Enter}')
    expect(chat).toHaveBeenCalledWith('가\n나')
  })
  it('CHAT 이벤트를 대화로 보여 준다', () => {
    render(<IntakeScreen run={intakeRun([ev('msg-0001', 'CHAT', { text: '안녕하세요' }, { from: 'user' })])} draft={null} />)
    expect(screen.getByText('안녕하세요')).toBeInTheDocument()
  })
})

describe('DoneScreen / App', () => {
  it('DONE이면 보고서 화면', async () => {
    vi.spyOn(api, 'human').mockResolvedValue('# 최종 평가\n완료')
    render(<App runOverride={doneRun} />)
    expect(await screen.findByRole('heading', { name: '최종 평가' })).toBeInTheDocument()
  })
  it('오른쪽 열은 실행 상태에서 계산한다 (태스크·반려·API 지출)', async () => {
    vi.spyOn(api, 'human').mockResolvedValue('# 보고')
    render(<DoneScreen run={doneRun} />)
    await screen.findByRole('heading', { name: '보고' })
    expect(screen.getByRole('row', { name: /태스크 1/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /반려 1/ })).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: '숫자로 보기' })).getByText('$0.50 / $8')).toBeInTheDocument()
  })
  it('Markdown 내려받기는 report.md 내용으로 Blob을 만든다', async () => {
    const report = '# 최종 평가\n본문'
    vi.spyOn(api, 'human').mockResolvedValue(report)
    const create = vi.fn(() => 'blob:x'); const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<DoneScreen run={doneRun} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Markdown 내려받기' }))
    const blob = (create.mock.calls[0] as unknown as [Blob])[0]
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    expect(await blob.text()).toBe(report)
    expect(click).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
  it('관제 화면 보기 토글', async () => {
    vi.spyOn(api, 'human').mockResolvedValue('# 보고')
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    render(<DoneScreen run={doneRun} />)
    await userEvent.click(await screen.findByRole('button', { name: '관제 화면 보기' }))
    expect(screen.getByRole('region', { name: '레인' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '보고서 보기' }))
    expect(await screen.findByRole('heading', { name: '보고' })).toBeInTheDocument()
  })
  it('로딩 중 스켈레톤', () => {
    render(<App runOverride={{ ...doneRun, loading: true }} />)
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
  })
  it('INTAKE 중 초안을 불러와 스펙 승인을 켠다', async () => {
    vi.spyOn(api, 'human').mockResolvedValue('# 초안')
    render(<App runOverride={intakeRun([])} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '스펙 승인' })).toBeEnabled())
    expect(screen.getByRole('button', { name: '주의 1' })).toBeInTheDocument()
  })
})

describe('AskBar', () => {
  it('묻기 → 답변 표시, 사용량 안내', async () => {
    const ask = vi.spyOn(api, 'ask').mockResolvedValue('msg-0023에서 권한 문제로 멈췄습니다')
    render(<AskBar events={[]} />)
    expect(screen.getByText('사용량을 씁니다')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '마스터에게 묻기' }), 't3이 왜 멈췄지?{Enter}')
    expect(ask).toHaveBeenCalledWith('t3이 왜 멈췄지?')
    expect(await screen.findByText('msg-0023에서 권한 문제로 멈췄습니다')).toBeInTheDocument()
  })
  it('요청 중에는 입력이 비활성', async () => {
    let done!: (v: string) => void
    vi.spyOn(api, 'ask').mockReturnValue(new Promise((r) => { done = r }))
    render(<AskBar events={[]} />)
    await userEvent.type(screen.getByRole('textbox', { name: '마스터에게 묻기' }), '질문{Enter}')
    expect(screen.getByRole('textbox', { name: '마스터에게 묻기' })).toBeDisabled()
    done('답')
    expect(await screen.findByText('답')).toBeInTheDocument()
  })
  it('답변의 원본 링크는 onRawLink', async () => {
    vi.spyOn(api, 'ask').mockResolvedValue('[근거](raw/events.jsonl#msg-0009)')
    const onRaw = vi.fn()
    render(<AskBar events={[]} onRawLink={onRaw} />)
    await userEvent.type(screen.getByRole('textbox', { name: '마스터에게 묻기' }), 'q{Enter}')
    await userEvent.click(await screen.findByRole('link', { name: '근거' }))
    expect(onRaw).toHaveBeenCalledWith('msg-0009')
  })
  it('최근 이벤트 한 줄', () => {
    render(<AskBar events={[ev('msg-0004', 'CHAT', {}, { from: '마스터', to: '나' })]} />)
    expect(screen.getByText(/msg-0004 · 마스터 → 나 · 대화/)).toBeInTheDocument()
  })
})

it('paper 토큰은 흰 종이 · 검정 글자 · 회색 · #2779a7만 쓴다', () => {
  const css = readFileSync('src/styles/paper.css', 'utf8')
  for (const [k, v] of Object.entries({ '--p-bg': '#ffffff', '--p-sheet': '#ffffff', '--p-ink': '#000000', '--p-rule': '#000000', '--p-ok': '#2779a7', '--p-bad': '#000000', '--p-warn': '#000000', '--p-now': '#2779a7' }))
    expect(css).toMatch(new RegExp(`${k}:\\s*${v}\\s*;`, 'i'))
})
it('@media print에서 상단 바·묻기·SinceBar·패널·보드를 숨긴다', () => {
  const css = readFileSync('src/styles/screens.css', 'utf8')
  const block = css.slice(css.indexOf('@media print'))
  const rule = block.split('\n').find((l) => /display:\s*none/.test(l)) ?? ''
  for (const sel of ['.topbar', '.askbar', '.since-bar', '.panel', '.board']) expect(rule).toContain(sel)
})

describe('수정 라운드', () => {
  const splitRun = mk('DONE', [
    ev('msg-0001', 'REJECT', {}, { task: 't1', from: 'harness' }), ev('msg-0002', 'REJECT', {}, { task: 't1', from: 'reviewer' }),
    ev('msg-0003', 'REJECT', {}, { task: 't1', from: 'reviewer' }),
  ], { state: { ...initialState, stage: 'DONE', tasks: { t1: { status: 'merged', round: 3 } } } })
  it('반려를 하네스/리뷰어로 나눠 센다', async () => {
    vi.spyOn(api, 'human').mockResolvedValue('# 보고')
    render(<DoneScreen run={splitRun} />)
    await screen.findByRole('heading', { name: '보고' })
    expect(screen.getByRole('row', { name: /하네스 반려 1/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /리뷰어 반려 2/ })).toBeInTheDocument()
    expect(screen.getByText(/하네스 1 · 리뷰어 2/)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '캐시 토큰' })).toBeInTheDocument()
  })
  it('문서 링크는 있는 파일만, 없으면 없음', async () => {
    vi.spyOn(api, 'human').mockImplementation(async (p) => (p === 'spec.md' || p === 'report.md' ? '# x' : null))
    render(<DoneScreen run={doneRun} />)
    expect(await screen.findByRole('link', { name: 'spec.md' })).toHaveAttribute('href', '/api/human/spec.md')
    expect(await screen.findByText('plan.md 없음')).toBeInTheDocument()
    expect(screen.getByText('wiki/backlog.md 없음')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'wiki/backlog.md' })).toBeNull()
  })
  it('IME 조합 중 Enter는 전송하지 않는다', () => {
    const chat = vi.spyOn(api, 'chat').mockResolvedValue({ reply: 'ok' })
    render(<IntakeScreen run={intakeRun([])} draft={null} />)
    const box = screen.getByRole('textbox', { name: '마스터에게 보내기' })
    fireEvent.change(box, { target: { value: '안녕' } })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
    expect(chat).not.toHaveBeenCalled()
  })
  it('승인 409는 서버 메시지를 보여 준다', async () => {
    vi.spyOn(api, 'approveSpec').mockRejectedValue(new ApiError(409, '이미 승인된 스펙입니다'))
    render(<IntakeScreen run={intakeRun([])} draft={'# 스펙'} />)
    await userEvent.click(screen.getByRole('button', { name: '스펙 승인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 승인된 스펙입니다')
  })
  it('전송 후에도 입력창에 포커스가 남는다', async () => {
    vi.spyOn(api, 'chat').mockResolvedValue({ reply: 'ok' })
    render(<IntakeScreen run={intakeRun([])} draft={null} />)
    const box = screen.getByRole('textbox', { name: '마스터에게 보내기' })
    await userEvent.type(box, '안녕{Enter}')
    await waitFor(() => expect(box).toHaveValue(''))
    expect(box).toHaveFocus()
  })
  it('stage가 바뀌면 INTAKE에서 관제 화면으로 넘어간다', async () => {
    vi.spyOn(api, 'human').mockResolvedValue(null)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const { rerender } = render(<App runOverride={intakeRun([])} />)
    expect(screen.getByRole('button', { name: '스펙 승인' })).toBeInTheDocument()
    rerender(<App runOverride={mk('BUILD')} />)
    expect(await screen.findByRole('region', { name: '레인' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '스펙 승인' })).toBeNull()
  })
})
