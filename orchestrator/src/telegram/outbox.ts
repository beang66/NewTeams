import type { TelegramConfig } from '../config.js'
import type { Clock } from '../clock.js'
import type { OutMessage } from './format.js'

const TICK_MS = 1000
const MAX_ATTEMPTS = 5
const SEND_TIMEOUT_MS = 15_000

const firstLine = (t: string): string => t.split('\n', 1)[0] ?? ''
const toMinutes = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h! * 60 + m! }

interface LoudItem { m: OutMessage; tries: number }

/** 알림 대기열: 무음 묶음, 조용한 시간, 밤사이 요약, 생존 신호. push는 동기·무예외. */
export class Outbox {
  private readonly maxQueue: number
  private silentQ: OutMessage[] = []
  private batchSince = 0
  private loudQ: LoudItem[] = []
  private draining = false
  private overnight: string[] = []
  private overnightCount = 0
  private lastStage: string | null = null
  private wasQuiet: boolean
  private nextHeartbeat = 0
  private stopped = false

  constructor(
    private readonly cfg: TelegramConfig,
    private readonly clock: Clock,
    private readonly send: (m: OutMessage) => Promise<void>,
    opts: { maxQueue?: number } = {},
  ) {
    this.maxQueue = opts.maxQueue ?? 100
    this.wasQuiet = this.inQuiet()
    if (cfg.heartbeatMinutes > 0) this.nextHeartbeat = this.clock.now().getTime() + cfg.heartbeatMinutes * 60_000
    void this.loop()
  }

  size(): number { return this.silentQ.length + this.loudQ.length }
  pendingLoud(): number { return this.loudQ.length }

  push(m: OutMessage): void {
    if (this.stopped) return
    try {
      if (m.kind === 'stage') {
        const i = m.text.lastIndexOf('→ ')
        this.lastStage = (i >= 0 ? m.text.slice(i + 2) : m.text).trim()
      }
      if (m.kind === 'approved' && !this.cfg.notifyTaskApprovals) return
      if (!m.silent) {
        if (this.inQuiet()) {
          this.overnightCount += 1
          if (this.overnight.length < this.maxQueue) this.overnight.push(firstLine(m.text))
          this.silentNow({ ...m, silent: true })
        } else {
          this.loudQ.push({ m, tries: 0 })
          void this.drain(false)
        }
      } else {
        if (this.silentQ.length === 0) this.batchSince = this.clock.now().getTime()
        this.silentQ.push(m)
      }
      this.enforceLimit()
    } catch { /* 알림 때문에 워크플로가 멈추면 안 된다 */ }
  }

  /** 종료용. 조용한 시간 중이면 밤사이 요약은 보내지 않고 버려진다. */
  async flush(): Promise<void> {
    await this.drain(true)
    await this.flushBatch()
  }

  stop(): void { this.stopped = true }

  // ---- 내부 ----

  private inQuiet(): boolean {
    const q = this.cfg.quietHours
    if (!q) return false
    const d = this.clock.now()
    const t = d.getHours() * 60 + d.getMinutes()
    const s = toMinutes(q.start), e = toMinutes(q.end)
    return s < e ? t >= s && t < e : t >= s || t < e
  }

  private enforceLimit(): void {
    let dropped = 0
    while (this.size() > this.maxQueue && this.silentQ.length > 0) { this.silentQ.shift(); dropped += 1 }
    if (dropped > 0) console.warn(`텔레그램: 알림 ${dropped}건 버림`)
  }

  /** 무음 1건을 보낸다. 실패하면 버린다. */
  private silentNow(m: OutMessage): void {
    void this.trySend(m)
  }

  private async trySend(m: OutMessage): Promise<boolean> {
    // 전송이 끝나지 않아도 대기열이 막히지 않도록 시간 제한을 둔다(시간 초과 = 실패)
    let timedOut = false
    const timeout = this.clock.sleep(SEND_TIMEOUT_MS).then(() => { timedOut = true })
    try {
      await Promise.race([Promise.resolve().then(() => this.send(m)), timeout])
      return !timedOut
    } catch { return false }
  }

  /** 소리 알림을 순서대로 보낸다. 실패하면 앞에 둔 채 멈추고 다음 주기에 재시도한다. */
  private async drain(retry: boolean): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.loudQ.length > 0) {
        const item = this.loudQ[0]!
        if (item.tries > 0 && !retry) break // 실패한 항목은 다음 주기(tick)에만 재시도
        if (await this.trySend(item.m)) { this.loudQ.shift(); continue }
        item.tries += 1
        if (item.tries >= MAX_ATTEMPTS) {
          this.loudQ.shift()
          console.warn('텔레그램: 알림 1건 버림')
          continue
        }
        break
      }
    } finally { this.draining = false }
  }

  private async flushBatch(): Promise<void> {
    const items = this.silentQ
    this.silentQ = []
    if (items.length === 0) return
    const plain = items.filter(x => !x.buttons)
    const out: OutMessage[] = items.filter(x => x.buttons)
    if (plain.length === 1) out.unshift(plain[0]!)
    else if (plain.length > 1) out.unshift({ kind: 'digest', silent: true, text: plain.map(x => firstLine(x.text)).join('\n') })
    for (const m of out) await this.trySend(m)
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      await this.clock.sleep(TICK_MS)
      if (this.stopped) return
      try { this.tick() } catch { /* 계속 돈다 */ }
    }
  }

  private tick(): void {
    const now = this.clock.now().getTime()
    const quiet = this.inQuiet()
    if (this.wasQuiet && !quiet && this.overnightCount > 0) {
      const text = [`🌅 밤사이 ${this.overnightCount}건`, ...this.overnight].join('\n')
      this.overnight = []
      this.overnightCount = 0
      this.loudQ.push({ m: { kind: 'digest', silent: false, text }, tries: 0 })
    }
    this.wasQuiet = quiet
    if (this.loudQ.length > 0) void this.drain(true)
    if (this.silentQ.length > 0 && now - this.batchSince >= this.cfg.batchSeconds * 1000) void this.flushBatch()
    if (this.cfg.heartbeatMinutes > 0 && now >= this.nextHeartbeat) {
      this.nextHeartbeat = now + this.cfg.heartbeatMinutes * 60_000
      const text = '💓 오케스트레이터 동작 중' + (this.lastStage ? ` · ${this.lastStage}` : '')
      this.silentNow({ kind: 'heartbeat', silent: true, text })
    }
  }
}
