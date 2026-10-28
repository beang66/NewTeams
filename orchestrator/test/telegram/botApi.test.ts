import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotApi, TelegramApiError } from '../../src/telegram/botApi.js'
import { encodeCallback } from '../../src/telegram/callbacks.js'
import { startFakeBotApi, type FakeBotApi } from './fakeBotApi.js'

let fake: FakeBotApi
let api: BotApi
let slept: number[]
const msg = (text: string) => ({ message_id: 1, chat: { id: 42 }, text })

beforeEach(async () => {
  fake = await startFakeBotApi(); slept = []
  api = new BotApi(fake.token, fake.base, { sleep: async ms => { slept.push(ms) } })
})
afterEach(async () => { await fake.close() })

describe('BotApi', () => {
  it('sendMessage: 무음·버튼·답장 강제가 올바른 필드로', async () => {
    await api.sendMessage('42', '안녕', { silent: true, buttons: [[{ text: '재개', callback_data: 'r' }]], forceReply: false })
    expect(fake.calls.at(-1)).toMatchObject({ method: 'sendMessage', body: { chat_id: '42', text: '안녕', disable_notification: true, reply_markup: { inline_keyboard: [[{ text: '재개', callback_data: 'r' }]] } } })
  })
  it('silent 아니면 disable_notification 생략, replyTo는 reply_parameters', async () => {
    await api.sendMessage('42', 'x', { replyTo: 7 })
    const b = fake.calls.at(-1)!.body
    expect(b).not.toHaveProperty('disable_notification'); expect(b).not.toHaveProperty('parse_mode')
    expect(b.reply_parameters).toEqual({ message_id: 7 })
  })
  it('forceReply', async () => { await api.sendMessage('42', '지침?', { forceReply: true }); expect(fake.calls.at(-1)!.body.reply_markup).toEqual({ force_reply: true, input_field_placeholder: '지침을 입력하세요' }) })
  it('429는 retry_after 후 재시도, 두 번째 429는 throw', async () => {
    fake.failNext(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } })
    await api.sendMessage('42', 'x')
    expect(fake.calls.filter(c => c.method === 'sendMessage')).toHaveLength(2)
    for (let i = 0; i < 2; i++) fake.failNext(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 500 } })
    await expect(api.sendMessage('42', 'y')).rejects.toBeInstanceOf(TelegramApiError)
    expect(slept.at(-1)).toBe(60_000)
  })
  it('에러 메시지에 토큰이 없다', async () => {
    const bad = new BotApi(fake.token, 'http://127.0.0.1:1')
    const err = await bad.getMe().catch(e => e); expect(String(err.message)).not.toContain(fake.token)
    expect(err).toBeInstanceOf(TelegramApiError)
    fake.failNext(400, { ok: false, description: `bad request for bot${fake.token}` })
    const err2 = await api.sendMessage('42', 'x').catch(e => e); expect(String(err2.message)).not.toContain(fake.token)
    expect(err2.message).toContain('bot***')
  })
  it('잘못된 토큰은 401 TelegramApiError', async () => {
    const wrong = new BotApi('1:wrong', fake.base)
    const e = await wrong.getMe().catch(e => e)
    expect(e).toBeInstanceOf(TelegramApiError); expect(e.message).toContain('Unauthorized')
  })
  it('sendPhoto는 multipart로 파일을 보낸다', async () => {
    const pngPath = join(mkdtempSync(join(tmpdir(), 'tg-')), 'a.png'); writeFileSync(pngPath, Buffer.from([1, 2, 3, 4, 5]))
    await api.sendPhoto('42', pngPath, '그림')
    expect(fake.calls.at(-1)).toMatchObject({ method: 'sendPhoto', body: { chat_id: '42', caption: '그림', photoBytes: 5 } })
  })
  it('getUpdates는 offset과 allowed_updates를 보낸다', async () => {
    fake.pushUpdate({ message: msg('/status') })
    const ups = await api.getUpdates(0, 0); expect(ups[0]!.update_id).toBe(1)
    expect(fake.lastSent('getUpdates').body).toMatchObject({ offset: 0, timeout: 0, allowed_updates: ['message', 'callback_query'] })
    fake.pushUpdate({ message: msg('b') })
    expect((await api.getUpdates(2, 0)).map(u => u.update_id)).toEqual([2])
    expect((await api.getUpdates(-1, 0)).map(u => u.update_id)).toEqual([2])
  })
  it('editMessage: 버튼 없으면 reply_markup 없음, not modified는 무시', async () => {
    const m = await api.sendMessage('42', 'a', { buttons: [[{ text: 'x', callback_data: 'r' }]] })
    await api.editMessage('42', m.message_id, 'b')
    const c = fake.lastSent('editMessageText')
    expect(c.body).toMatchObject({ chat_id: '42', message_id: m.message_id, text: 'b' }); expect(c.body).not.toHaveProperty('reply_markup')
    fake.failNext(400, { ok: false, error_code: 400, description: 'Bad Request: message is not modified' })
    await expect(api.editMessage('42', m.message_id, 'b')).resolves.toBeUndefined()
    fake.failNext(400, { ok: false, error_code: 400, description: 'Bad Request: other' })
    await expect(api.editMessage('42', m.message_id, 'b')).rejects.toBeInstanceOf(TelegramApiError)
  })
  it('answerCallback·getMe', async () => {
    await api.answerCallback('cb1', '완료')
    expect(fake.lastSent('answerCallbackQuery').body).toEqual({ callback_query_id: 'cb1', text: '완료' })
    expect(await api.getMe()).toMatchObject({ username: 'fake_bot' })
  })
  it('타임아웃은 TelegramApiError(timeout)', async () => {
    const slow = new BotApi(fake.token, fake.base, { fetchImpl: ((_u: any, init: any) => new Promise((_r, rej) => { init.signal.addEventListener('abort', () => rej(init.signal.reason)) })) as typeof fetch, timeoutMs: 20 })
    const e = await slow.getMe().catch(e => e)
    expect(e).toBeInstanceOf(TelegramApiError); expect(e.message).toContain('timeout')
  })
  it('getUpdates의 429 재시도 대기 중에도 caller abort로 즉시 종료한다', async () => {
    const controller = new AbortController()
    let sleeping = false
    const slow = new BotApi(fake.token, fake.base, {
      fetchImpl: (async () => new Response(JSON.stringify({ ok: false, parameters: { retry_after: 60 } }), { status: 429 })) as typeof fetch,
      sleep: async () => { sleeping = true; await new Promise<void>(() => {}) },
    })
    const result = slow.getUpdates(0, 1, controller.signal).catch(e => e)
    await vi.waitFor(() => expect(sleeping).toBe(true))
    controller.abort()
    expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('still waiting'), 100))])).toMatchObject({ status: 0, message: expect.stringContaining('aborted') })
  })
})

describe('FakeBotApi helpers', () => {
  it('tap·replyToLast·sentTexts', async () => {
    const m = await api.sendMessage('42', '질문', { buttons: [[{ text: '재개', callback_data: encodeCallback({ kind: 'resume' }) }]] })
    fake.tap('resume'); fake.replyToLast('답'); fake.send('/status')
    const ups = await api.getUpdates(0, 0)
    expect(ups[0]!.callback_query).toMatchObject({ data: 'r', from: { id: 42 } })
    expect(ups[1]!.message).toMatchObject({ text: '답', reply_to_message: { message_id: m.message_id } })
    expect(ups[2]!.message!.text).toBe('/status')
    expect(fake.sentTexts()).toEqual(['질문'])
  })
})
