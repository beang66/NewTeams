import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { systemClock, type Clock } from '../clock.js'
import type { TelegramConfig } from '../config.js'
import type { Workflow } from '../engine/workflow.js'
import type { Envelope } from '../protocol/messages.js'
import { PlanSchema } from '../protocol/plan.js'
import { ActionConflict, type TelegramStatus, type WorkflowActions } from '../server/actions.js'
import type { Notifier } from '../server/notifier.js'
import { BotApi, type InlineButton, type TgMessage, type TgUpdate } from './botApi.js'
import { decodeCallback, encodeCallback, type Callback } from './callbacks.js'
import { redact, type TelegramSecrets } from './env.js'
import { clip, detailText, messageForEvent, reportSummary, sanitizeTelegramText, statusText, tasksText, type FormatContext, type OutMessage } from './format.js'
import { Outbox } from './outbox.js'

interface Dependencies {
  secrets: TelegramSecrets
  cfg: TelegramConfig
  wf: Workflow
  actions: WorkflowActions
  clock: Clock
  api?: BotApi
}
interface Notice { id: number; message: OutMessage }
interface Question { text: string; expiresAt: number; messageId: number }
type Confirmation = { kind: 'skip'; eventId: string } | { kind: 'approve' }
const STOP_GRACE_MS = 2000
const ASK_MAX_LINES = 30
const HELP = '/status 상태 · /tasks 태스크 · /report 보고서 · /resume 재개 · /ask <질문> 로그 질의'

/** Long-polling 어댑터. 워크플로 동작은 HTTP와 같은 actions 인스턴스를 사용한다. */
export class TelegramBot implements Notifier {
  private readonly api: BotApi
  private readonly outbox: Outbox
  private readonly abort = new AbortController()
  private readonly notices = new Map<string, Notice>()
  private readonly messages = new Map<number, OutMessage>()
  private readonly inflight = new Set<Promise<void>>()
  private stopping?: Promise<void>
  private readonly confirmations = new Map<number, Confirmation>()
  private readonly questions = new Map<string, Question>()
  private readonly warnedChats = new Set<string>()
  private connection: TelegramStatus = { state: 'connecting' }
  private polling?: Promise<void>
  private starting?: Promise<void>
  private offset = 0
  private initialized = false

  constructor(private readonly deps: Dependencies) {
    this.api = deps.api ?? new BotApi(deps.secrets.token, deps.cfg.apiBase)
    this.outbox = new Outbox(deps.cfg, deps.clock, message => this.sendNotice(message))
  }

  start(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = this.begin()
    return this.starting
  }

  stop(): Promise<void> {
    this.stopping ??= this.shutdown()
    return this.stopping
  }

  private async shutdown(): Promise<void> {
    this.abort.abort()
    await this.starting
    await this.polling
    // 진행 중인 동작(사람 대기 등)은 잠깐만 기다리고 놓아 준다. 종료가 영원히 막히면 안 된다.
    if (this.inflight.size > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([Promise.allSettled([...this.inflight]), new Promise<void>(resolve => { timer = setTimeout(resolve, STOP_GRACE_MS) })])
      if (timer) clearTimeout(timer)
    }
    this.outbox.stop()
    await this.outbox.flush()
  }

  status(): TelegramStatus { return { ...this.connection } }

  async notify(event: Envelope): Promise<void> {
    if (this.abort.signal.aborted) return
    try {
      const message = messageForEvent(event, await this.context())
      if (message) this.outbox.push(message)
    } catch (error) { this.logError(error) }
  }

  private async begin(): Promise<void> {
    if (this.abort.signal.aborted) return
    try { await this.initialize() } catch (error) { if (!this.abort.signal.aborted) this.fail(error) }
    if (!this.abort.signal.aborted) this.polling = this.poll()
  }

  private async initialize(): Promise<void> {
    const me = await this.api.getMe(this.abort.signal)
    if (this.abort.signal.aborted) return
    const checkpoint = await readOptional(join(this.deps.wf.store.paths.raw, 'telegram-offset.json'))
    if (checkpoint !== null) {
      const parsed: unknown = JSON.parse(checkpoint)
      const offset = (parsed as { offset?: unknown })?.offset
      if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('텔레그램 offset 파일 형식 오류')
      this.offset = offset
    } else {
      const latest = await this.api.getUpdates(-1, 0, this.abort.signal)
      this.offset = Math.max(0, ...latest.map(update => update.update_id + 1))
      await this.saveOffset(this.offset)
    }
    this.initialized = true
    this.ok(me.username)
  }

