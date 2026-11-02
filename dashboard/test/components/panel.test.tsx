import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { initialState } from '@orch/store/state'
import type { Plan } from '@orch/protocol/plan'
import { api, ApiError } from '../../src/api/client'
import type { RunView } from '../../src/api/useRun'
import type { AttentionItem } from '../../src/model/attention'
import { AttentionTab } from '../../src/components/AttentionTab'
import { Markdown } from '../../src/components/Markdown'
import { RightPanel } from '../../src/components/RightPanel'
import { stateWith, mk, human } from '../model/helpers'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

type HumanItem = Extract<AttentionItem, { kind: 'human' }>
const HUMAN_ITEM: HumanItem = {
  kind: 'human', eventId: 'msg-0010', task: 't1', reason: 'repeat_finding', detail: '',
  findings: [{ id: 'F-1', severity: 'major', issue: '매우긴문구'.repeat(40) }], tried: ['먼저 시도한 지침'], since: '2026-11-02T00:00:00Z',
}
const LOGIN_ITEM: AttentionItem = { kind: 'login', eventId: 'msg-0020', since: '2026-11-02T00:00:00Z' }
const planOf = (deps: Record<string, string[]>): Plan => ({
  tasks: Object.entries(deps).map(([id, d]) => ({ id, title: id, deps: d, ownedFiles: [], difficulty: 'low' as const, acceptance: [], qaScenarios: [] })),
  testCommands: [], devCommand: '',
})

describe('Markdown', () => {
  it('Markdown의 HTML은 실행되지 않는다', () => {
    const { container } = render(<Markdown source={'# 제목\n<script>window.__x=1</script><img src=x onerror="window.__y=1">'} />)
    expect(container.querySelector('script, img[onerror]')).toBeNull()
    expect((window as unknown as { __x?: number }).__x).toBeUndefined()
  })
  it('원본 링크 클릭 → 이벤트 선택', async () => {
    const onSelect = vi.fn()
    render(<Markdown source="[원본](../raw/events.jsonl#msg-0042)" onRawLink={onSelect} />)
    await userEvent.click(screen.getByRole('link', { name: '원본' }))
    expect(onSelect).toHaveBeenCalledWith('msg-0042')
  })
  it('javascript: 링크와 이미지는 무력화된다', () => {
    const { container } = render(<Markdown source={'[x](javascript:alert(1)) ![i](http://evil.test/a.png)'} />)
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })
  it('외부 링크는 rel=noreferrer, ../ 없는 raw/ 링크도 인식', async () => {
    const onSelect = vi.fn()
    render(<Markdown source={'[밖](https://example.com) [안](raw/events.jsonl#msg-0007)'} onRawLink={onSelect} />)
    expect(screen.getByRole('link', { name: '밖' })).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    await userEvent.click(screen.getByRole('link', { name: '안' }))
    expect(onSelect).toHaveBeenCalledWith('msg-0007')
  })
})

