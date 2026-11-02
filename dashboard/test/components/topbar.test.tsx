import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { initialState, type RunState } from '@orch/store/state'
import { api } from '../../src/api/client'
import type { RunView } from '../../src/api/useRun'
import { StageRail } from '../../src/components/StageRail'
import { TopBar } from '../../src/components/TopBar'
import { UsagePanel, UsageGauges } from '../../src/components/UsageGauges'
import { PausedBanner } from '../../src/components/PausedBanner'
import { SinceBar } from '../../src/components/SinceBar'
import { TelegramChip } from '../../src/components/TelegramChip'
import { ControlScreen } from '../../src/screens/ControlScreen'
import { stubFetch } from '../fakes'
import { mk, human } from '../model/helpers'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear() })

const runWith = (state: Partial<RunState> = {}, extra: Partial<RunView> = {}): RunView => ({
  state: { ...initialState, ...state }, events: [], plan: null, agents: null, connected: true, loading: false, ...extra,
})

describe('상단 바 뼈대', () => {
  it('단계 레일은 현재 단계에 aria-current', () => {
    render(<StageRail stage="BUILD" />)
    expect(screen.getByText('개발').closest('li')).toHaveAttribute('aria-current', 'step')
  })
  it('주의 0이면 강조 없음, 1 이상이면 강조', () => {
    const { rerender } = render(<TopBar run={runWith({ humanRequired: [] }, { events: [] })} />)
    expect(screen.getByRole('button', { name: /주의 0/ })).not.toHaveClass('is-alert')
    rerender(<TopBar run={runWith({ humanRequired: ['msg-1'] }, { events: [human('msg-1', undefined, 'repeat_finding')] })} />)
    expect(screen.getByRole('button', { name: /주의 1/ })).toHaveClass('is-alert')
  })
  it('주의 버튼은 onOpenAttention을 부른다', () => {
    const fn = vi.fn()
    render(<TopBar run={runWith()} onOpenAttention={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /주의/ }))
    expect(fn).toHaveBeenCalled()
  })
  it('연결이 끊기면 칩 표시', () => {
    render(<TopBar run={runWith({}, { connected: false })} />)
    expect(screen.getByText('연결 끊김 — 다시 연결 중')).toBeInTheDocument()
  })
  it('사용량: provider별 토큰과 API 지출/$8', () => {
    render(<UsageGauges usage={{ byProvider: { claude: { tokens: 12345, cached: 10000 }, codex: { tokens: 500, cached: 0 } }, totalTokens: 12845, recordedCostUsd: 0.35, hasRecordedCost: true, byDay: [], apiSpendUsd: 1.2, apiCapUsd: 8 }} />)
    expect(screen.getByText('12,345')).toBeInTheDocument(); expect(screen.getByText('$1.20 / $8')).toBeInTheDocument(); expect(screen.getByText('$0.35')).toBeInTheDocument()
  })
  it('관제 사용량은 이 프로젝트·대시보드 전체와 최근 일별 토큰·비용을 표시한다', async () => {
    vi.spyOn(api, 'usageAll').mockResolvedValue({ total: { tokens: 5000, costUsd: 1.5, hasCost: true }, projects: [{ name: 'home', tokens: 1200, costUsd: 0.12, hasCost: true }, { name: 'b', tokens: 3800, costUsd: 1.38, hasCost: true }], skills: { tokens: 0, costUsd: 0, hasCost: false } })
    render(<UsagePanel project="home" usage={{ byProvider: { claude: { tokens: 1200, cached: 0 }, codex: { tokens: 0, cached: 0 } }, totalTokens: 1200, recordedCostUsd: 0.12, hasRecordedCost: true, byDay: [{ date: '2026-11-02', tokens: 1200, cached: 0, costUsd: 0.12, hasCost: true }], apiSpendUsd: 0.04, apiCapUsd: 8 }} />)
    const region = screen.getByRole('region', { name: '토큰 사용량' })
    expect(region).toHaveTextContent(/이 프로젝트 · home\s*1,200 토큰\s*기록 비용\$0\.12/)
    expect(await screen.findByText('5,000')).toBeInTheDocument()
    expect(region).toHaveTextContent('프로젝트 2개')
    expect(screen.getByText('11.02')).toBeInTheDocument()
    expect(screen.getAllByText('$0.12', { selector: 'td' })).toHaveLength(1)
  })
  it('일시정지 배너: 자동 재개 시각과 남은 시간', () => {
    render(<PausedBanner now={() => Date.parse('2026-10-27T05:00:00Z')} paused={{ reason: 'rate_limit', until: new Date('2026-10-27T05:30:00Z'), remainingMs: 1_800_000, needsHuman: false }} />)
    expect(screen.getByRole('status')).toHaveTextContent(/사용량 한도.*재개.*30분/)
  })
  it('로그인이 필요하면 배너에 재개 버튼 대신 안내', () => {
    render(<PausedBanner paused={{ reason: 'auth', needsHuman: true }} />)
    expect(screen.getByRole('status')).toHaveTextContent('터미널에서 다시 로그인 필요')
  })
  it('OpenAI 지출 상한이면 상한을 올리라는 안내', () => {
    render(<PausedBanner paused={{ reason: 'openai_cap', needsHuman: true }} />)
    expect(screen.getByRole('status')).toHaveTextContent('openaiCapUsd')
    expect(screen.getByRole('status')).not.toHaveTextContent('로그인')
  })
  it('다시 렌더돼도 남은 시간이 튀지 않는다', () => {
    const until = new Date(600_000)
    const { rerender } = render(<PausedBanner now={() => 0} paused={{ reason: 'rate_limit', until, remainingMs: 600_000, needsHuman: false }} />)
    expect(screen.getByRole('status')).toHaveTextContent('10분')
    rerender(<PausedBanner now={() => 120_000} paused={{ reason: 'rate_limit', until, remainingMs: 480_000, needsHuman: false }} />)
    expect(screen.getByRole('status')).toHaveTextContent('8분')
  })
  it('남은 시간은 1초마다 줄고 언마운트하면 멈춘다', () => {
    vi.useFakeTimers()
    let now = 0
    const { unmount } = render(<PausedBanner now={() => now} paused={{ reason: 'rate_limit', until: new Date(90_000), remainingMs: 90_000, needsHuman: false }} />)
    expect(screen.getByRole('status')).toHaveTextContent('2분')
    now = 40_000
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('status')).toHaveTextContent('50초')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('일시정지 상태면 ControlScreen에 배너가 뜬다', () => {
    stubFetch({})
    render(<ControlScreen run={runWith({ stage: 'BUILD', paused: { reason: 'rate_limit' } })} />)
    expect(screen.getByRole('status')).toHaveTextContent('사용량 한도')
  })
})

