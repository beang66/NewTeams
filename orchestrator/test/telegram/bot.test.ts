import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Workflow } from '../../src/engine/workflow.js'
import { RunnerError } from '../../src/runners/types.js'
import { systemClock } from '../../src/clock.js'
import { createWorkflowActions } from '../../src/server/actions.js'
import { attachNotifier, NOTIFY_TYPES } from '../../src/server/notifier.js'
import { TelegramBot } from '../../src/telegram/bot.js'
import { BotApi } from '../../src/telegram/botApi.js'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { fakeDeps, makeScript } from '../fixtures/scripts/common.js'
import { PNG_1X1, manualClock } from '../helpers.js'
import { startFakeBotApi, type FakeBotApi } from './fakeBotApi.js'

let dir: string
let wf: Workflow
let fake: FakeBotApi
let bot: TelegramBot
let detach: (() => void) | undefined
const until = async (check: () => void) => vi.waitFor(check, { timeout: 5000, interval: 20 })
const lastButtons = () => fake.lastSent('editMessageText').body.reply_markup?.inline_keyboard.flat().map((b: { text: string }) => b.text)

async function boot(api = new BotApi(fake.token, fake.base), clock = systemClock) {
  const actions = createWorkflowActions(wf, vi.fn())
  vi.spyOn(wf, 'runUntilBlocked').mockResolvedValue('waiting_human')
  bot = new TelegramBot({ secrets: { token: fake.token, chatId: fake.chatId }, cfg: { ...DEFAULT_CONFIG.telegram, apiBase: fake.base, pollTimeoutSec: 1 }, wf, actions, clock, api })
  detach = attachNotifier(wf.bus, bot, [...NOTIFY_TYPES, 'RESUMED', 'APPROVE'])
  await bot.start()
  return actions
}
async function human() {
  const event = await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', task: 't1', payload: { reason: 'repeat_finding' } })
  await until(() => expect(fake.sentTexts().some(t => t.startsWith('🔴 t1 사람 필요'))).toBe(true))
  return event
}
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orch-tg-bot-'))
  wf = await Workflow.open(dir, fakeDeps(makeScript()))
  fake = await startFakeBotApi()
})
afterEach(async () => { detach?.(); detach = undefined; await bot?.stop(); await fake.close(); await fs.rm(dir, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('TelegramBot', { timeout: 30_000 }, () => {
  it('교착 알림 → 지침 쓰기 → 답장 → 공유 동작, 원래 알림 버튼 제거', async () => {
    const actions = await boot()
    const answer = vi.spyOn(actions, 'answer')
    const e = await human()
    const originalId = fake.lastSent('sendMessage').body
    fake.tap('guide')
    await until(() => expect(fake.lastSent('sendMessage').body.reply_markup?.force_reply).toBe(true))
    fake.replyToLast('입력은 trim 후 검사')
    await until(() => expect(answer).toHaveBeenCalledWith(e.id, { action: 'guidance', text: '입력은 trim 후 검사' }))
    await until(() => expect(fake.lastSent('editMessageText').body.text).toContain('처리됨 ✓'))
    expect(lastButtons()).toEqual([])
    expect(originalId.text).toContain('사람 필요')
  })
  it('건너뛰기는 확인을 거치고 중복 응답은 이미 처리됨', async () => {
    const actions = await boot(); const answer = vi.spyOn(actions, 'answer')
    const e = await human()
    fake.tap('skip')
    await until(() => expect(lastButtons()).toEqual(['정말 건너뛰기', '취소']))
    expect(answer).not.toHaveBeenCalled()
    const confirm = fake.lastSent('editMessageText').body
    const callback = () => fake.pushUpdate({ callback_query: { id: `duplicate-${Date.now()}`, from: { id: 42 }, message: { message_id: confirm.message_id, chat: { id: 42 }, text: confirm.text }, data: `K:${e.id}` } })
    callback(); await until(() => expect(wf.state().humanRequired).not.toContain(e.id))
    callback(); await until(() => expect(fake.lastSent('answerCallbackQuery').body.text).toBe('이미 처리됨'))
    expect(answer).toHaveBeenCalledTimes(2)
  })
  it('취소하면 원래 버튼이 복원된다', async () => {
    await boot(); await human(); fake.tap('skip')
    await until(() => expect(lastButtons()).toContain('취소'))
    fake.tap('cancel')
    await until(() => expect(lastButtons()).toEqual(['지침 쓰기', '건너뛰기', '자세히']))
  })
  it('스펙 승인은 두 단계로 실행된다', async () => {
    const actions = await boot(); const approve = vi.spyOn(actions, 'approveSpec')
    await wf.chat('할 일 앱')
    await until(() => expect(fake.sentTexts().some(t => t.startsWith('🟣'))).toBe(true))
    fake.tap('approve'); await until(() => expect(lastButtons()).toEqual(['정말 승인', '취소']))
    expect(approve).not.toHaveBeenCalled()
    fake.tap('approveConfirm'); await until(() => expect(approve).toHaveBeenCalledTimes(1))
  })
  it('다른 채팅은 응답 없이 무시하며 같은 id는 한 번만 경고한다', async () => {
    await boot(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 2; i++) fake.pushUpdate({ message: { message_id: i, chat: { id: 999 }, text: '/status' } })
    fake.pushUpdate({ callback_query: { id: 'foreign', from: { id: 999 }, message: { message_id: 1, chat: { id: 999 } }, data: 'r' } })
    await until(() => expect(fake.calls.some(c => c.method === 'getUpdates' && c.body.offset >= 4)).toBe(true))
    expect(fake.calls.filter(c => c.method === 'sendMessage')).toHaveLength(0)
    expect(fake.calls.filter(c => c.method === 'answerCallbackQuery')).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1); expect(warn).toHaveBeenCalledWith('텔레그램: 허용되지 않은 채팅 999')
  })
  it('처음 켤 때 과거 명령은 건너뛰고 재시작도 처리한 명령을 반복하지 않는다', async () => {
    fake.send('/resume')
    const actions = await boot(); const resume = vi.spyOn(actions, 'resume')
    fake.send('/status'); await until(() => expect(fake.sentTexts().at(-1)).toContain('주의'))
    expect(resume).not.toHaveBeenCalled()
    const offset = JSON.parse(await fs.readFile(join(wf.store.paths.raw, 'telegram-offset.json'), 'utf8')).offset
    expect(offset).toBe(3)
    detach?.(); await bot.stop(); vi.restoreAllMocks()
    await boot(); await new Promise(r => setTimeout(r, 100))
    expect(fake.calls.filter(c => c.method === 'sendMessage')).toHaveLength(1)
  })
  it('/ask는 확인 후 한 번만 실행하며 만료된 키를 실행하지 않는다', async () => {
    const actions = await boot(); const ask = vi.spyOn(actions, 'ask').mockResolvedValue('timeline 답변')
    fake.send('/ask 왜 멈췄어?')
    await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    expect(ask).not.toHaveBeenCalled()
    const prompt = fake.lastSent('sendMessage').body
    const key = prompt.reply_markup.inline_keyboard[0][0].callback_data
    fake.tap('ask'); await until(() => expect(ask).toHaveBeenCalledWith('왜 멈췄어?'))
    fake.pushUpdate({ callback_query: { id: 'ask-duplicate', from: { id: 42 }, message: { message_id: 100, chat: { id: 42 } }, data: key } })
    await until(() => expect(fake.lastSent('answerCallbackQuery').body.text).toMatch(/만료|처리/))
    expect(ask).toHaveBeenCalledTimes(1)
  })
  it('/ask 확인은 10분 뒤 만료된다', async () => {
    const actions = await boot(); const ask = vi.spyOn(actions, 'ask')
    fake.send('/ask 상태?')
    await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    vi.spyOn(systemClock, 'now').mockReturnValue(new Date(Date.now() + 11 * 60_000))
    fake.tap('ask')
    await until(() => expect(fake.lastSent('answerCallbackQuery').body.text).toContain('만료'))
    expect(ask).not.toHaveBeenCalled()
  })
  it('오래 걸리는 /ask는 결과 전에 버튼 로딩을 끝낸다', async () => {
    const actions = await boot()
    let finish!: (value: string) => void
    const ask = vi.spyOn(actions, 'ask').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    fake.send('/ask 상태?'); await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    fake.tap('ask'); await until(() => expect(ask).toHaveBeenCalledTimes(1))
    try { expect(fake.calls.some(call => call.method === 'answerCallbackQuery')).toBe(true) } finally { finish('done') }
    await until(() => expect(fake.sentTexts()).toContain('처리됨 ✓ · 로그 질의'))
  })
  it.each(['auth', 'openai_cap'] as const)('/ask가 %s 게이트에 대기해도 /resume으로 해제된다', async reason => {
    const actions = await boot()
    let first = true
    const ask = vi.spyOn(actions, 'ask').mockImplementation(() => wf.gate.guard(async () => {
      if (first) { first = false; throw new RunnerError(reason === 'auth' ? 'auth' : 'rate_limit', reason === 'auth' ? 'login' : 'openai cap') }
      return '게이트 해제 후 결과'
    }))
    const resume = vi.spyOn(actions, 'resume')
    fake.send('/ask 상태?'); await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    fake.tap('ask'); await until(() => expect(ask).toHaveBeenCalledTimes(1))
    await until(() => expect(wf.gate.paused).toBe(true))
    fake.send('/resume')
    try {
      await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1), { timeout: 500, interval: 20 })
      await until(() => expect(fake.sentTexts()).toContain('게이트 해제 후 결과'))
      expect(wf.gate.paused).toBe(false)
    } finally { await wf.gate.resumeByHuman() }
  })
  it('stop은 진행 중인 /ask를 기다리지 않으며 나중 결과를 전송하지 않는다', async () => {
    const actions = await boot()
    let finish!: (value: string) => void
    const ask = vi.spyOn(actions, 'ask').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    fake.send('/ask 상태?'); await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    fake.tap('ask'); await until(() => expect(ask).toHaveBeenCalledTimes(1))
    const stopped = bot.stop()
    try { expect(await Promise.race([stopped.then(() => 'stopped'), new Promise(resolve => setTimeout(() => resolve('waiting'), 150))])).toBe('stopped') } finally { finish('LATE_RESULT') }
    await stopped
    const calls = fake.calls.length
    await new Promise(resolve => setTimeout(resolve, 75))
    expect(fake.calls).toHaveLength(calls)
    expect(fake.sentTexts().join('\n')).not.toContain('LATE_RESULT')
  })
  it('/ask 결과에서 코드 블록·diff 본문·원본 프롬프트 경로를 제거한다', async () => {
    const actions = await boot()
    vi.spyOn(actions, 'ask').mockResolvedValue('상태 요약\n```ts\nSOURCE_SECRET\n```\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-OLD_SECRET\n+NEW_SECRET\n원본 raw/prompts/secret.txt\n작업 대기 중')
    fake.send('/ask 상태?'); await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    fake.tap('ask'); await until(() => expect(fake.sentTexts()).toContain('처리됨 ✓ · 로그 질의'))
    const sent = fake.sentTexts().join('\n')
    expect(sent).toContain('상태 요약'); expect(sent).toContain('작업 대기 중')
    expect(sent).not.toMatch(/SOURCE_SECRET|OLD_SECRET|NEW_SECRET|raw\/prompts|diff --git|```/)
  })
  it('종료 후 질의가 실패해도 rejection을 관찰하고 후속 메시지를 보내지 않는다', async () => {
    const actions = await boot()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let fail!: (error: Error) => void
    const ask = vi.spyOn(actions, 'ask').mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
    fake.send('/ask 상태?'); await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    fake.tap('ask'); await until(() => expect(ask).toHaveBeenCalledTimes(1))
    await bot.stop(); const calls = fake.calls.length
    fail(new Error(`late bot${fake.token}`))
    await until(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('late bot***')))
    expect(fake.calls).toHaveLength(calls)
  })
  it.each(['guide', 'skip'] as const)('재시작 후 과거 알림에서 %s를 새로 누르면 원래 알림을 처리됨으로 수정한다', async kind => {
    await boot(); const event = await human()
    const oldAlert = fake.calls.filter(call => call.method === 'sendMessage').at(-1)!
    detach?.(); await bot.stop(); await boot()
    fake.tap(kind)
    if (kind === 'guide') {
      await until(() => expect(fake.lastSent('sendMessage').body.reply_markup?.force_reply).toBe(true))
      fake.replyToLast('새로운 지침')
    } else {
      await until(() => expect(lastButtons()).toContain('정말 건너뛰기'))
      fake.tap('skipConfirm')
    }
    await until(() => expect(wf.state().humanRequired).not.toContain(event.id))
    await until(() => expect(fake.lastSent('editMessageText').body.text).toContain('처리됨 ✓'))
    expect(lastButtons()).toEqual([])
    expect(fake.lastSent('editMessageText').body.text).toContain(oldAlert.body.text)
  })
  it('실행한 /ask 업데이트는 재시작 후 반복 실행되지 않는다', async () => {
    const ask = vi.spyOn(wf, 'askLog').mockResolvedValue('answer')
    await boot(); fake.send('/ask 상태?')
    await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    fake.tap('ask'); await until(() => expect(fake.sentTexts()).toContain('처리됨 ✓ · 로그 질의'))
    detach?.(); await bot.stop()
    await boot(); await new Promise(r => setTimeout(r, 100))
    expect(ask).toHaveBeenCalledTimes(1)
  })
  it('초기 연결 실패를 반환하고 백그라운드에서 복구한다', async () => {
    const api = new BotApi(fake.token, fake.base)
    vi.spyOn(api, 'getMe').mockRejectedValueOnce(new Error(`bot${fake.token} failed`))
    await expect(boot(api)).resolves.toBeDefined()
    await until(() => expect(bot.status().state).toBe('connected'))
    expect(bot.status()).toMatchObject({ botUsername: 'fake_bot', lastOkAt: expect.any(String) })
    expect(bot.status()).not.toHaveProperty('lastError')
  })
  it('polling 실패는 1초·2초·4초 백오프하고 stop으로 대기에서 빠져나온다', async () => {
    const clock = manualClock('2026-10-28T12:00:00+09:00')
    const api = new BotApi(fake.token, fake.base)
    const poll = vi.spyOn(api, 'getUpdates').mockImplementation(async offset => { if (offset === -1) return []; throw new Error('offline') })
    await boot(api, clock)
    await until(() => expect(bot.status().state).toBe('error'))
    expect(poll).toHaveBeenCalledTimes(2)
    await clock.advance(999); expect(poll).toHaveBeenCalledTimes(2)
    await clock.advance(1); await until(() => expect(poll).toHaveBeenCalledTimes(3))
    await clock.advance(1999); expect(poll).toHaveBeenCalledTimes(3)
    await clock.advance(1); await until(() => expect(poll).toHaveBeenCalledTimes(4))
    await clock.advance(3999); expect(poll).toHaveBeenCalledTimes(4)
    await clock.advance(1); await until(() => expect(poll).toHaveBeenCalledTimes(5))
    await expect(bot.stop()).resolves.toBeUndefined()
  })
  it('명령과 잘못된 콜백에도 적절히 응답한다', async () => {
    const actions = await boot(); const resume = vi.spyOn(actions, 'resume')
    fake.send('/help'); await until(() => expect(fake.sentTexts().at(-1)).toContain('/tasks'))
    fake.send('/tasks'); await until(() => expect(fake.sentTexts().at(-1)).toContain('태스크가 없습니다'))
    fake.send('/report'); await until(() => expect(fake.sentTexts().at(-1)).toContain('보고서가 아직'))
    fake.send('/ask'); await until(() => expect(fake.sentTexts().at(-1)).toContain('사용법: /ask'))
    fake.send('/resume'); await until(() => expect(resume).toHaveBeenCalledTimes(1))
    fake.pushUpdate({ callback_query: { id: 'unknown', from: { id: 42 }, message: { message_id: 999, chat: { id: 42 } }, data: 'invalid' } })
    await until(() => expect(fake.lastSent('answerCallbackQuery').body).toMatchObject({ callback_query_id: 'unknown', text: '알 수 없는 버튼' }))
  })
  it('알림과 질의 결과의 비밀값은 최종 전송 경계에서 치환된다', async () => {
    const actions = await boot(); vi.spyOn(actions, 'ask').mockResolvedValue(`bot${fake.token} chat=${fake.chatId}`)
    await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', payload: { reason: 'workflow_error', detail: `bot${fake.token} chat=${fake.chatId}` } })
    await until(() => expect(fake.sentTexts()).toHaveLength(1))
    expect(fake.sentTexts()[0]).not.toContain(fake.token)
    expect(fake.sentTexts()[0]).not.toContain(`chat=${fake.chatId}`)
    fake.send('/ask 상태?'); await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    fake.tap('ask'); await until(() => expect(fake.sentTexts().some(text => text.includes('bot***'))).toBe(true))
    for (const text of fake.sentTexts()) expect(text).not.toContain(fake.token)
  })
  it('자세히는 최신 회차 캡처 한 장만 보내며 경로 이탈은 거부한다', async () => {
    await boot(); const e = await human()
    const evidence = join(wf.store.paths.evidence, 't1', 'r2')
    await fs.mkdir(evidence, { recursive: true })
    await fs.writeFile(join(evidence, 'one.png'), PNG_1X1)
    await fs.writeFile(join(evidence, 'manifest.json'), JSON.stringify([{ scenarioId: 's', steps: [{ screenshot: 'one.png' }, { screenshot: 'one.png' }] }]))
    fake.tap('detail'); await until(() => expect(fake.calls.filter(c => c.method === 'sendPhoto')).toHaveLength(1))
    await fs.writeFile(join(wf.store.paths.raw, 'outside.png'), PNG_1X1)
    await fs.writeFile(join(evidence, 'manifest.json'), JSON.stringify([{ steps: [{ screenshot: '../../../../raw/outside.png' }] }]))
    fake.tap('detail'); await until(() => expect(fake.calls.filter(c => c.method === 'answerCallbackQuery')).toHaveLength(2))
    expect(fake.calls.filter(c => c.method === 'sendPhoto')).toHaveLength(1)
    await fs.symlink(wf.store.paths.raw, join(evidence, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await fs.writeFile(join(evidence, 'manifest.json'), JSON.stringify([{ steps: [{ screenshot: 'linked/outside.png' }] }]))
    fake.tap('detail'); await until(() => expect(fake.calls.filter(c => c.method === 'answerCallbackQuery')).toHaveLength(3))
    expect(fake.calls.filter(c => c.method === 'sendPhoto')).toHaveLength(1)
    const latest = join(wf.store.paths.evidence, 't1', 'r10')
    await fs.mkdir(latest); await fs.writeFile(join(latest, 'latest.png'), PNG_1X1)
    await fs.writeFile(join(latest, 'manifest.json'), JSON.stringify([{ steps: [{ screenshot: 'latest.png' }] }]))
    fake.tap('detail'); await until(() => expect(fake.calls.filter(c => c.method === 'sendPhoto')).toHaveLength(2))
    expect(fake.lastSent('sendPhoto').body.caption).toBe('t1 · r10')
    expect(e.id).toMatch(/^msg-/)
  })
  it('Bot API 장애 시 이벤트 발행은 지연되지 않고 오류에서 비밀값을 숨긴다', async () => {
    await boot(); await fake.close()
    const start = Date.now()
    await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', payload: { reason: 'auth' } })
    expect(Date.now() - start).toBeLessThan(150)
    await until(() => expect(bot.status().state).toBe('error'))
    expect(bot.status().lastError).not.toContain(fake.token)
  })
  it('멈춘 동작이 polling을 막지 않아 이어지는 /status에 답하고 stop도 끝난다', async () => {
    const actions = await boot()
    const answer = vi.spyOn(actions, 'answer').mockImplementation(() => new Promise(() => {}))
    const e = await human()
    fake.tap('guide'); await until(() => expect(fake.lastSent('sendMessage').body.reply_markup?.force_reply).toBe(true))
    fake.replyToLast('지침'); await until(() => expect(answer).toHaveBeenCalledWith(e.id, expect.anything()))
    fake.send('/status'); await until(() => expect(fake.sentTexts().at(-1)).toContain('주의'))
    const started = Date.now()
    await bot.stop()
    expect(Date.now() - started).toBeLessThan(4000)
  })
  it('재시작 후에도 이전 지침 프롬프트에 대한 답장은 해당 이벤트 지침이 된다', async () => {
    await boot(); const e = await human()
    fake.tap('guide'); await until(() => expect(fake.lastSent('sendMessage').body.reply_markup?.force_reply).toBe(true))
    detach?.(); await bot.stop(); vi.restoreAllMocks()
    const actions = await boot(); const answer = vi.spyOn(actions, 'answer')
    fake.replyToLast('재시작 뒤 지침')
    await until(() => expect(answer).toHaveBeenCalledWith(e.id, { action: 'guidance', text: '재시작 뒤 지침' }))
  })
  it('처리됨 줄에는 해당 요청을 해결한 GUIDANCE 이벤트 id가 표시된다', async () => {
    await boot(); const e = await human()
    fake.tap('guide'); await until(() => expect(fake.lastSent('sendMessage').body.reply_markup?.force_reply).toBe(true))
    fake.replyToLast('지침')
    await until(() => expect(fake.lastSent('editMessageText').body.text).toContain('처리됨 ✓'))
    const g = (await wf.store.readEvents()).find(ev => ev.type === 'GUIDANCE' && (ev.payload as any).resolves === e.id)!
    expect(fake.lastSent('editMessageText').body.text).toContain(`처리됨 ✓ · ${g.id}`)
  })
  it('재시작 후 확인 메시지의 취소는 원래 알림 문구와 버튼을 복원한다', async () => {
    await boot(); await human()
    const original = fake.calls.filter(call => call.method === 'sendMessage').at(-1)!.body.text
    fake.tap('skip'); await until(() => expect(lastButtons()).toContain('취소'))
    detach?.(); await bot.stop(); await boot()
    fake.tap('cancel')
    await until(() => expect(lastButtons()).toEqual(['지침 쓰기', '건너뛰기', '자세히']))
    expect(fake.lastSent('editMessageText').body.text).toContain(original)
  })
  it('개인 채팅에서는 다른 사용자의 메시지·콜백을 무시한다', async () => {
    await boot(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fake.pushUpdate({ message: { message_id: 1, chat: { id: 42 }, from: { id: 7 }, text: '/status' } })
    fake.pushUpdate({ callback_query: { id: 'other-user', from: { id: 7 }, message: { message_id: 1, chat: { id: 42 } }, data: 'r' } })
    fake.send('/status'); await until(() => expect(fake.sentTexts().at(-1)).toContain('주의'))
    expect(fake.calls.filter(c => c.method === 'sendMessage')).toHaveLength(1)
    expect(fake.calls.filter(c => c.method === 'answerCallbackQuery')).toHaveLength(0)
    warn.mockRestore()
  })
  it('/ask 답변은 30줄로 자르고 안내를 붙인다', async () => {
    const actions = await boot()
    vi.spyOn(actions, 'ask').mockResolvedValue(Array.from({ length: 45 }, (_, n) => `줄${n + 1}`).join('\n'))
    fake.send('/ask 상태?'); await until(() => expect(fake.lastSent('sendMessage').body.text).toContain('사용량'))
    fake.tap('ask'); await until(() => expect(fake.sentTexts()).toContain('처리됨 ✓ · 로그 질의'))
    const sent = fake.sentTexts().find(t => t.startsWith('줄1'))!
    expect(sent).toContain('줄30'); expect(sent).not.toContain('줄31'); expect(sent.endsWith('…(대시보드에서 보기)')).toBe(true)
  })
})