describe('AttentionTab', () => {
  it('교착 카드: 지침 보내기 → POST human {action:guidance, text, restartSession:false}', async () => {
    const answer = vi.spyOn(api, 'answer').mockResolvedValue()
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.type(screen.getByRole('textbox', { name: '지침' }), '입력 검증은 서버에서')
    await userEvent.click(screen.getByRole('button', { name: '지침 보내기' }))
    expect(answer).toHaveBeenCalledWith('msg-0010', { action: 'guidance', text: '입력 검증은 서버에서', restartSession: false })
  })
  it('새 세션 체크박스 → restartSession:true', async () => {
    const answer = vi.spyOn(api, 'answer').mockResolvedValue()
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.type(screen.getByRole('textbox', { name: '지침' }), 'x')
    await userEvent.click(screen.getByRole('checkbox', { name: '새 세션으로 다시 시작' }))
    await userEvent.click(screen.getByRole('button', { name: '지침 보내기' }))
    expect(answer).toHaveBeenCalledWith('msg-0010', { action: 'guidance', text: 'x', restartSession: true })
  })
  it('카드에 지적과 시도한 지침이 보인다', () => {
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    expect(screen.getByText('F-1')).toBeInTheDocument()
    expect(screen.getByText('먼저 시도한 지침')).toBeInTheDocument()
  })
  it('건너뛰기는 두 번 눌러야 전송', async () => {
    const answer = vi.spyOn(api, 'answer').mockResolvedValue()
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.click(screen.getByRole('button', { name: '이 태스크 건너뛰기' }))
    expect(answer).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /정말 건너뛸까요/ }))
    expect(answer).toHaveBeenCalledWith('msg-0010', { action: 'skip', text: '', restartSession: false })
  })
  it('건너뛰기 확인 문구에 의존 태스크 개수(전이, 완료·건너뜀 제외)', async () => {
    const plan = planOf({ t1: [], t2: ['t1'], t3: ['t2'], t4: ['t1'], t5: ['t1'], t6: [] })
    const state = stateWith({ t1: 'rejected', t2: 'pending', t3: 'pending', t4: 'approved', t5: 'blocked', t6: 'pending' })
    render(<AttentionTab items={[HUMAN_ITEM]} plan={plan} state={state} />)
    await userEvent.click(screen.getByRole('button', { name: '이 태스크 건너뛰기' }))
    expect(screen.getByRole('button', { name: '정말 건너뛸까요? 이 태스크에 의존하는 2개 태스크도 함께 건너뜁니다' })).toBeInTheDocument()
  })
  it('의존이 없으면 문구 뒷부분 생략, 취소하면 되돌아간다', async () => {
    render(<AttentionTab items={[HUMAN_ITEM]} plan={planOf({ t1: [] })} state={stateWith({ t1: 'rejected' })} />)
    await userEvent.click(screen.getByRole('button', { name: '이 태스크 건너뛰기' }))
    expect(screen.getByRole('button', { name: '정말 건너뛸까요?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByRole('button', { name: '이 태스크 건너뛰기' })).toBeInTheDocument()
  })
  it('plan 태스크 교착 카드에는 건너뛰기가 없다', () => {
    render(<AttentionTab items={[{ ...HUMAN_ITEM, task: 'plan' }]} />)
    expect(screen.queryByRole('button', { name: '이 태스크 건너뛰기' })).toBeNull()
    expect(screen.getByRole('button', { name: '지침 보내기' })).toBeInTheDocument()
  })
  it('제출 실패 시 카드 안에 서버 메시지', async () => {
    vi.spyOn(api, 'answer').mockRejectedValue(new ApiError(500, '서버 오류 발생'))
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.type(screen.getByRole('textbox', { name: '지침' }), 'x')
    await userEvent.click(screen.getByRole('button', { name: '지침 보내기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류 발생')
    expect(screen.getByRole('button', { name: '지침 보내기' })).toBeEnabled()
  })
  it('제출 중에는 버튼 비활성 + 보내는 중…', async () => {
    let done!: () => void
    vi.spyOn(api, 'answer').mockReturnValue(new Promise<void>((r) => { done = r }))
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.type(screen.getByRole('textbox', { name: '지침' }), 'x')
    await userEvent.click(screen.getByRole('button', { name: '지침 보내기' }))
    expect(screen.getByRole('button', { name: '보내는 중…' })).toBeDisabled()
    await act(async () => { done() })
  })
  it('409 → 이미 처리됨(회색, 버튼 없음, 문구 유지)', async () => {
    vi.spyOn(api, 'answer').mockRejectedValue(new ApiError(409, '열린 HUMAN_REQUIRED가 아님'))
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.type(screen.getByRole('textbox', { name: '지침' }), 'x')
    await userEvent.click(screen.getByRole('button', { name: '지침 보내기' }))
    const card = (await screen.findByText('이미 처리됨')).closest('article')!
    expect(card).toHaveClass('is-handled')
    expect(card.querySelector('button')).toBeNull()
    expect(screen.getByText('F-1')).toBeInTheDocument()
  })
  it('긴 지적 문구는 줄바꿈 클래스와 title을 가진다', () => {
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    const issue = screen.getByText(HUMAN_ITEM.findings[0]!.issue)
    expect(issue).toHaveClass('finding-issue')
    expect(issue).toHaveAttribute('title', HUMAN_ITEM.findings[0]!.issue)
  })
  it('[근거 보기] 링크가 태스크를 알려 준다', async () => {
    const onEvidence = vi.fn()
    render(<AttentionTab items={[HUMAN_ITEM]} onEvidence={onEvidence} />)
    await userEvent.click(screen.getByRole('button', { name: '근거 보기' }))
    expect(onEvidence).toHaveBeenCalledWith('t1')
  })
  it('로그인 카드: 안내 문구 + 재개 버튼 → api.resume', async () => {
    const resume = vi.spyOn(api, 'resume').mockResolvedValue()
    render(<AttentionTab items={[LOGIN_ITEM]} />)
    expect(screen.getByText(/터미널에서 다시 로그인 필요/)).toBeInTheDocument()
    expect(screen.getByText(/codex login/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '로그인했어요, 재개' }))
    expect(resume).toHaveBeenCalled()
  })
  it('재개 후 5초 안에 같은 사유가 다시 오면 아직 로그인되지 않았습니다', async () => {
    vi.spyOn(api, 'resume').mockResolvedValue()
    const { rerender } = render(<AttentionTab items={[LOGIN_ITEM]} />)
    await userEvent.click(screen.getByRole('button', { name: '로그인했어요, 재개' }))
    expect(screen.queryByText('아직 로그인되지 않았습니다')).toBeNull()
    rerender(<AttentionTab items={[{ kind: 'login', eventId: 'msg-0021', since: '2026-11-02T00:00:00Z' }]} />)
    expect(screen.getByText('아직 로그인되지 않았습니다')).toBeInTheDocument()
  })
  it('재개 후 5초가 지난 새 카드에는 메시지가 없다', async () => {
    vi.spyOn(api, 'resume').mockResolvedValue()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    const { rerender } = render(<AttentionTab items={[LOGIN_ITEM]} />)
    await userEvent.click(screen.getByRole('button', { name: '로그인했어요, 재개' }))
    now.mockReturnValue(1_006_000)
    rerender(<AttentionTab items={[{ kind: 'login', eventId: 'msg-0021', since: '2026-11-02T00:00:00Z' }]} />)
    expect(screen.queryByText('아직 로그인되지 않았습니다')).toBeNull()
  })
  it('OpenAI 상한 카드는 재개 후 같은 사유가 다시 오면 아직 상한이 그대로입니다', async () => {
    vi.spyOn(api, 'resume').mockResolvedValue()
    const cap = { ...HUMAN_ITEM, reason: 'openai_cap', task: undefined, findings: [], tried: [] }
    const { rerender } = render(<AttentionTab items={[cap]} />)
    await userEvent.click(screen.getByRole('button', { name: '재개' }))
    rerender(<AttentionTab items={[{ ...cap, eventId: 'msg-0011' }]} />)
    expect(screen.getByText('아직 상한이 그대로입니다')).toBeInTheDocument()
  })
  it('지침 보내기 더블클릭은 answer를 한 번만 호출', async () => {
    const answer = vi.spyOn(api, 'answer').mockImplementation(() => new Promise<void>(() => undefined))
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.type(screen.getByRole('textbox', { name: '지침' }), 'x')
    const btn = screen.getByRole('button', { name: '지침 보내기' })
    fireEvent.click(btn); fireEvent.click(btn)
    expect(answer).toHaveBeenCalledTimes(1)
  })
  it('건너뛰기 확인으로 바뀌면 포커스가 확인 버튼으로 이동', async () => {
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.click(screen.getByRole('button', { name: '이 태스크 건너뛰기' }))
    expect(screen.getByRole('button', { name: /정말 건너뛸까요/ })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByRole('button', { name: '이 태스크 건너뛰기' })).toHaveFocus()
  })
  it('409 처리됨 상태에서 포커스가 이미 처리됨 문구로 이동', async () => {
    vi.spyOn(api, 'answer').mockRejectedValue(new ApiError(409, 'x'))
    render(<AttentionTab items={[HUMAN_ITEM]} />)
    await userEvent.type(screen.getByRole('textbox', { name: '지침' }), 'x')
    await userEvent.click(screen.getByRole('button', { name: '지침 보내기' }))
    await waitFor(() => expect(screen.getByText('이미 처리됨')).toHaveFocus())
  })
  it('다른 사유의 새 카드에는 재시도 메시지가 없다', async () => {
    vi.spyOn(api, 'resume').mockResolvedValue()
    const { rerender } = render(<AttentionTab items={[LOGIN_ITEM]} />)
    await userEvent.click(screen.getByRole('button', { name: '로그인했어요, 재개' }))
    rerender(<AttentionTab items={[{ ...HUMAN_ITEM, reason: 'openai_cap', task: undefined, findings: [], tried: [], eventId: 'msg-0030' }]} />)
    expect(screen.queryByText('아직 상한이 그대로입니다')).toBeNull()
  })
  it('스펙 카드: 스펙 보기', async () => {
    const onOpenSpec = vi.fn()
    render(<AttentionTab items={[{ kind: 'spec', draftPath: 'spec.draft.md' }]} onOpenSpec={onOpenSpec} />)
    expect(screen.getByText('스펙 초안이 준비됐습니다')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '스펙 보기' }))
    expect(onOpenSpec).toHaveBeenCalled()
  })
  it('항목이 없으면 빈 안내', () => {
    render(<AttentionTab items={[]} />)
    expect(screen.getByText('지금 사람이 처리할 일이 없습니다')).toBeInTheDocument()
  })
})