  private async poll(): Promise<void> {
    let retryMs = 1000
    while (!this.abort.signal.aborted) {
      try {
        if (!this.initialized) await this.initialize()
        if (this.abort.signal.aborted) break
        const updates = await this.api.getUpdates(this.offset, this.deps.cfg.pollTimeoutSec, this.abort.signal)
        this.ok()
        retryMs = 1000
        for (const update of updates) {
          if (this.abort.signal.aborted) break
          if (!Number.isSafeInteger(update.update_id) || update.update_id < this.offset) continue
          // 사용량 동작은 재실행하지 않는다. 체크포인트 직후 종료된 명령은 사용자가 다시 입력한다.
          await this.saveOffset(update.update_id + 1)
          this.dispatch(update)
        }
        // 테스트 서버처럼 빈 long-poll이 즉시 끝나도 CPU를 점유하지 않는다.
        if (updates.length === 0) await this.wait(50)
      } catch (error) {
        if (this.abort.signal.aborted) break
        this.fail(error)
        await this.wait(retryMs)
        retryMs = Math.min(retryMs * 2, 60_000)
      }
    }
  }

  /** 동작은 polling 루프 밖에서 실행한다. 게이트 대기 중에도 /status, /resume을 받아야 한다. */
  private dispatch(update: TgUpdate): void {
    const task: Promise<void> = this.handleUpdate(update).catch(error => this.logError(error)).finally(() => { this.inflight.delete(task) })
    this.inflight.add(task)
  }

  private async handleUpdate(update: TgUpdate): Promise<void> {
    const callback = update.callback_query
    const message = callback?.message ?? update.message
    if (!message || !this.allowed(message, callback ? callback.from?.id : message.from?.id)) return
    if (callback) {
      let answer: string | undefined
      let acknowledged = false
      try {
        const action = decodeCallback(callback.data ?? '')
        if (action?.kind === 'ask') {
          const question = this.questions.get(action.key)
          if (question && question.messageId === message.message_id && question.expiresAt > this.deps.clock.now().getTime()) {
            await this.api.answerCallback(callback.id, '실행 중')
            acknowledged = true
          }
        }
        if (!action) answer = '알 수 없는 버튼'
        else answer = await this.handleCallback(action, message)
      } catch (error) {
        if (error instanceof ActionConflict) {
          answer = '이미 처리됨'
          await this.markProcessed(message, answer)
        } else {
          answer = '처리 실패'
          await this.reply(`처리 실패: ${this.safeError(error)}`)
        }
      } finally { if (!acknowledged) await this.api.answerCallback(callback.id, answer) }
      return
    }
    try { await this.handleMessage(message) } catch (error) {
      if (error instanceof ActionConflict) {
        const id = guidanceTarget(message)
        if (id) await this.markEvent(id, '이미 처리됨')
        await this.reply('이미 처리됨')
      } else await this.reply(`처리 실패: ${this.safeError(error)}`)
    }
  }

  private allowed(message: TgMessage, fromId: number | undefined): boolean {
    const id = String(message.chat.id)
    if (id === this.deps.secrets.chatId) {
      // 개인 채팅(양수 id)은 보낸 사람도 같은 id여야 한다. 그룹(음수 id)은 채팅 단위로만 확인한다.
      const owner = Number(this.deps.secrets.chatId)
      return !(owner > 0) || fromId === owner
    }
    if (!this.warnedChats.has(id)) {
      this.warnedChats.add(id)
      console.warn(`텔레그램: 허용되지 않은 채팅 ${id}`)
    }
    return false
  }

