import { promises as fs, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Runner, RunRequest } from '../runners/types.js'
import type { Usage } from '../protocol/messages.js'
import { SKILL_MODELS, SkillNotFound, type SkillInfo } from './skills.js'

export type RunStatus = 'running' | 'needs_approval' | 'done' | 'failed' | 'cancelled'
export interface SkillRun {
  id: string; skill: string; input: string; model: string; effort: string; routine?: string
  status: RunStatus; startedAt: string; endedAt?: string
  text?: string; error?: string; denied?: string[]; files?: string[]; sessionId?: string
  usage?: Usage
}
export interface StartRequest { skill: string; input: string; model: string; effort: string; routine?: string }

export class SkillBusy extends Error {}
export class RunNotFound extends Error {}
export class RunConflict extends Error {}

/** 처음 고정 목록: 사용자가 실제로 쓰는 스킬(2026-11-02 제안). 설치되지 않은 이름은 화면에서 빠진다. */
export const DEFAULT_PINNED = [
  'ponytail', 'ponytail-audit', 'ponytail-review', 'ponytail-debt', 'emil-design-eng', 'web-design-guidelines',
  'graphify', 'superpowers:brainstorming', 'humanize-korean:humanize-korean', 'content-research-writer', 'doc-coauthoring',
]
const HISTORY_LIMIT = 200
const PREVIEW = 20_000

/**
 * 스킬 실행을 한 번에 하나씩 관리한다. 처음엔 권한 없이 돌리고, 파일 쓰기 등이 거부되면 needs_approval로 멈춘다.
 * 승인하면 같은 세션을 실행 폴더 안 파일 편집만 허용해(acceptEdits) 이어 간다. 셸 명령은 승인해도 막힌 채다.
 * 기록은 history.jsonl에 상태가 바뀔 때마다 한 줄씩 더하고, 읽을 때 같은 id의 마지막 줄을 쓴다.
 */
export class SkillRuns {
  private runs = new Map<string, SkillRun>()
  private active: { id: string; ctrl: AbortController } | null = null
  private readonly history: string
  private readonly pinsPath: string
  private seq = 0

  constructor(
    private readonly dir: string,
    private readonly claude: Runner,
    private readonly list: () => Promise<SkillInfo[]>,
    private readonly timeoutMs: number,
    private readonly now: () => Date = () => new Date(),
    /** 고정 목록 파일. 프로젝트와 상관없이 사용자 한 사람의 목록이므로 서버는 홈 폴더 경로를 넘긴다. */
    pinsPath?: string,
  ) {
    this.history = join(dir, 'history.jsonl')
    this.pinsPath = pinsPath ?? join(dir, 'pinned.json')
    if (existsSync(this.history)) {
      for (const line of readFileSync(this.history, 'utf8').split('\n')) {
        try { const r = JSON.parse(line) as SkillRun; this.runs.set(r.id, r) } catch { /* 빈 줄·깨진 줄 */ }
      }
    }
    // 서버가 꺼질 때 돌던 실행은 이어 갈 프로세스가 없다.
    for (const r of this.runs.values()) if (r.status === 'running') this.runs.set(r.id, { ...r, status: 'failed', error: '오케스트레이터가 재시작되어 중단됨' })
  }