const runWith = (events = [] as RunView['events'], extra: Partial<RunView> = {}): RunView => ({
  state: { ...initialState, stage: 'BUILD', tasks: { t1: { status: 'running', round: 2 } } },
  events, plan: null, agents: null, connected: true, loading: false, ...extra,
})

describe('RightPanel 마스터 · 상세', () => {
  it('탭 전환 콜백', async () => {
    const onTab = vi.fn()
    render(<RightPanel run={runWith()} tab="attention" onTab={onTab} selection={{}} />)
    await userEvent.click(screen.getByRole('tab', { name: '마스터' }))
    expect(onTab).toHaveBeenCalledWith('master')
  })
  it('마스터 탭: INTAKE가 아니면 입력창 대신 안내', () => {
    const events = [mk('CHAT', 'user', 'master', { payload: { text: '안녕' } }), mk('CHAT', 'master', 'user', { payload: { text: '반갑습니다' } })]
    render(<RightPanel run={runWith(events)} tab="master" onTab={() => undefined} selection={{}} />)
    expect(screen.getByText('안녕').closest('li')).toHaveClass('is-user')
    expect(screen.getByText('반갑습니다').closest('li')).toHaveClass('is-master')
    expect(screen.getByText(/요구사항 대화는 끝났습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
  it('상세 사람용 탭: iterations 마크다운과 증거 썸네일', async () => {
    const spy = vi.spyOn(api, 'human').mockImplementation(async (p) => {
      if (p === 'iterations/t1.md') return '# 회차 기록'
      if (p === 'evidence/t1/r2/manifest.json') return JSON.stringify([{ scenarioId: 's', steps: [{ step: 1, action: 'a', screenshot: 's1.png', ts: '' }] }])
      return null
    })
    render(<RightPanel run={runWith()} tab="detail" onTab={() => undefined} selection={{ taskId: 't1' }} />)
    expect(await screen.findByRole('heading', { name: '회차 기록' })).toBeInTheDocument()
    const img = await screen.findByRole('img', { name: /s1\.png/ })
    expect(img).toHaveAttribute('src', '/api/human/evidence/t1/r2/s1.png')
    expect(spy).toHaveBeenCalledWith('iterations/t1.md')
  })
  it('증거 경로 탈출/절대/스킴/역슬래시 항목은 건너뛴다', async () => {
    const names = ['../../raw/prompts/x.txt', '/abs.png', 'C:\\x.png', 'a\\b.png', 'http://e.test/a.png', 'ok.png']
    vi.spyOn(api, 'human').mockImplementation(async (p) => {
      if (p === 'iterations/t1.md') return '기록'
      if (p === 'evidence/t1/r2/manifest.json') return JSON.stringify([{ scenarioId: 's', steps: names.map((screenshot, i) => ({ step: i, action: 'a', screenshot, ts: '' })) }])
      return null
    })
    render(<RightPanel run={runWith()} tab="detail" onTab={() => undefined} selection={{ taskId: 't1' }} />)
    await screen.findByRole('img', { name: 'ok.png' })
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })
  it('서랍을 닫으면 포커스가 연 버튼으로 돌아간다', () => {
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus()
    const props = { run: runWith(), tab: 'attention' as const, onTab: () => undefined, selection: {} }
    const { rerender } = render(<RightPanel {...props} open={false} />)
    rerender(<RightPanel {...props} open />)
    rerender(<RightPanel {...props} open={false} />)
    expect(opener).toHaveFocus()
    opener.remove()
  })
  it('상세: 파일이 없어도 오류 배너 없이 빈 상태', async () => {
    vi.spyOn(api, 'human').mockResolvedValue(null)
    render(<RightPanel run={runWith()} tab="detail" onTab={() => undefined} selection={{ taskId: 't1' }} />)
    expect(await screen.findByText('아직 기록이 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('상세: 요청이 실패해도 오류 배너 없이 빈 상태', async () => {
    vi.spyOn(api, 'human').mockRejectedValue(new ApiError(500, 'boom'))
    render(<RightPanel run={runWith()} tab="detail" onTab={() => undefined} selection={{ taskId: 't1' }} />)
    expect(await screen.findByText('아직 기록이 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('상세 원본 탭: Envelope JSON(2칸)과 프롬프트 전문, 복사 버튼', async () => {
    vi.spyOn(api, 'prompt').mockResolvedValue('프롬프트 본문')
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const e = mk('ASSIGN', 'controller', 'dev', { task: 't1', promptRef: 'prompt-1' })
    render(<RightPanel run={runWith([e])} tab="detail" onTab={() => undefined} selection={{ eventId: e.id }} />)
    await userEvent.click(screen.getByRole('tab', { name: '원본' }))
    expect(await screen.findByText('프롬프트 본문')).toBeInTheDocument()
    expect(screen.getByText(/"type": "ASSIGN"/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Envelope 복사' }))
    expect(writeText).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '프롬프트 복사' })).toBeInTheDocument()
  })
  it('Markdown의 원본 링크 → 이벤트 선택 + 원본 탭', async () => {
    vi.spyOn(api, 'human').mockResolvedValue('[근거](../raw/events.jsonl#msg-0005)')
    const onSelectEvent = vi.fn()
    render(<RightPanel run={runWith()} tab="detail" onTab={() => undefined} onSelectEvent={onSelectEvent} selection={{ taskId: 't1' }} />)
    await userEvent.click(await screen.findByRole('link', { name: '근거' }))
    expect(onSelectEvent).toHaveBeenCalledWith('msg-0005')
    expect(screen.getByRole('tab', { name: '원본' })).toHaveAttribute('aria-selected', 'true')
  })
  it('서랍: 열리면 첫 포커스가 이동하고 Esc로 닫힌다', async () => {
    const onClose = vi.fn()
    const props = { run: runWith(), tab: 'attention' as const, onTab: () => undefined, selection: {}, onClose }
    const { rerender } = render(<RightPanel {...props} open={false} />)
    rerender(<RightPanel {...props} open />)
    await waitFor(() => expect(screen.getByRole('complementary', { name: '오른쪽 패널' }).contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('주의 탭이 run에서 항목을 만든다', () => {
    const h = human('msg-0100', 't1', 'repeat_finding')
    const run = runWith([h], { state: { ...initialState, stage: 'BUILD', humanRequired: [h.id], tasks: { t1: { status: 'rejected', round: 3 } } } })
    render(<RightPanel run={run} tab="attention" onTab={() => undefined} selection={{}} />)
    expect(screen.getByRole('button', { name: '지침 보내기' })).toBeInTheDocument()
  })
})
