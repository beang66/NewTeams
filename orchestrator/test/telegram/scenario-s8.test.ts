import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assembleServe, installServeShutdown, telegramCheck } from '../../src/cli.js'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { Workflow } from '../../src/engine/workflow.js'
import { listenLocal } from '../../src/server/http.js'
import { BotApi } from '../../src/telegram/botApi.js'
import { fakeDeps, makeScript } from '../fixtures/scripts/common.js'
import { DEADLOCK_SCRIPT } from '../fixtures/scripts/scenarios.js'
import { startFakeBotApi, type FakeBotApi } from './fakeBotApi.js'

let dir: string
let fake: FakeBotApi
let serve: ReturnType<typeof assembleServe> | undefined
const until = async (check: () => void) => vi.waitFor(check, { timeout: 15_000, interval: 20 })
const config = () => ({ ...structuredClone(DEFAULT_CONFIG), vault: { ...DEFAULT_CONFIG.vault, path: null, github: null }, telegram: { ...DEFAULT_CONFIG.telegram, apiBase: fake.base, batchSeconds: 0, pollTimeoutSec: 1 } })
const env = () => ({ TELEGRAM_BOT_TOKEN: fake.token, TELEGRAM_CHAT_ID: fake.chatId })

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orch-tg-s8-'))
  fake = await startFakeBotApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  await serve?.app.close(); serve = undefined
  await fake.close()
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 })
  vi.restoreAllMocks()
})

