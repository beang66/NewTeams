import type { Clock } from '../clock.js'
import type { EventBus } from '../bus/eventBus.js'
import { RunnerError } from '../runners/types.js'
import type { Envelope } from '../protocol/messages.js'

type PauseReason = 'rate_limit' | 'auth' | 'openai_cap'
const HOUR_MS = 3_600_000
const AUTH_DETAIL = '터미널에서 다시 로그인 필요'
const CAP_DETAIL = 'OpenAI API 누적 지출 상한($8) 도달'

/** 한도/인증 오류 시 모든 러너 호출을 멈췄다가, 재개되면 대기하던 호출을 재시도시키는 게이트. */
export class PauseGate {
  private _paused = false
  private mode: 'time' | 'human' = 'time'
  private until = new Date(0)
  private humanRelease: (() => void) | undefined
  private humanSignal: Promise<void> | undefined
  private switchedToHuman: Promise<void>
  private signalSwitch: () => void = () => {}
  private resumedPromise: Promise<void> = Promise.resolve()
  private humanRequiredSent = false
  private humanRequiredPublish: Promise<Envelope> | undefined

  constructor(private readonly bus: EventBus, private readonly clock: Clock) {
    this.switchedToHuman = new Promise<void>((r) => { this.signalSwitch = r })
  }

  get paused(): boolean { return this._paused }

  async guard<T>(fn: () => Promise<T>): Promise<T> {
    for (;;) {
      if (this._paused) await this.resumedPromise
      try {
        return await fn()
      } catch (e) {
        if (!(e instanceof RunnerError)) throw e
        if (e.kind === 'rate_limit' && e.message === 'openai cap') this.pause('openai_cap')
        else if (e.kind === 'rate_limit') this.pause('rate_limit', e.resetAt ?? new Date(this.clock.now().getTime() + HOUR_MS))
        else if (e.kind === 'auth') this.pause('auth')
        else throw e
        await this.resumedPromise
      }
    }
  }

  async resumeByHuman(): Promise<void> {
    if (!this._paused || this.mode !== 'human') return
    // 게이트가 발행한 HUMAN_REQUIRED를 해결 처리해 RunState.humanRequired에서 빠지게 한다.
    const pending = this.humanRequiredPublish
    this.humanRequiredPublish = undefined
    if (pending) {
      const hr = await pending
      await this.bus.publish({
        type: 'GUIDANCE', from: 'user', to: 'controller',
        payload: { action: 'resume', text: '재개', resolves: hr.id },
      })
    }
    this.humanRelease?.()
    await this.resumedPromise
  }

  /** 동기적으로 상태를 갱신한다(동시 호출이 한 번의 PAUSED로 합쳐지도록). */
  private pause(reason: PauseReason, until?: Date): void {
    const human = reason !== 'rate_limit'
    if (this._paused) {
      if (!human) {
        if (this.mode === 'time' && until && until > this.until) this.until = until
        return
      }
      if (this.mode === 'human') return
      this.enterHumanMode(reason) // 시간 대기 중 사람 개입 필요 → 사람 재개가 우선
      return
    }
    this._paused = true
    if (human) this.setHumanMode()
    else { this.mode = 'time'; this.until = until! }
    this.resumedPromise = this.runPause(reason).catch((err) => {
      this._paused = false
      this.humanRequiredSent = false
      this.humanRequiredPublish = undefined
      console.error('PauseGate failed', err)
    })
  }

  private setHumanMode(): void {
    this.mode = 'human'
    this.humanSignal = new Promise<void>((resolve) => { this.humanRelease = resolve })
    this.signalSwitch()
  }

  private enterHumanMode(reason: PauseReason): void {
    this.setHumanMode()
    void this.publishHumanRequired(reason)
  }

  private async publishHumanRequired(reason: PauseReason): Promise<void> {
    if (this.humanRequiredSent) return
    this.humanRequiredSent = true
    const p = this.bus.publish({
      type: 'HUMAN_REQUIRED', from: 'orchestrator', to: 'user',
      payload: { reason, detail: reason === 'openai_cap' ? CAP_DETAIL : AUTH_DETAIL },
    })
    this.humanRequiredPublish = p
    await p
  }

  private async runPause(reason: PauseReason): Promise<void> {
    const pausedPayload = this.mode === 'time' ? { reason, until: this.until.toISOString() } : { reason }
    await this.bus.publish({ type: 'PAUSED', from: 'orchestrator', to: 'all', payload: pausedPayload })
    if (this.mode === 'human') await this.publishHumanRequired(reason)
    // 시간 대기: until이 늘어날 수 있으므로 도달할 때까지 재확인. 사람 모드로 바뀌면 사람 재개를 기다린다.
    for (;;) {
      if (this.mode === 'time') {
        const ms = this.until.getTime() - this.clock.now().getTime()
        if (ms <= 0) break
        await Promise.race([this.clock.sleep(ms), this.switchedToHuman]) // 대기 중 사람 모드로 바뀌면 즉시 깨어남
      } else {
        await this.humanSignal
        break
      }
    }
    this._paused = false
    this.humanRequiredSent = false
    this.humanRequiredPublish = undefined
    this.switchedToHuman = new Promise<void>((r) => { this.signalSwitch = r })
    await this.bus.publish({ type: 'RESUMED', from: 'orchestrator', to: 'all', payload: {} })
  }
}