  private async handleCallback(action: Callback, message: TgMessage): Promise<string | undefined> {
    switch (action.kind) {
      case 'guide': {
        await this.rememberSourceNotice(action.eventId, message)
        this.requireOpenHuman(action.eventId)
        await this.api.sendMessage(this.deps.secrets.chatId, `지침을 이 메시지에 답장으로 보내 주세요 · ${action.eventId}`, { forceReply: true })
        return
      }
      case 'skip':
        await this.rememberSourceNotice(action.eventId, message)
        this.requireOpenHuman(action.eventId)
        this.confirmations.set(message.message_id, { kind: 'skip', eventId: action.eventId })
        await this.confirm(message, '정말 건너뛰기', { kind: 'skipConfirm', eventId: action.eventId })
        return
      case 'skipConfirm': {
        const confirmation = this.confirmations.get(message.message_id)
        if (confirmation?.kind !== 'skip' || confirmation.eventId !== action.eventId) return '확인이 만료됐습니다'
        await this.deps.actions.answer(action.eventId, { action: 'skip', text: '텔레그램에서 건너뛰기' })
        await this.markEvent(action.eventId, '처리됨 ✓ · 건너뛰기')
        return '처리됨 ✓'
      }
      case 'approve':
        this.confirmations.set(message.message_id, { kind: 'approve' })
        await this.confirm(message, '정말 승인', { kind: 'approveConfirm' })
        return
      case 'approveConfirm':
        if (this.confirmations.get(message.message_id)?.kind !== 'approve') return '확인이 만료됐습니다'
        await this.deps.actions.approveSpec()
        await this.markProcessed(message, '처리됨 ✓ · 스펙 승인')
        return '처리됨 ✓'
      case 'cancel': {
        this.confirmations.delete(message.message_id)
        for (const [key, question] of this.questions) if (question.messageId === message.message_id) this.questions.delete(key)
        const original = await this.originalOf(message)
        if (original?.eventId && original.kind === 'human' && !this.deps.wf.state().humanRequired.includes(original.eventId)) throw new ActionConflict('이미 처리됨')
        if (original?.kind === 'spec' && this.deps.wf.state().stage !== 'INTAKE') throw new ActionConflict('이미 처리됨')
        await this.api.editMessage(this.deps.secrets.chatId, message.message_id, this.safeText(original?.text ?? '취소됨'), original ? inlineButtons(original) : [])
        return '취소됨'
      }
      case 'detail':
        await this.reply(detailText(action.eventId, await this.context()))
        await this.sendScreenshot(action.eventId)
        return
      case 'resume':
        await this.deps.actions.resume()
        await this.markProcessed(message, '처리됨 ✓ · 재개')
        return '처리됨 ✓'
      case 'report': {
        const ctx = await this.context()
        await this.reply(reportSummary(ctx.reportMd ?? null, ctx))
        return
      }
      case 'ask': return this.runQuestion(action.key, message)
    }
  }

  private async handleMessage(message: TgMessage): Promise<void> {
    const text = message.text?.trim()
    if (!text) return
    // 재시작 후에도 동작하도록 메모리가 아니라 프롬프트 문구의 이벤트 id로 찾는다.
    const eventId = guidanceTarget(message)
    if (eventId) {
      await this.deps.actions.answer(eventId, { action: 'guidance', text })
      const events = await this.deps.wf.store.readEvents()
      const guidance = events.filter(event => event.type === 'GUIDANCE' && (event.payload as { resolves?: unknown } | undefined)?.resolves === eventId).at(-1)
      await this.markEvent(eventId, `처리됨 ✓ · ${guidance?.id ?? '지침'}`)
      return
    }
    const [command = '', ...words] = text.split(/\s+/)
    const bare = command.split('@')[0]
    switch (bare) {
      case '/start': case '/help': await this.reply(HELP); return
      case '/status': await this.reply(statusText(await this.context())); return
      case '/tasks': await this.reply(tasksText(await this.context())); return
      case '/report': { const ctx = await this.context(); await this.reply(reportSummary(ctx.reportMd ?? null, ctx)); return }
      case '/resume': await this.deps.actions.resume(); await this.reply('처리됨 ✓ · 재개'); return
      case '/ask': await this.confirmQuestion(words.join(' ')); return
      default: if (bare?.startsWith('/')) await this.reply(HELP)
    }
  }

  private async confirmQuestion(question: string): Promise<void> {
    if (!question) { await this.reply('사용법: /ask <질문>'); return }
    this.expireQuestions()
    const key = randomBytes(4).toString('hex')
    const prompt = await this.api.sendMessage(this.deps.secrets.chatId, this.safeText(`로그 질의는 AI 사용량을 씁니다. 실행할까요?\n${question}`), {
      buttons: [[{ text: '실행', callback_data: encodeCallback({ kind: 'ask', key }) }, { text: '취소', callback_data: encodeCallback({ kind: 'cancel' }) }]],
    })
    this.questions.set(key, { text: question, expiresAt: this.deps.clock.now().getTime() + 10 * 60_000, messageId: prompt.message_id })
  }

  private async runQuestion(key: string, message: TgMessage): Promise<string> {
    this.expireQuestions()
    const question = this.questions.get(key)
    if (!question || question.messageId !== message.message_id) return '만료되었거나 이미 처리됨'
    this.questions.delete(key)
    await this.api.editMessage(this.deps.secrets.chatId, message.message_id, '로그 질의 실행 중', [])
    // gate 인증/상한 대기는 /resume으로 풀 수 있어야 하므로 polling과 분리한다.
    void this.finishQuestion(question, message).catch(async error => {
      this.logError(error)
      if (this.abort.signal.aborted) return
      try { await this.reply(`처리 실패: ${this.safeError(error)}`) } catch (sendError) { this.logError(sendError) }
    })
    return '실행 중'
  }

