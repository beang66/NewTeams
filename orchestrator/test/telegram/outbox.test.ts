process.env.TZ = 'Asia/Seoul'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type TelegramConfig } from '../../src/config.js'
import { Outbox } from '../../src/telegram/outbox.js'
import type { OutMessage } from '../../src/telegram/format.js'
import { manualClock } from '../helpers.js'

const m = (kind: OutMessage['kind'], silent: boolean, text: string = kind, extra: Partial<OutMessage> = {}): OutMessage => ({ kind, silent, text, ...extra })
const stageMsg = (s: string) => m('stage', true, `기획 → ${s}`)
const pausedMsg = () => m('paused', true, '일시정지')
const resumedMsg = () => m('resumed', true, '재개')
const humanMsg = () => m('human', false, '사람 필요\n자세한 내용')
const approvedMsg = () => m('approved', true, '승인됨')

let clock = manualClock('2026-10-28T12:00:00+09:00')
let sent: OutMessage[] = []
const okSend = async (x: OutMessage) => { sent.push(x) }
const failingSend = async () => { throw new Error('boom') }
const boxes: Outbox[] = []
function outbox(cfg: Partial<TelegramConfig> = {}, opts: { maxQueue?: number } = {}, send: (x: OutMessage) => Promise<void> = okSend): Outbox {
  const o = new Outbox({ ...DEFAULT_CONFIG.telegram, ...cfg }, clock, send, opts)
  boxes.push(o)
  return o
}
function setup() { clock = manualClock('2026-10-28T12:00:00+09:00'); sent = [] }
afterEach(() => { boxes.splice(0).forEach(o => o.stop()); vi.restoreAllMocks() })

