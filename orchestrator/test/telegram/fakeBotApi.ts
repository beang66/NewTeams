import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TgUpdate, TgMessage } from '../../src/telegram/botApi.js'
import { decodeCallback, type Callback } from '../../src/telegram/callbacks.js'

export interface FakeBotApi {
  base: string; token: string; chatId: string; calls: { method: string; body: any }[]
  pushUpdate(u: Omit<TgUpdate, 'update_id'>): void
  failNext(status: number, body?: object): void
  lastSent(method: string): { method: string; body: any }
  sentTexts(): string[]
  tap(kind: Callback['kind']): void
  replyToLast(text: string): void
  send(text: string): void
  close(): Promise<void>
}

export async function startFakeBotApi(): Promise<FakeBotApi> {
  const token = '123456:FAKE-token_abcdefghijklmnopqrstu'
  const chatId = '42'
  const calls: { method: string; body: any }[] = []
  const updates: TgUpdate[] = []
  const failures: { status: number; body: object }[] = []
  const sent = new Map<number, TgMessage>()
  let lastWithButtons: TgMessage | undefined
  let lastMessage: TgMessage | undefined
  let nextUpdateId = 1
  let nextMessageId = 100

  async function readBody(req: http.IncomingMessage): Promise<{ body: any }> {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const buf = Buffer.concat(chunks)
    const ct = req.headers['content-type'] ?? ''
    if (ct.startsWith('multipart/form-data')) {
      const form = await new Response(buf, { headers: { 'content-type': ct } }).formData()
      const body: any = {}
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') body[k] = v
        else body.photoBytes = (await v.arrayBuffer()).byteLength
      }
      return { body }
    }
    return { body: buf.length ? JSON.parse(buf.toString('utf8')) : {} }
  }

  function makeMessage(body: any): TgMessage {
    const m: any = { message_id: nextMessageId++, chat: { id: Number(body.chat_id) }, text: body.text }
    if (body.reply_markup) m.reply_markup = body.reply_markup
    return m as TgMessage
  }

  const server = http.createServer(async (req, res) => {
    const reply = (status: number, obj: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url ?? '')
    if (!m || m[1] !== token) return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' })
    const method = m[2]!
    const { body } = await readBody(req)
    calls.push({ method, body })
    const fail = failures.shift()
    if (fail) return reply(fail.status, fail.body)
    switch (method) {
      case 'getUpdates': {
        const offset = Number(body.offset ?? 0)
        const result = offset === -1 ? updates.slice(-1) : updates.filter(u => u.update_id >= offset)
        return reply(200, { ok: true, result })
      }
      case 'sendMessage': {
        const msg = makeMessage(body)
        sent.set(msg.message_id, msg); lastMessage = msg
        if (body.reply_markup?.inline_keyboard) lastWithButtons = msg
        return reply(200, { ok: true, result: msg })
      }
      case 'editMessageText': {
        const msg = makeMessage(body)
        msg.message_id = Number(body.message_id)
        sent.set(msg.message_id, msg)
        if (body.reply_markup?.inline_keyboard) lastWithButtons = msg
        return reply(200, { ok: true, result: msg })
      }
      case 'getMe': return reply(200, { ok: true, result: { id: 1, is_bot: true, username: 'fake_bot' } })
      default: return reply(200, { ok: true, result: true })
    }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port

  const push = (u: Omit<TgUpdate, 'update_id'>) => { updates.push({ ...u, update_id: nextUpdateId++ } as TgUpdate) }
  const from = { id: Number(chatId) }

  return {
    base: `http://127.0.0.1:${port}`, token, chatId, calls,
    pushUpdate: push,
    failNext(status, body) { failures.push({ status, body: body ?? { ok: false, error_code: status, description: 'failed' } }) },
    lastSent(method) {
      const c = [...calls].reverse().find(x => x.method === method)
      if (!c) throw new Error(`no ${method} call`)
      return c
    },
    sentTexts: () => calls.filter(c => c.method === 'sendMessage' || c.method === 'editMessageText').map(c => c.body.text),
    tap(kind) {
      if (!lastWithButtons) throw new Error('no message with buttons')
      const rows: { callback_data?: string }[][] = (lastWithButtons as any).reply_markup.inline_keyboard
      const btn = rows.flat().find(b => b.callback_data && decodeCallback(b.callback_data)?.kind === kind)
      if (!btn) throw new Error(`no button of kind ${kind}`)
      push({ callback_query: { id: `cb${nextUpdateId}`, from, message: lastWithButtons, data: btn.callback_data } })
    },
    replyToLast(text) {
      if (!lastMessage) throw new Error('no message sent')
      push({ message: { message_id: nextMessageId++, chat: { id: Number(chatId) }, from, text, reply_to_message: lastMessage } })
    },
    send(text) { push({ message: { message_id: nextMessageId++, chat: { id: Number(chatId) }, from, text } }) },
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()) }),
  }
}