  private async finishQuestion(question: Question, message: TgMessage): Promise<void> {
    const result = await this.deps.actions.ask(question.text)
    if (this.abort.signal.aborted) return
    await this.reply(capLines(sanitizeTelegramText(result), ASK_MAX_LINES))
    if (this.abort.signal.aborted) return
    await this.api.editMessage(this.deps.secrets.chatId, message.message_id, '처리됨 ✓ · 로그 질의', [])
  }

  private expireQuestions(): void {
    const now = this.deps.clock.now().getTime()
    for (const [key, question] of this.questions) if (question.expiresAt <= now) this.questions.delete(key)
  }

  private requireOpenHuman(id: string): void {
    if (!this.deps.wf.state().humanRequired.includes(id)) throw new ActionConflict(`열린 HUMAN_REQUIRED가 아님: ${id}`)
  }

  private async confirm(message: TgMessage, label: string, callback: Callback): Promise<void> {
    await this.api.editMessage(this.deps.secrets.chatId, message.message_id, this.safeText(message.text ?? '확인'), [[
      { text: label, callback_data: encodeCallback(callback) }, { text: '취소', callback_data: encodeCallback({ kind: 'cancel' }) },
    ]])
  }

  /** 원래 알림: 메모리에 없으면(재시작 후) 확인 메시지의 버튼에서 이벤트를 찾아 다시 만든다. */
  private async originalOf(message: TgMessage): Promise<OutMessage | undefined> {
    const known = this.messages.get(message.message_id)
    if (known) return known
    const callbacks = (message.reply_markup?.inline_keyboard ?? []).flat().map(button => decodeCallback(button.callback_data ?? ''))
    const skip = callbacks.find(callback => callback?.kind === 'skipConfirm')
    if (skip?.kind === 'skipConfirm') {
      await this.rememberSourceNotice(skip.eventId, message)
      return this.messages.get(message.message_id)
    }
    if (callbacks.some(callback => callback?.kind === 'approveConfirm')) {
      const ctx = await this.context()
      const event = ctx.events.filter(candidate => candidate.type === 'CHAT' && candidate.from === 'master' && (candidate.payload as { specApprovalRequired?: unknown } | undefined)?.specApprovalRequired === true).at(-1)
      const rebuilt = event ? messageForEvent(event, ctx) : null
      if (rebuilt) { this.messages.set(message.message_id, rebuilt); return rebuilt }
    }
    return undefined
  }

  private async markEvent(eventId: string, result: string): Promise<void> {
    const notice = this.notices.get(eventId)
    if (notice) await this.markProcessed({ message_id: notice.id, chat: { id: Number(this.deps.secrets.chatId) }, text: notice.message.text }, result)
  }

  private async rememberSourceNotice(eventId: string, source: TgMessage): Promise<void> {
    const ctx = await this.context()
    const event = ctx.events.find(candidate => candidate.id === eventId && candidate.type === 'HUMAN_REQUIRED')
    if (!event) return
    const message = messageForEvent(event, ctx)
    if (!message) return
    this.messages.set(source.message_id, message)
    this.notices.set(eventId, { id: source.message_id, message })
  }

  private async markProcessed(message: TgMessage, result: string): Promise<void> {
    const original = this.messages.get(message.message_id)?.text ?? message.text ?? ''
    await this.api.editMessage(this.deps.secrets.chatId, message.message_id, this.safeText(`${original}\n${result}`), [])
  }

  private async sendNotice(message: OutMessage): Promise<void> {
    try {
      const sent = await this.api.sendMessage(this.deps.secrets.chatId, this.safeText(message.text), { silent: message.silent, buttons: inlineButtons(message) })
      this.messages.set(sent.message_id, message)
      if (message.eventId) this.notices.set(message.eventId, { id: sent.message_id, message })
    } catch (error) { this.logError(error); throw error }
  }

  private reply(text: string): Promise<TgMessage> { return this.api.sendMessage(this.deps.secrets.chatId, this.safeText(text)) }