describe('CLI Telegram assembly', { timeout: 30_000 }, () => {
  it('S8: 실제 교착 알림 → 자세히 → 지침 답장 → DONE → /status', async () => {
    const deps = fakeDeps(DEADLOCK_SCRIPT(4))
    const wf = await Workflow.open(dir, deps)
    serve = assembleServe(config(), wf, env())
    await listenLocal(serve.app, 0)
    await until(() => expect(serve!.bot!.status().state).toBe('connected'))
    expect(console.log).toHaveBeenCalledWith('텔레그램: @fake_bot 연결됨')
    expect((await serve.app.inject('/api/telegram')).json()).toMatchObject({ state: 'connected', botUsername: 'fake_bot' })
    await serve.app.inject({ method: 'POST', url: '/api/chat', payload: { message: '할 일 앱' } })
    expect((await serve.app.inject({ method: 'POST', url: '/api/spec/approve' })).statusCode).toBe(204)
    expect((await serve.app.inject({ method: 'POST', url: '/api/pipeline/start' })).statusCode).toBe(204)
    await until(() => expect(fake.sentTexts().some(t => t.startsWith('🔴 t1 사람 필요'))).toBe(true))
    const guidance = (await wf.store.readEvents()).find(e => e.type === 'GUIDANCE' && e.from === 'master')!
    expect(guidance).toBeDefined()
    fake.tap('detail')
    await until(() => expect(fake.sentTexts().some(t => t.includes('마스터 지침:') && t.includes((guidance.payload as { text: string }).text))).toBe(true))
    fake.tap('guide')
    await until(() => expect(fake.lastSent('sendMessage').body.reply_markup?.force_reply).toBe(true))
    fake.replyToLast('입력값은 trim 후 검사')
    await until(() => expect(wf.state().stage).toBe('DONE'))
    expect(deps.claude.calls.filter(c => c.role === 'dev').at(-1)!.prompt).toContain('입력값은 trim 후 검사')
    await until(() => expect(fake.sentTexts().some(t => t.startsWith('✅ 완료'))).toBe(true))
    fake.send('/status')
    await until(() => expect(fake.sentTexts().at(-1)).toContain('완료'))
  })

  it('환경 변수 없으면 HTTP는 정상이고 봇/API 없이 꺼짐을 출력한다', async () => {
    const wf = await Workflow.open(dir, fakeDeps(makeScript()))
    serve = assembleServe(config(), wf, {})
    await listenLocal(serve.app, 0)
    expect(serve.bot).toBeUndefined()
    expect((await serve.app.inject('/api/telegram')).json()).toEqual({ state: 'off' })
    expect((await serve.app.inject('/api/state')).statusCode).toBe(200)
    expect(console.log).toHaveBeenCalledWith('텔레그램: 꺼짐 (환경 변수 없음)')
    expect(fake.calls).toEqual([])
  })

  it('getMe 대기 중에도 HTTP가 듣고 close는 polling 시작을 중단한다', async () => {
    const wf = await Workflow.open(dir, fakeDeps(makeScript()))
    const api = new BotApi(fake.token, fake.base)
    const getMe = vi.spyOn(api, 'getMe').mockImplementation(signal => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    serve = assembleServe(config(), wf, env(), { api })
    await listenLocal(serve.app, 0)
    expect(getMe).toHaveBeenCalledOnce()
    expect((await serve.app.inject('/api/state')).statusCode).toBe(200)
    await serve.app.close()
    expect(fake.calls).toEqual([])
  })

  it('서버 close는 signal 핸들러와 알림 구독을 해제하고 봇을 정지한다', async () => {
    const wf = await Workflow.open(dir, fakeDeps(makeScript()))
    const before = { interrupt: process.listenerCount('SIGINT'), terminate: process.listenerCount('SIGTERM') }
    serve = assembleServe(config(), wf, env())
    installServeShutdown(serve.app)
    await listenLocal(serve.app, 0)
    await until(() => expect(serve!.bot!.status().state).toBe('connected'))
    const stop = vi.spyOn(serve.bot!, 'stop')
    expect(process.listenerCount('SIGINT')).toBe(before.interrupt + 1)
    expect(process.listenerCount('SIGTERM')).toBe(before.terminate + 1)
    await serve.app.close()
    expect(stop).toHaveBeenCalledOnce()
    expect(process.listenerCount('SIGINT')).toBe(before.interrupt)
    expect(process.listenerCount('SIGTERM')).toBe(before.terminate)
    const calls = fake.calls.length
    await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', payload: { reason: 'auth' } })
    await new Promise(resolve => setTimeout(resolve, 75))
    expect(fake.calls).toHaveLength(calls)
  })

  it('API 실패도 HTTP를 막지 않고 상태와 로그에서 비밀값을 지운다', async () => {
    const wf = await Workflow.open(dir, fakeDeps(makeScript()))
    const api = new BotApi(fake.token, fake.base)
    vi.spyOn(api, 'getMe').mockRejectedValue(new Error(`bot${fake.token} chat=${fake.chatId}`))
    serve = assembleServe(config(), wf, env(), { api })
    await listenLocal(serve.app, 0)
    await until(() => expect(serve!.bot!.status().state).toBe('error'))
    const response = await serve.app.inject('/api/telegram')
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain(fake.token)
    expect(response.body).not.toContain(`chat=${fake.chatId}`)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(fake.token)
  })

  it('telegram-check는 getMe와 연결 확인 한 건만 전송한다', async () => {
    await telegramCheck(config(), env())
    expect(fake.calls.map(c => c.method)).toEqual(['getMe', 'sendMessage'])
    expect(fake.lastSent('sendMessage').body).toMatchObject({ chat_id: fake.chatId, text: '연결 확인 ✓' })
    expect(console.log).toHaveBeenCalledWith('텔레그램: @fake_bot 연결됨')
  })

  it('telegram-check는 불완전한 환경 변수를 거부하고 API 오류를 가린다', async () => {
    await expect(telegramCheck(config(), { TELEGRAM_BOT_TOKEN: fake.token })).rejects.toThrow('TELEGRAM_BOT_TOKEN과 TELEGRAM_CHAT_ID')
    expect(fake.calls).toEqual([])
    const api = new BotApi(fake.token, fake.base)
    vi.spyOn(api, 'getMe').mockRejectedValue(new Error(`bot${fake.token} chat=${fake.chatId}`))
    const error = await telegramCheck(config(), env(), { api }).catch(e => e as Error)
    if (!(error instanceof Error)) throw new Error('telegram-check가 실패해야 합니다')
    expect(error.message).not.toContain(fake.token)
    expect(error.message).not.toContain(`chat=${fake.chatId}`)
    expect(fake.calls).toEqual([])
  })
})