  recent(limit = 50): SkillRun[] { return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit) }
  get(id: string): SkillRun { const r = this.runs.get(id); if (!r) throw new RunNotFound(`실행 없음: ${id}`); return r }
  busy(): boolean { return this.active !== null }

  async start(req: StartRequest): Promise<SkillRun> {
    if (this.active) throw new SkillBusy('다른 스킬이 실행 중')
    if (!(await this.list()).some((s) => s.name === req.skill)) throw new SkillNotFound(`설치되지 않은 스킬: ${req.skill}`)
    const t = this.now()
    const id = `${t.toISOString().replace(/\D/g, '').slice(0, 14)}-${++this.seq}`
    const run: SkillRun = { ...req, id, status: 'running', startedAt: t.toISOString() }
    await this.save(run)
    void this.exec(run, `/${req.skill}${req.input.trim() ? ` ${req.input.trim()}` : ''}`, false)
    return run
  }

  async approve(id: string): Promise<SkillRun> {
    const r = this.get(id)
    if (r.status !== 'needs_approval' || !r.sessionId) throw new RunConflict('승인 대기 중인 실행이 아님')
    if (this.active) throw new SkillBusy('다른 스킬이 실행 중')
    const next: SkillRun = { ...r, status: 'running' }
    await this.save(next)
    void this.exec(next, '사람이 승인했다. 거부됐던 파일 작업을 이 폴더 안에서 다시 진행해 마무리하라.', true)
    return next
  }

  async reject(id: string): Promise<SkillRun> {
    const r = this.get(id)
    if (r.status !== 'needs_approval') throw new RunConflict('승인 대기 중인 실행이 아님')
    return this.save({ ...r, status: 'cancelled', error: '사람이 권한을 거절함', endedAt: this.now().toISOString() })
  }

  cancel(id: string): void {
    if (this.active?.id !== id) throw new RunConflict('실행 중이 아님')
    this.active.ctrl.abort()
  }

  /**
   * 고정 목록. 파일이 없을 때만 예전 프로젝트별 pinned.json → 기본 목록 순으로 채우고 바로 파일로 남긴다.
   * 파일이 깨졌으면 기본값으로 덮지 않고 .bak(직전 저장본)을 읽는다.
   */
  async pinned(): Promise<string[]> {
    const read = async (p: string): Promise<string[] | undefined> => {
      try { const v: unknown = JSON.parse(await fs.readFile(p, 'utf8')); return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined } catch { return undefined }
    }
    if (existsSync(this.pinsPath)) {
      const v = (await read(this.pinsPath)) ?? (await read(`${this.pinsPath}.bak`))
      if (v) return v
      throw new Error(`고정 목록 파일을 읽을 수 없음: ${this.pinsPath}`)
    }
    const seed = (await read(join(this.dir, 'pinned.json'))) ?? DEFAULT_PINNED
    await this.setPinned(seed)
    return seed
  }
  /** 쓰기 전에 직전 저장본을 .bak으로 남기고, 임시 파일에 쓴 뒤 이름을 바꾼다(중간에 끊겨도 목록이 비지 않게). */
  async setPinned(names: string[]): Promise<void> {
    await fs.mkdir(dirname(this.pinsPath), { recursive: true })
    if (existsSync(this.pinsPath)) await fs.copyFile(this.pinsPath, `${this.pinsPath}.bak`)
    const tmp = `${this.pinsPath}.tmp`
    await fs.writeFile(tmp, JSON.stringify([...new Set(names)], null, 2))
    await fs.rename(tmp, this.pinsPath)
  }

  private async exec(run: SkillRun, prompt: string, approved: boolean): Promise<void> {
    const ctrl = new AbortController()
    this.active = { id: run.id, ctrl }
    const cwd = join(this.dir, run.id)
    try {
      await fs.mkdir(cwd, { recursive: true })
      if (ctrl.signal.aborted) throw new Error('시작 전에 중단됨')
      const req: RunRequest = {
        role: 'master', prompt, model: SKILL_MODELS[run.model] ?? 'default', cwd, timeoutMs: this.timeoutMs,
        userSettings: true, signal: ctrl.signal, rawLogPath: join(cwd, 'session.jsonl'),
        ...(run.effort !== '기본' ? { effort: run.effort } : {}),
        ...(approved ? { acceptEdits: true, resumeSessionId: run.sessionId } : {}),
      }
      const res = await this.claude.run(req)
      const files = (await fs.readdir(cwd)).filter((f) => f !== 'session.jsonl')
      const text = res.text.slice(0, PREVIEW)
      const sessionId = res.sessionId ?? run.sessionId
      // 승인 뒤에도 거부가 남으면(셸 명령 등) 더 열지 않고 결과와 함께 끝낸다.
      const status: RunStatus = res.denied?.length && !approved && sessionId ? 'needs_approval' : 'done'
      // denied는 이번 실행의 거부만 남긴다(승인 전 목록이 승인 뒤까지 남지 않게).
      // 승인 뒤 이어 간 실행이면 앞선 사용량에 더한다(대시보드 전체 사용량 집계용).
      const usage = run.usage ? { in: run.usage.in + res.usage.in, out: run.usage.out + res.usage.out, cached: run.usage.cached + res.usage.cached, ...(run.usage.costUsd !== undefined || res.usage.costUsd !== undefined ? { costUsd: (run.usage.costUsd ?? 0) + (res.usage.costUsd ?? 0) } : {}) } : res.usage
      await this.save({ ...run, status, text, files, sessionId, usage, denied: res.denied?.length ? res.denied : undefined, ...(status === 'done' ? { endedAt: this.now().toISOString() } : {}) })
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      await this.save({ ...run, status: cancelled ? 'cancelled' : 'failed', error: cancelled ? '사람이 중단함' : e instanceof Error ? e.message : String(e), endedAt: this.now().toISOString() })
    } finally {
      this.active = null
    }
  }

  private async save(run: SkillRun): Promise<SkillRun> {
    this.runs.set(run.id, run)
    if (this.runs.size > HISTORY_LIMIT) this.runs.delete(this.recent(this.runs.size).at(-1)!.id)
    await fs.mkdir(this.dir, { recursive: true })
    await fs.appendFile(this.history, JSON.stringify(run) + '\n')
    return run
  }
}
