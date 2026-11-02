import { promises as fs, existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SkillRuns } from './runs.js'
import { latestDue, type Schedule } from './schedule.js'

export { latestDue, nextDue, type Schedule } from './schedule.js'
export interface RoutineInput { name: string; skill: string; input: string; model: string; effort: string; schedule: Schedule; enabled: boolean }
export interface Routine extends RoutineInput { id: string; createdAt: string; lastRunAt?: string; lastRunId?: string; lastError?: string }

export class RoutineNotFound extends Error {}

/**
 * 루틴 저장(routines.json)과 오케스트레이터 안 스케줄러. 서버가 켜져 있을 때만 돈다.
 * 꺼져 있던 동안 놓친 실행은 켜졌을 때 가장 최근 예정분 한 번만 따라잡는다. 다른 스킬이 돌고 있으면 다음 확인 때 다시 시도한다.
 */
export class Routines {
  private items: Routine[]
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly path: string, private readonly runs: SkillRuns, private readonly now: () => Date = () => new Date()) {
    this.items = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Routine[]) : []
  }

  list(): Routine[] { return this.items }

  async create(input: RoutineInput): Promise<Routine> {
    const r: Routine = { ...input, id: randomUUID(), createdAt: this.now().toISOString() }
    this.items = [...this.items, r]
    await this.persist()
    return r
  }

  async update(id: string, input: RoutineInput): Promise<Routine> {
    const cur = this.items.find((r) => r.id === id)
    if (!cur) throw new RoutineNotFound(`루틴 없음: ${id}`)
    const next = { ...cur, ...input }
    this.items = this.items.map((r) => (r.id === id ? next : r))
    await this.persist()
    return next
  }

  async remove(id: string): Promise<void> {
    if (!this.items.some((r) => r.id === id)) throw new RoutineNotFound(`루틴 없음: ${id}`)
    this.items = this.items.filter((r) => r.id !== id)
    await this.persist()
  }

  /** 예정 시각이 지났는데 아직 안 돈 루틴을 하나 실행한다(한 번에 하나만 돌 수 있음). */
  async tick(): Promise<void> {
    const now = this.now()
    for (const r of this.items) {
      if (!r.enabled || this.runs.busy()) continue
      const due = latestDue(r.schedule, now)
      if (!due || due < new Date(r.createdAt) || (r.lastRunAt && new Date(r.lastRunAt) >= due)) continue
      let patch: Partial<Routine>
      try {
        const run = await this.runs.start({ skill: r.skill, input: r.input, model: r.model, effort: r.effort, routine: r.name })
        patch = { lastRunAt: now.toISOString(), lastRunId: run.id, lastError: undefined }
      } catch (e) {
        // 실패도 이번 예정분은 소진한다(같은 오류로 30초마다 다시 돌지 않게).
        patch = { lastRunAt: now.toISOString(), lastError: e instanceof Error ? e.message : String(e) }
      }
      this.items = this.items.map((x) => (x.id === r.id ? { ...x, ...patch } : x))
      await this.persist()
    }
  }

  start(intervalMs = 30_000): void {
    void this.tick()
    this.timer = setInterval(() => { void this.tick().catch((e) => console.warn('루틴 확인 실패', e)) }, intervalMs)
  }
  stop(): void { if (this.timer) clearInterval(this.timer) }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true })
    await fs.writeFile(this.path, JSON.stringify(this.items, null, 2))
  }
}