describe('Outbox', () => {
  it('무음 3개가 30초 안에 오면 한 메시지', async () => {
    setup(); const o = outbox()
    o.push(stageMsg('a')); o.push(pausedMsg()); o.push(resumedMsg()); await clock.advance(30_000)
    expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ kind: 'digest', silent: true }); expect(sent[0]!.text.split('\n')).toHaveLength(3)
  })
  it('무음 1개는 그대로 전송', async () => {
    setup(); const o = outbox(); o.push(stageMsg('a')); await clock.advance(29_000); expect(sent).toHaveLength(0)
    await clock.advance(1_000); expect(sent).toHaveLength(1); expect(sent[0]!.kind).toBe('stage')
  })
  it('버튼 있는 무음은 합치지 않고 따로 보낸다', async () => {
    setup(); const o = outbox()
    const b = m('spec', true, '스펙', { buttons: [[{ text: '승인', url: 'https://x.test' }]] })
    o.push(stageMsg('a')); o.push(b); o.push(pausedMsg()); await clock.advance(30_000)
    expect(sent.map(x => x.kind).sort()).toEqual(['digest', 'spec'])
    expect(sent.find(x => x.kind === 'spec')!.buttons).toBeDefined()
  })
  it('소리 알림은 즉시', async () => { setup(); outbox().push(humanMsg()); await clock.advance(0); expect(sent[0]!.kind).toBe('human') })
  it('조용한 시간: 소리 → 무음, 끝나면 밤사이 요약 1건(소리)', async () => {
    setup(); clock.set('2026-10-28T23:30:00+09:00'); const o = outbox({ quietHours: { start: '23:00', end: '07:00' } })
    o.push(humanMsg()); await clock.advance(0); expect(sent[0]!.silent).toBe(true)
    await clock.advanceTo('2026-10-29T07:00:00+09:00'); expect(sent.at(-1)).toMatchObject({ silent: false, kind: 'digest' }); expect(sent.at(-1)!.text).toMatch(/^🌅 밤사이 1건/)
    expect(sent.at(-1)!.text.split('\n')[1]).toBe('사람 필요')
  })
  it('조용한 시간에 기록이 없으면 요약 없음', async () => {
    setup(); clock.set('2026-10-28T23:30:00+09:00'); outbox({ quietHours: { start: '23:00', end: '07:00' } })
    await clock.advanceTo('2026-10-29T07:01:00+09:00'); expect(sent).toHaveLength(0)
  })
  it('조용한 시간 밖에서는 소리 유지', async () => {
    setup(); const o = outbox({ quietHours: { start: '23:00', end: '07:00' } }); o.push(humanMsg()); await clock.advance(0); expect(sent[0]!.silent).toBe(false)
  })
  it('task 승인 알림은 기본 꺼짐', async () => { setup(); outbox().push(approvedMsg()); await clock.advance(60_000); expect(sent).toHaveLength(0) })
  it('task 승인 알림 켜면 전달', async () => { setup(); outbox({ notifyTaskApprovals: true }).push(approvedMsg()); await clock.advance(30_000); expect(sent).toHaveLength(1) })
  it('대기열이 넘치면 무음부터 버리고 소리는 남긴다', async () => {
    setup(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const o = outbox({}, { maxQueue: 3 }, failingSend); o.push(humanMsg()); for (let i = 0; i < 5; i++) o.push(stageMsg(String(i)))
    expect(o.pendingLoud()).toBe(1); expect(o.size()).toBeLessThanOrEqual(3)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^텔레그램: 알림 \d+건 버림$/))
  })
  it('소리 알림 전송 실패는 다음 주기에 재시도, 최대 5회', async () => {
    setup(); vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0; const o = outbox({}, {}, async () => { calls++; throw new Error('x') })
    o.push(humanMsg()); await clock.advance(0); expect(calls).toBe(1); expect(o.pendingLoud()).toBe(1)
    await clock.advance(60_000); expect(calls).toBe(5); expect(o.pendingLoud()).toBe(0)
  })
  it('재시도 성공하면 한 번만 전달', async () => {
    setup(); let n = 0; const o = outbox({}, {}, async (x) => { if (++n < 3) throw new Error('x'); sent.push(x) })
    o.push(humanMsg()); await clock.advance(10_000); expect(sent).toHaveLength(1); expect(o.pendingLoud()).toBe(0)
  })
  it('무음 전송 실패는 버린다', async () => {
    setup(); let calls = 0; const o = outbox({}, {}, async () => { calls++; throw new Error('x') })
    o.push(stageMsg('a')); await clock.advance(120_000); expect(calls).toBe(1); expect(o.size()).toBe(0)
  })
  it('push는 throw하지 않는다', () => {
    setup(); const o = outbox({}, {}, () => { throw new Error('sync') })
    expect(() => { o.push(humanMsg()); o.push(stageMsg('a')) }).not.toThrow()
  })
  it('생존 신호', async () => { setup(); outbox({ heartbeatMinutes: 30 }); await clock.advance(30 * 60_000); expect(sent.at(-1)!.text).toMatch(/^💓/); expect(sent.at(-1)).toMatchObject({ kind: 'heartbeat', silent: true }) })
  it('생존 신호에 마지막 단계', async () => {
    setup(); const o = outbox({ heartbeatMinutes: 30 }); o.push(stageMsg('개발')); await clock.advance(30 * 60_000)
    expect(sent.at(-1)!.text).toBe('💓 오케스트레이터 동작 중 · 개발')
  })
  it('flush는 남은 묶음을 즉시 보낸다, stop 후에는 타이머 없음', async () => {
    setup(); const o = outbox(); o.push(stageMsg('a')); o.push(pausedMsg()); await o.flush()
    expect(sent).toHaveLength(1); expect(sent[0]!.kind).toBe('digest'); expect(o.size()).toBe(0)
    o.stop(); o.push(stageMsg('b')); await clock.advance(60_000); expect(sent).toHaveLength(1)
  })
  it('끝나지 않는 send: 시간 초과 후 재시도되고 flush도 끝난다', async () => {
    setup(); vi.spyOn(console, 'warn').mockImplementation(() => {})
    let n = 0; const o = outbox({}, {}, (x) => { if (++n === 1) return new Promise<void>(() => {}); sent.push(x); return Promise.resolve() })
    o.push(humanMsg()); o.push(m('error', false, '두번째'))
    await clock.advance(14_000); expect(sent).toHaveLength(0)
    await clock.advance(5_000); expect(sent.map(x => x.kind)).toEqual(['human', 'error'])
  })
  it('항상 멈추는 send에서도 flush는 시간 제한 안에 끝난다', async () => {
    setup(); vi.spyOn(console, 'warn').mockImplementation(() => {})
    const o = outbox({}, {}, () => new Promise<void>(() => {}))
    o.push(humanMsg()); o.push(stageMsg('a'))
    let done = false; const p = o.flush().then(() => { done = true })
    await clock.advance(15_000); await clock.advance(15_000); await p; expect(done).toBe(true)
  })
  it('stop 이후 push는 무시', async () => {
    setup(); const o = outbox(); o.stop(); o.push(humanMsg()); await clock.advance(60_000); expect(sent).toHaveLength(0)
  })
  it('새 소리 알림 push가 실패한 항목의 시도 횟수를 올리지 않는다', async () => {
    setup(); vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0; const o = outbox({}, {}, async () => { calls++; throw new Error('x') })
    o.push(humanMsg()); await clock.advance(0); for (let i = 0; i < 10; i++) o.push(m('error', false, String(i)))
    await clock.advance(0); expect(calls).toBe(1)
  })
})
