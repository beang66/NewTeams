import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { initialState, type RunState } from '@orch/store/state'
import { api } from '../../src/api/client'
import type { RunView } from '../../src/api/useRun'
import { StageRail } from '../../src/components/StageRail'
import { TopBar } from '../../src/components/TopBar'
import { UsageGauges } from '../../src/components/UsageGauges'
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
    const { rerender } = render(<TopBar run={runWith({ humanRequired: [] })} />)
    expect(screen.getByRole('button', { name: /주의 0/ })).not.toHaveClass('is-alert')
    rerender(<TopBar run={runWith({ humanRequired: ['msg-1'] })} />)
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
    render(<UsageGauges usage={{ byProvider: { claude: { tokens: 12345, cached: 10000 }, codex: { tokens: 500, cached: 0 } }, apiSpendUsd: 1.2, apiCapUsd: 8 }} />)
    expect(screen.getByText('12,345')).toBeInTheDocument(); expect(screen.getByText('$1.20 / $8')).toBeInTheDocument()
  })
  it('일시정지 배너: 자동 재개 시각과 남은 시간', () => {
    render(<PausedBanner paused={{ reason: 'rate_limit', until: new Date('2026-10-27T05:30:00Z'), remainingMs: 1_800_000, needsHuman: false }} />)
    expect(screen.getByRole('status')).toHaveTextContent(/사용량 한도.*재개.*30분/)
  })
  it('로그인이 필요하면 배너에 재개 버튼 대신 안내', () => {
    render(<PausedBanner paused={{ reason: 'rate_limit', needsHuman: true }} />)
    expect(screen.getByRole('status')).toHaveTextContent('터미널에서 다시 로그인 필요')
  })
  it('남은 시간은 1초마다 줄고 언마운트하면 멈춘다', () => {
    vi.useFakeTimers()
    let now = 0
    const { unmount } = render(<PausedBanner now={() => now} paused={{ reason: 'rate_limit', until: new Date(0), remainingMs: 90_000, needsHuman: false }} />)
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