  private async sendScreenshot(eventId: string): Promise<void> {
    const events = await this.deps.wf.store.readEvents()
    const task = events.find(event => event.id === eventId)?.task
    if (!task || !/^[a-z0-9][a-z0-9_-]*$/i.test(task)) return
    try {
      const root = await fs.realpath(this.deps.wf.store.paths.evidence)
      const taskDir = await fs.realpath(join(root, task))
      if (!inside(root, taskDir)) return
      const rounds = (await fs.readdir(taskDir)).filter(name => /^r\d+$/.test(name)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))
      const latest = rounds[0]
      if (!latest) return
      const roundDir = await fs.realpath(join(taskDir, latest))
      if (!inside(taskDir, roundDir)) return
      const manifestPath = await fs.realpath(join(roundDir, 'manifest.json'))
      if (!inside(roundDir, manifestPath)) return
      const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      if (!Array.isArray(manifest)) return
      const steps = manifest.flatMap(scenario => Array.isArray(scenario?.steps) ? scenario.steps : [])
      const screenshot: unknown = steps.at(-1)?.screenshot
      if (typeof screenshot !== 'string' || isAbsolute(screenshot) || !/\.(png|jpe?g|webp)$/i.test(screenshot)) return
      const file = await fs.realpath(resolve(roundDir, screenshot))
      if (!inside(roundDir, file)) return
      if (!(await fs.stat(file)).isFile()) return
      await this.api.sendPhoto(this.deps.secrets.chatId, file, `${task} · ${latest}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.logError(error)
    }
  }

  private async context(): Promise<FormatContext> {
    const paths = this.deps.wf.store.paths
    const [events, planText, spec, report] = await Promise.all([
      this.deps.wf.store.readEvents(), readOptional(paths.plan), readOptional(join(paths.human, 'spec.draft.md')), readOptional(join(paths.human, 'report.md')),
    ])
    let plan = null
    if (planText) { try { const result = PlanSchema.safeParse(JSON.parse(planText)); if (result.success) plan = result.data } catch { /* 계획 생성 도중이면 다음 조회에서 읽는다 */ } }
    return { events, state: this.deps.wf.state(), plan, dashboardUrl: this.deps.cfg.dashboardUrl, specSummary: spec?.split(/\r?\n/), reportMd: report }
  }

  private async saveOffset(offset: number): Promise<void> {
    const file = join(this.deps.wf.store.paths.raw, 'telegram-offset.json')
    await fs.writeFile(`${file}.tmp`, JSON.stringify({ offset }) + '\n')
    await fs.rename(`${file}.tmp`, file)
    this.offset = offset
  }

  private ok(username?: string): void {
    this.connection = { state: 'connected', ...(username || this.connection.botUsername ? { botUsername: username ?? this.connection.botUsername } : {}), lastOkAt: this.deps.clock.now().toISOString() }
  }

  private fail(error: unknown): void { this.connection = { ...this.connection, state: 'error', lastError: this.safeError(error) }; this.logError(error) }
  private safeError(error: unknown): string { return redact(error instanceof Error ? error.message : String(error), this.deps.secrets.token).split(this.deps.secrets.chatId).join('[chat]') }
  private safeText(text: string): string { return clip(sanitizeTelegramText(redact(text, this.deps.secrets.token).split(this.deps.secrets.chatId).join('[chat]'))) }
  private logError(error: unknown): void { console.warn(`텔레그램: ${this.safeError(error)}`) }

  private async wait(ms: number): Promise<void> {
    if (this.abort.signal.aborted) return
    let wake!: () => void
    let timer: ReturnType<typeof setTimeout> | undefined
    const interrupted = new Promise<void>(resolve => { wake = resolve })
    this.abort.signal.addEventListener('abort', wake, { once: true })
    const delay = this.deps.clock === systemClock ? new Promise<void>(resolve => { timer = setTimeout(resolve, ms) }) : this.deps.clock.sleep(ms)
    try { await Promise.race([delay, interrupted]) } finally {
      if (timer) clearTimeout(timer)
      this.abort.signal.removeEventListener('abort', wake)
    }
  }
}

/** "지침을 … 답장으로 보내 주세요 · msg-0007" 프롬프트에 대한 답장이면 그 이벤트 id */
function guidanceTarget(message: TgMessage): string | undefined {
  return /· (msg-\d+)$/.exec(message.reply_to_message?.text ?? '')?.[1]
}

function capLines(text: string, max: number): string {
  const lines = text.split('\n')
  return lines.length > max ? `${lines.slice(0, max).join('\n')}\n…(대시보드에서 보기)` : text
}

function inlineButtons(message: OutMessage): InlineButton[][] | undefined {
  return message.buttons?.map(row => row.map(button => ({ text: button.text, ...(button.callback ? { callback_data: encodeCallback(button.callback) } : {}), ...(button.url ? { url: button.url } : {}) })))
}

async function readOptional(file: string): Promise<string | null> {
  try { return await fs.readFile(file, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

function inside(root: string, file: string): boolean {
  const rel = relative(root, file)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel)
}
