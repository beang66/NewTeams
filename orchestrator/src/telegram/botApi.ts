import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { redact } from './env.js'

export interface TgMessage { message_id: number; chat: { id: number }; from?: { id: number }; text?: string; reply_to_message?: TgMessage; reply_markup?: { inline_keyboard?: InlineButton[][] } }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: { id: string; from: { id: number }; message?: TgMessage; data?: string } }
export type InlineButton = { text: string; callback_data?: string; url?: string }

export class TelegramApiError extends Error {
  constructor(readonly method: string, readonly status: number, description: string) {
    super(`telegram ${method} ${status}: ${description}`)
    this.name = 'TelegramApiError'
  }
}

export interface BotApiOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** 일반 메서드 타임아웃(ms). 기본 15000. getUpdates는 항상 timeoutSec+10초. */
  timeoutMs?: number
}

const MAX_RETRY_AFTER_SEC = 60

export class BotApi {
  private readonly fetchImpl: typeof fetch
  private readonly sleep?: (ms: number) => Promise<void>
  private readonly timeoutMs: number

  constructor(private readonly token: string, private readonly apiBase: string, opts: BotApiOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleep = opts.sleep
    this.timeoutMs = opts.timeoutMs ?? 15_000
  }

  private fail(method: string, status: number, description: string): TelegramApiError {
    return new TelegramApiError(method, status, redact(description, this.token))
  }

  private async call<T>(method: string, payload: Record<string, unknown> | FormData, timeoutMs = this.timeoutMs, signal?: AbortSignal): Promise<T> {
    const url = `${this.apiBase}/bot${this.token}/${method}`
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs)
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
      let res: Response
      try {
        const init: RequestInit = payload instanceof FormData
          ? { method: 'POST', body: payload, signal: sig }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: sig }
        res = await this.fetchImpl(url, init)
      } catch (e) {
        if (timeout.aborted) throw this.fail(method, 0, 'timeout')
        if (signal?.aborted) throw this.fail(method, 0, 'aborted')
        const err = e as Error & { cause?: { message?: string } }
        throw this.fail(method, 0, err.cause?.message ?? err.message ?? String(e))
      }
      let data: { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } | undefined
      try { data = await res.json() as typeof data } catch {
        if (signal?.aborted) throw this.fail(method, 0, 'aborted')
        if (timeout.aborted) throw this.fail(method, 0, 'timeout')
        data = undefined
      }
      if (res.status === 429 && attempt === 0) {
        const sec = Math.min(Math.max(Number(data?.parameters?.retry_after) || 0, 0), MAX_RETRY_AFTER_SEC)
        await this.retryDelay(method, sec * 1000, signal)
        continue
      }
      if (!res.ok || !data?.ok) throw this.fail(method, res.status, data?.description ?? `HTTP ${res.status}`)
      return data.result as T
    }
  }

  private async retryDelay(method: string, ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw this.fail(method, 0, 'aborted')
    let timer: ReturnType<typeof setTimeout> | undefined
    let interrupt!: () => void
    const aborted = new Promise<never>((_resolve, reject) => { interrupt = () => reject(this.fail(method, 0, 'aborted')) })
    signal?.addEventListener('abort', interrupt, { once: true })
    const delay = this.sleep ? this.sleep(ms) : new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })
    try { await Promise.race([delay, aborted]) } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', interrupt)
    }
  }

  getUpdates(offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] }, (timeoutSec + 10) * 1000, signal)
  }

  sendMessage(chatId: string, text: string, o: { silent?: boolean; buttons?: InlineButton[][]; forceReply?: boolean; replyTo?: number } = {}): Promise<TgMessage> {
    const body: Record<string, unknown> = { chat_id: chatId, text }
    if (o.silent) body.disable_notification = true
    if (o.replyTo !== undefined) body.reply_parameters = { message_id: o.replyTo }
    if (o.forceReply) body.reply_markup = { force_reply: true, input_field_placeholder: '지침을 입력하세요' }
    else if (o.buttons) body.reply_markup = { inline_keyboard: o.buttons }
    return this.call<TgMessage>('sendMessage', body)
  }

  async editMessage(chatId: string, messageId: number, text: string, buttons?: InlineButton[][]): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text }
    if (buttons) body.reply_markup = { inline_keyboard: buttons }
    try { await this.call('editMessageText', body) } catch (e) {
      if (e instanceof TelegramApiError && e.message.includes('message is not modified')) return
      throw e
    }
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    const body: Record<string, unknown> = { callback_query_id: callbackId }
    if (text !== undefined) body.text = text
    await this.call('answerCallbackQuery', body)
  }

  async sendPhoto(chatId: string, filePath: string, caption?: string): Promise<void> {
    const form = new FormData()
    form.append('chat_id', chatId)
    if (caption) form.append('caption', caption)
    form.append('photo', new Blob([new Uint8Array(await readFile(filePath))]), basename(filePath))
    await this.call('sendPhoto', form)
  }

  getMe(signal?: AbortSignal): Promise<{ username: string }> {
    return this.call<{ username: string }>('getMe', {}, this.timeoutMs, signal)
  }
}