describe('SinceBar', () => {
  const evs = [mk('CHAT', 'a', 'b'), mk('APPROVE', 'a', 'b', { task: 't' }), mk('APPROVE', 'a', 'b', { task: 'u' })]
  const key = `orch.lastSeen.${evs[0]!.id}.${evs[0]!.ts}`
  const now = new Date(Date.parse(evs[2]!.ts) + 5 * 60_000)

  it('첫 방문이면 아무것도 보이지 않고 기준점을 저장', () => {
    render(<SinceBar events={evs} now={now} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(localStorage.getItem(key)).toBe(evs[2]!.id)
  })
  it('요약 줄 표시 후 누르면 onOpenTimeline(ids)', () => {
    localStorage.setItem(key, evs[0]!.id)
    const open = vi.fn()
    render(<SinceBar events={evs} now={now} onOpenTimeline={open} />)
    fireEvent.click(screen.getByRole('button', { name: /승인 2/ }))
    expect(open).toHaveBeenCalledWith([evs[1]!.id, evs[2]!.id])
  })
  it('[확인함]이면 닫히고 최신 id 저장', () => {
    localStorage.setItem(key, evs[0]!.id)
    render(<SinceBar events={evs} now={now} />)
    fireEvent.click(screen.getByRole('button', { name: '확인함' }))
    expect(screen.queryByText(/승인 2/)).toBeNull()
    expect(localStorage.getItem(key)).toBe(evs[2]!.id)
  })
  it('화면 아무 데나 누르면 닫힌다', () => {
    localStorage.setItem(key, evs[0]!.id)
    render(<><p>본문</p><SinceBar events={evs} now={now} /></>)
    fireEvent.click(screen.getByText('본문'))
    expect(screen.queryByText(/승인 2/)).toBeNull()
  })
  it('새 이벤트가 없으면 아무것도 안 보인다', () => {
    localStorage.setItem(key, evs[2]!.id)
    render(<SinceBar events={evs} now={now} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('localStorage가 실패해도 렌더된다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => render(<SinceBar events={evs} now={now} />)).not.toThrow()
    fireEvent.click(document.body)
  })
  it('탭이 숨겨질 때 기준점을 저장하고 다시 보이면 그 이후 요약을 보여 준다', () => {
    localStorage.setItem(key, evs[2]!.id)
    const { rerender } = render(<SinceBar events={evs} now={now} />)
    const more = [...evs, human('msg-9001', 't', 'repeat_finding')]
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(localStorage.getItem(key)).toBe(evs[2]!.id)
    rerender(<SinceBar events={more} now={now} />)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(screen.getByRole('button', { name: /주의 1/ })).toBeInTheDocument()
  })
})

describe('TelegramChip', () => {
  const setup = (v: Awaited<ReturnType<typeof api.telegram>>) => vi.spyOn(api, 'telegram').mockResolvedValue(v)
  it('off는 숨김', async () => {
    setup({ state: 'off' })
    const { container } = render(<TelegramChip />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })
  it('connected는 텔레그램 @이름', async () => {
    setup({ state: 'connected', botUsername: 'orch_bot' })
    render(<TelegramChip />)
    expect(await screen.findByText('텔레그램 @orch_bot')).toBeInTheDocument()
  })
  it('connected인데 이름이 없으면 연결됨', async () => {
    setup({ state: 'connected' })
    render(<TelegramChip />)
    expect(await screen.findByText('텔레그램 연결됨')).toBeInTheDocument()
  })
  it('connecting', async () => {
    setup({ state: 'connecting' })
    render(<TelegramChip />)
    expect(await screen.findByText('텔레그램 연결 중')).toBeInTheDocument()
  })
  it('error는 끊김 + title에 lastError', async () => {
    setup({ state: 'error', lastError: 'boom' })
    render(<TelegramChip />)
    expect(await screen.findByText('텔레그램 끊김')).toHaveAttribute('title', 'boom')
  })
  it('30초마다 다시 읽고 언마운트하면 멈춘다', async () => {
    vi.useFakeTimers()
    const spy = setup({ state: 'off' })
    const { unmount } = render(<TelegramChip />)
    await act(async () => {})
    expect(spy).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(spy).toHaveBeenCalledTimes(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('api.telegram: 실패하면 off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    await expect(api.telegram()).resolves.toEqual({ state: 'off' })
    stubFetch({ '/api/telegram': [200, { state: 'connected', botUsername: 'x' }] })
    await expect(api.telegram()).resolves.toEqual({ state: 'connected', botUsername: 'x' })
  })
})
