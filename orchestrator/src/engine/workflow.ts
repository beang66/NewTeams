import { promises as fs, existsSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { z } from 'zod'
import type { Clock } from '../clock.js'
import type { Config } from '../config.js'
import { EventBus } from '../bus/eventBus.js'
import { ProjectStore } from '../store/projectStore.js'
import { applyEvent, rebuildState, type RunState, type Stage, type TaskState } from '../store/state.js'
import { renderAll, renderIteration } from '../render/humanRenderer.js'
import { PlanSchema, PlanTaskSchema, validatePlan, type Plan, type PlanTask } from '../protocol/plan.js'
import { verdictJsonSchema, type Envelope, type Finding, type NewEnvelope, type Verdict } from '../protocol/messages.js'
import { RunnerError, type Runner, type RunRequest, type RunResult } from '../runners/types.js'
import type { SpendTracker } from '../runners/openaiRunner.js'
import { buildPrompt, type PromptInput } from '../context/contextBuilder.js'
import { buildRepoMap } from '../context/repoMap.js'
import { pickModel, pickProvider } from '../router/modelRouter.js'
import { DeadlockTracker, normalizeVerdict, parseVerdict } from '../harness/verdict.js'
import { verifyEvidence, type EvidenceManifest } from '../harness/checks.js'
import {
  currentBranch, diff, ensureRepo, firstCommit, headRev, lastCommitAt, mergeTask, removeWorktree, settleMerge,
} from '../workspace/git.js'
import { PauseGate } from './pauseGate.js'
import { readyTasks, topoOrder } from './scheduler.js'
import {
  evidenceKey, harnessVerdict, parseLooseJson, PLAYWRIGHT_MCP, QA_ALLOWED_TOOLS, reviewImages, runTaskLoop,
  type LoopDeps, type LoopOutcome, type LoopStart, type MasterDecision,
} from './reviewLoop.js'

export interface WorkflowDeps {
  store: ProjectStore; config: Config; clock: Clock; claude: Runner
  /** 함수면 RunState.apiSpendUsd 위의 SpendTracker로 호출해 검수 러너를 만든다 (OpenAI 예비 경로용). */
  reviewer: Runner | ((spend: SpendTracker) => Runner)
}
export type RunOutcome = 'done' | 'waiting_human' | 'waiting_spec' | 'not_started' | 'stopped'
type StageResult = 'ok' | 'waiting_human' | 'stopped'

const RULES = [
  '- 기존 코드의 패턴·이름 규칙·디렉터리 구조를 따른다.',
  '- 테스트를 먼저 쓰고 구현한다.',
  '- 태스크에 필요한 최소한의 변경만 한다. 소유 파일 밖은 고치지 않는다.',
].join('\n')
const RETRYABLE = new Set(['crash', 'timeout', 'format'])
const MASTER_ACTIONS = new Set(['guidance', 'split', 'upgrade', 'give_up'])
const PLAN_ID = 'plan'
const FINAL_ID = 'final'

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {})
const section = (title: string, body: string): string => `\n## ${title}\n${body}\n`
const jsonBlock = (v: unknown): string => '```json\n' + JSON.stringify(v, null, 2) + '\n```'

/** 그 대상의 마지막 REJECT 지적 목록. */
function lastFindings(events: Envelope[], target: string): Finding[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.type === 'REJECT' && e.task === target) return (obj(e.payload).findings as Finding[] | undefined) ?? []
  }
  return []
}

function parseDecision(text: string): MasterDecision | undefined {
  const j = parseLooseJson(text)
  if (!j || typeof j.action !== 'string' || !MASTER_ACTIONS.has(j.action) || typeof j.text !== 'string') return undefined
  const subs = z.array(PlanTaskSchema).safeParse(j.subtasks)
  return { action: j.action as MasterDecision['action'], text: j.text, ...(subs.success ? { subtasks: subs.data } : {}) }
}

export class Workflow {
  readonly bus: EventBus
  readonly gate: PauseGate
  private st: RunState
  private plan: Plan | undefined
  private readonly reviewer: Runner
  private readonly dir: string
  private readonly repo: string
  private spendTotal: number
  private readonly seeds = new Map<string, Promise<string>>()
  /** 열린 HUMAN_REQUIRED id → 대상(태스크 id, 'plan', 'final', 일시정지 게이트면 undefined) */
  private readonly waiting = new Map<string, string | undefined>()
  /** 다음 실행에서 이어받을 시작점(재개·사람 지침) */
  private readonly starts = new Map<string, LoopStart>()
  private planGuidance: string | undefined
  private finalGuidance: string | undefined
  /** main 병합을 한 번에 하나씩 (BUILD 중 승인 즉시 병합 + INTEGRATE 정리) */
  private mergeLock: Promise<unknown> = Promise.resolve()
  private qaConfigPath: string | undefined

  private constructor(readonly store: ProjectStore, private readonly deps: Omit<WorkflowDeps, 'store'>, events: Envelope[], plan?: Plan) {
    this.dir = join(store.paths.raw, '..')
    this.repo = store.paths.workspace
    this.plan = plan
    this.st = rebuildState(events)
    this.bus = new EventBus(store, deps.clock, this.st.lastEventId)
    this.bus.subscribe((e) => {
      this.st = applyEvent(this.st, e)
      if (e.type === 'HUMAN_REQUIRED') this.waiting.set(e.id, e.task)
      const r = obj(e.payload).resolves
      if (e.type === 'GUIDANCE' && typeof r === 'string') this.waiting.delete(r)
      writeFileSync(store.paths.state, JSON.stringify(this.st, null, 2))
    })
    this.gate = new PauseGate(this.bus, deps.clock)
    this.spendTotal = this.st.apiSpendUsd
    const spend: SpendTracker = {
      get: () => this.spendTotal,
      add: async (usd) => {
        this.spendTotal += usd
        await this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', payload: { apiSpendUsd: this.spendTotal } })
      },
    }
    this.reviewer = typeof deps.reviewer === 'function' ? deps.reviewer(spend) : deps.reviewer
    this.restore(events)
  }

  /** 프로젝트 폴더를 열고 events.jsonl을 재생해 상태를 복원한다. */
  static async open(projectDir: string, deps: Omit<WorkflowDeps, 'store'>): Promise<Workflow> {
    const store = new ProjectStore(projectDir)
    await store.init()
    await ensureRepo(store.paths.workspace)
    const events = await store.readEvents()
    const plan = existsSync(store.paths.plan) ? PlanSchema.parse(JSON.parse(await fs.readFile(store.paths.plan, 'utf8'))) : undefined
    const workflow = new Workflow(store, deps, events, plan)
    // A restarted runtime has a new gate and rechecks availability on its next call.
    if (workflow.state().paused) await workflow.bus.publish({
      type: 'RESUMED', from: 'controller', to: 'all', payload: { reason: 'process_restart', detail: '새 런타임에서 제공자 한도를 재확인' },
    })
    return workflow
  }

  state(): RunState { return this.st }

  agentConfiguration() {
    const roles = ['master', 'planner', 'dev', 'qa', 'wiki', 'logQuery', 'reviewer'] as const
    return {
      groups: structuredClone(this.deps.config.agents),
      roles: Object.fromEntries(roles.map((role) => [role, { provider: pickProvider(role, this.deps.config), model: pickModel(role, {}, this.deps.config) }])),
    }
  }

  // ---------------- 공개 동작 ----------------

  async chat(userMessage: string): Promise<{ reply: string; specDraft?: string }> {
    if (this.st.stage !== 'INTAKE') throw new Error(`chat은 INTAKE 단계에서만 가능 (현재 ${this.st.stage})`)
    await this.bus.publish({ type: 'CHAT', from: 'user', to: 'master', payload: { text: userMessage } })
    const res = await this.callRetry(this.deps.claude, {
      role: 'master', prompt: buildPrompt({ role: 'master', mode: 'intake', userMessage }), model: pickModel('master', {}, this.deps.config),
      cwd: this.repo, timeoutMs: this.deps.config.timeoutsMs.master, rawLogPath: this.store.sessionLogPath('master'),
      ...(this.st.masterSessionId ? { resumeSessionId: this.st.masterSessionId } : {}),
    })
    if (!this.st.masterSessionId && res.sessionId) {
      await this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', payload: { masterSessionId: res.sessionId } })
    }
    const j = parseLooseJson(res.text)
    const reply = typeof j?.reply === 'string' ? j.reply : res.text
    const specDraft = typeof j?.specDraft === 'string' ? j.specDraft : undefined
    const specApprovalRequired = !!specDraft && !existsSync(join(this.store.paths.human, 'spec.draft.md'))
    if (specDraft) await this.store.writeHuman('spec.draft.md', specDraft)
    await this.bus.publish({
      type: 'CHAT', from: 'master', to: 'user', payload: { text: reply, ...(specApprovalRequired ? { specApprovalRequired: true } : {}) }, usage: res.usage,
      sessionRef: this.rel(this.store.sessionLogPath('master')),
    })
    await renderAll(this.store)
    return { reply, ...(specDraft ? { specDraft } : {}) }
  }

  async approveSpec(): Promise<void> {
    const draft = join(this.store.paths.human, 'spec.draft.md')
    if (this.st.stage !== 'INTAKE') throw new Error(`스펙 승인은 INTAKE 단계에서만 가능 (현재 ${this.st.stage})`)
    if (!existsSync(draft)) throw new Error('승인할 스펙 초안(human/spec.draft.md)이 없다')
    await fs.rename(draft, join(this.store.paths.human, 'spec.md'))
    await this.transition('SPEC_APPROVED')
  }

  /** 사람만 파이프라인을 시작한다. 스펙 승인 뒤 첫 시작, 정지 뒤 다시 시작 모두 이 호출. */
  async startPipeline(): Promise<void> {
    if (this.st.stage === 'INTAKE') throw new Error('스펙 승인 전에는 시작할 수 없음 (INTAKE)')
    if (this.st.stage === 'DONE') throw new Error('이미 완료된 파이프라인')
    if (this.st.pipeline === 'running') return
    await this.bus.publish({ type: 'STATE_CHANGE', from: 'user', to: 'all', payload: { pipeline: 'running', detail: '사람이 파이프라인 시작' } })
  }

  /** 정지: 지금 돌고 있는 에이전트 작업은 끝까지 두고, 새 작업·다음 단계는 시작하지 않는다. */
  async stopPipeline(): Promise<void> {
    if (this.st.pipeline !== 'running') return
    await this.bus.publish({ type: 'STATE_CHANGE', from: 'user', to: 'all', payload: { pipeline: 'stopped', detail: '사람이 파이프라인 정지' } })
  }

  private get halted(): RunOutcome | undefined {
    if (this.st.stage === 'INTAKE' || this.st.stage === 'DONE' || this.st.pipeline === 'running') return undefined
    return this.st.pipeline === 'stopped' ? 'stopped' : 'not_started'
  }

  async answerHuman(eventId: string, answer: { action: 'guidance' | 'skip'; text: string; restartSession?: boolean }): Promise<void> {
    if (!this.st.humanRequired.includes(eventId)) throw new Error(`열린 HUMAN_REQUIRED가 아님: ${eventId}`)
    const target = this.waiting.get(eventId)
    await this.bus.publish({
      type: 'GUIDANCE', from: 'user', to: 'controller', ...(target ? { task: target } : {}),
      payload: { action: answer.action, text: answer.text, resolves: eventId },
    })
    if (target === undefined) return this.gate.resumeByHuman()
    if (target === PLAN_ID) { this.planGuidance = answer.text; return } // 계획은 건너뛸 수 없으므로 skip도 지침으로 본다
    if (target === FINAL_ID) {
      if (answer.action === 'skip') await this.transition('REPORT')
      else this.finalGuidance = answer.text // 다음 final-fix 태스크의 지침
      return
    }
    if (answer.action === 'skip') {
      this.starts.delete(target)
      await this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', task: target, payload: { taskStatus: 'blocked' } })
      return
    }
    if (answer.restartSession) await this.bus.publish({
      type: 'STATE_CHANGE', from: 'controller', to: 'all', task: target,
      payload: { sessionId: '', detail: '사람 응답에 따라 작업 세션을 새 시드에서 다시 시작' },
    })
    this.queueGuidance(target, answer.text, await this.store.readEvents())
  }

  async askLog(question: string): Promise<string> {
    const tl = join(this.store.paths.human, 'timeline.md')
    if (!existsSync(tl)) await renderAll(this.store)
    const res = await this.callRetry(this.deps.claude, {
      role: 'logQuery', prompt: buildPrompt({ role: 'logQuery', question, timeline: await fs.readFile(tl, 'utf8') }),
      model: pickModel('logQuery', {}, this.deps.config), cwd: this.dir, allowedTools: ['Read', 'Grep'],
      timeoutMs: this.deps.config.timeoutsMs.logQuery, rawLogPath: this.store.sessionLogPath('logQuery'),
    })
    return res.text
  }

  async runUntilBlocked(): Promise<RunOutcome> {
    for (;;) {
      const halted = this.halted
      if (halted) return halted
      let r: StageResult
      switch (this.st.stage) {
        case 'INTAKE': return 'waiting_spec'
        case 'DONE': return 'done'
        case 'SPEC_APPROVED': await this.transition('SEED'); break
        case 'SEED': await this.seedFor(pickModel('planner', {}, this.deps.config)); await this.transition('PLAN'); break
        case 'PLAN':
          if ((r = await this.planStage()) !== 'ok') return r
          await this.transition('BUILD'); break
        case 'BUILD':
          if ((r = await this.build()) !== 'ok') return r
          await this.transition('INTEGRATE'); break
        case 'INTEGRATE':
          if ((r = await this.integrate()) !== 'ok') return r
          await this.transition('FINAL_QA'); break
        case 'FINAL_QA': {
          const q = await this.finalQa()
          if (q === 'waiting_human') return q
          await this.transition(q === 'ok' ? 'REPORT' : 'BUILD'); break
        }
        case 'REPORT': await this.report(); await this.transition('DONE'); break
      }
    }
  }

  // ---------------- 복원 ----------------

  private restore(events: Envelope[]): void {
    const byId = new Map(events.map((e) => [e.id, e]))
    for (const id of this.st.humanRequired) this.waiting.set(id, byId.get(id)?.task)
    // 사람 지침이 났지만 아직 그 대상이 다시 실행되지 않았으면(ASSIGN 없음) 지침을 다시 건다
    const lastAssign = new Map<string, number>()
    events.forEach((e, i) => { if (e.type === 'ASSIGN' && e.task) lastAssign.set(e.task, i) })
    // 최종 검수 지침은 다음 final-fix 태스크가 ASSIGN되면 소비된 것으로 본다
    const assignedAfter = (task: string, i: number): boolean => task === FINAL_ID
      ? events.some((e, j) => j > i && e.type === 'ASSIGN' && !!e.task?.startsWith('final-fix-'))
      : (lastAssign.get(task) ?? -1) > i
    events.forEach((e, i) => {
      const p = obj(e.payload)
      if (e.type !== 'GUIDANCE' || typeof p.resolves !== 'string' || !e.task) return
      if (assignedAfter(e.task, i)) return
      if (p.action === 'skip' && e.task !== PLAN_ID) return
      this.queueGuidance(e.task, String(p.text ?? ''), events.slice(0, i))
    })
    this.requeueInterrupted(events)
  }

  /**
   * 중단된(running/review) 태스크를 메모리에서만 되돌린다(가짜 이벤트 없음). 작업·검수 중이었으면 rejected로 바꿔
   * 같은 세션·회차로 다시 돌리고, 병합 충돌 해결 중이었으면(마지막 ASSIGN에 conflicts) approved로 돌려 병합을 다시 시도한다.
   */
  private requeueInterrupted(events: Envelope[]): void {
    const waitingTasks = new Set(this.waiting.values())
    const building = !['INTEGRATE', 'FINAL_QA', 'REPORT', 'DONE'].includes(this.st.stage)
    const lastAssign = new Map<string, Envelope>()
    for (const e of events) if (e.type === 'ASSIGN' && e.task) lastAssign.set(e.task, e)
    for (const t of this.plan?.tasks ?? []) {
      const ts = this.st.tasks[t.id]
      if (!ts || waitingTasks.has(t.id)) continue
      const active = ts.status === 'running' || ts.status === 'review'
      const mergeFix = Array.isArray(obj(lastAssign.get(t.id)?.payload).conflicts)
      if (active && (mergeFix || !building)) { this.patchTask(t.id, { status: 'approved' }); continue }
      if (this.starts.has(t.id) || !(active || ts.status === 'rejected')) continue
      this.starts.set(t.id, { round: active ? ts.round : ts.round + 1, sessionId: ts.sessionId, findings: lastFindings(events, t.id) })
      if (active) this.patchTask(t.id, { status: 'rejected' })
    }
  }

  /** 이벤트 없이 메모리 상태만 고친다(재개용). */
  private patchTask(id: string, patch: Partial<TaskState>): void {
    this.st = { ...this.st, tasks: { ...this.st.tasks, [id]: { ...this.st.tasks[id]!, ...patch } } }
  }

  private queueGuidance(target: string, text: string, events: Envelope[]): void {
    if (target === PLAN_ID) { this.planGuidance = text; return }
    if (target === FINAL_ID) { this.finalGuidance = text; return }
    const ts = this.st.tasks[target]
    this.starts.set(target, { round: (ts?.round ?? 0) + 1, sessionId: ts?.sessionId, guidance: text, findings: lastFindings(events, target) })
  }

  private isWaiting(target: string): boolean {
    return [...this.waiting.values()].includes(target)
  }

  // ---------------- 공통 ----------------

  private rel(abs: string): string { return relative(this.dir, abs).replaceAll('\\', '/') }

  private async transition(next: Stage): Promise<void> {
    const prev = this.st.stage
    await this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', payload: { stage: next } })
    await renderAll(this.store)
    await this.store.commitHuman(`${prev} 완료`)
  }

  private async savePrompt(name: string, text: string): Promise<string> {
    let id = name
    for (let i = 2; existsSync(join(this.store.paths.prompts, `${id}.txt`)); i++) id = `${name}-${i}`
    return this.store.writePrompt(id, text)
  }

  private async savePlan(plan: Plan): Promise<void> {
    if (new Set(plan.tasks.map((task) => task.id)).size !== plan.tasks.length) throw new Error('중복 태스크 id')
    this.plan = plan
    await fs.writeFile(this.store.paths.plan, JSON.stringify(plan, null, 2))
  }

  /** 게이트를 거쳐 실행. crash/timeout/format은 cliRetry회 다시 시도하고, 그래도 실패하면 마지막 오류를 던진다. */
  private async callRetry(runner: Runner, req: RunRequest): Promise<RunResult> {
    const r = await this.tryCall(runner, req)
    if (r instanceof RunnerError) throw r
    return r
  }

  private async tryCall(runner: Runner, req: RunRequest): Promise<RunResult | RunnerError> {
    let last: RunnerError | undefined
    for (let attempt = 0; attempt <= this.deps.config.cliRetry; attempt++) {
      try {
        return await this.gate.guard(() => runner.run(req))
      } catch (e) {
        if (e instanceof RunnerError && RETRYABLE.has(e.kind)) { last = e; continue }
        throw e
      }
    }
    return last!
  }

  /** 검수자 실행 + 판정 형식 복구(formatRepairRetry회). */
  private async review(req: RunRequest): Promise<Verdict | RunnerError> {
    let cur = req
    for (let attempt = 0; ; attempt++) {
      const res = await this.tryCall(this.reviewer, cur)
      if (res instanceof RunnerError) return res
      try {
        return normalizeVerdict(parseVerdict(res.text))
      } catch (e) {
        if (!(e instanceof RunnerError)) throw e
        if (attempt >= this.deps.config.formatRepairRetry) return e
        const fix = `출력 형식이 올바르지 않았다 (${e.message}). 판정 JSON 하나만 스키마 형식에 맞게 다시 출력하라.`
        cur = res.sessionId ? { ...req, images: undefined, prompt: fix, resumeSessionId: res.sessionId } : { ...req, prompt: `${req.prompt}\n\n## 형식 주의\n${fix}` }
      }
    }
  }

  private async humanRequired(task: string, reason: string, detail: string, round?: number): Promise<'waiting_human'> {
    await this.bus.publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', task, ...(round ? { round } : {}), payload: { reason, detail } })
    return 'waiting_human'
  }

  seedFor(model: string, role: 'planner' | 'dev' = 'planner'): Promise<string> {
    const provider = pickProvider(role, this.deps.config)
    const key = provider === 'claude' ? model : `${provider}:${role}:${model}`
    const have = this.st.seedSessionIds[key]
    if (have) return Promise.resolve(have)
    let p = this.seeds.get(key)
    if (!p) {
      p = this.createSeed(model, role, key)
      this.seeds.set(key, p)
      p.catch(() => this.seeds.delete(key))
    }
    return p
  }

  private async createSeed(model: string, role: 'planner' | 'dev', key: string): Promise<string> {
    const tag = key.replace(/[^a-zA-Z0-9_.-]/g, '_')
    const spec = await fs.readFile(join(this.store.paths.human, 'spec.md'), 'utf8')
    const prompt = buildPrompt({ role: 'seed', spec, repoMap: await buildRepoMap(this.repo), rules: RULES })
    await this.savePrompt(`seed-${tag}`, prompt)
    const res = await this.callRetry(this.deps.claude, {
      role: pickProvider(role, this.deps.config) === 'codex' ? role : 'planner', provider: pickProvider(role, this.deps.config), prompt, model, cwd: this.repo, timeoutMs: this.deps.config.timeoutsMs.planner,
      rawLogPath: this.store.sessionLogPath('seed', tag),
    })
    if (!res.sessionId) throw new Error(`시드 세션 ID를 받지 못함 (model ${model})`)
    await this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', payload: { seed: { model: key, sessionId: res.sessionId } } })
    return res.sessionId
  }

  /** 마스터 에스컬레이션. 형식·실행 오류는 cliRetry회 재시도하고, 그래도 안 되면 give_up으로 사람에게 넘긴다. */
  private async askMaster(input: Extract<PromptInput, { role: 'master'; mode: 'escalation' }>): Promise<MasterDecision> {
    const req: RunRequest = {
      role: 'master', prompt: buildPrompt(input), model: pickModel('master', {}, this.deps.config), cwd: this.repo,
      timeoutMs: this.deps.config.timeoutsMs.master, rawLogPath: this.store.sessionLogPath('master', input.taskId),
    }
    let lastErr = ''
    for (let attempt = 0; attempt <= this.deps.config.cliRetry; attempt++) {
      try {
        const d = parseDecision((await this.gate.guard(() => this.deps.claude.run(req))).text)
        if (d) return d
        lastErr = 'format: 마스터 결정 JSON을 읽을 수 없음'
      } catch (e) {
        if (!(e instanceof RunnerError) || !RETRYABLE.has(e.kind)) throw e
        lastErr = `${e.kind}: ${e.message}`
      }
    }
    return { action: 'give_up', text: `마스터 호출 실패 — ${lastErr}` }
  }

  // ---------------- PLAN ----------------

  private async planStage(): Promise<StageResult> {
    if (this.isWaiting(PLAN_ID)) return 'waiting_human'
    const prev = this.st.tasks[PLAN_ID]
    if (this.plan && prev?.status === 'approved') return 'ok'
    const cfg = this.deps.config
    const spec = await fs.readFile(join(this.store.paths.human, 'spec.md'), 'utf8')
    const tracker = new DeadlockTracker(cfg.rejectLimit, cfg.repeatFindingLimit)
    const publish = (e: Omit<NewEnvelope, 'task'>) => this.bus.publish({ ...e, task: PLAN_ID })
    const log = this.store.sessionLogPath('planner')
    let round = (prev?.round ?? 0) + 1
    let sessionId = prev?.sessionId
    let findings = prev ? lastFindings(await this.store.readEvents(), PLAN_ID) : []
    const guidance = this.planGuidance
    this.planGuidance = undefined

    for (;; round++) {
      const model = pickModel('planner', {}, this.deps.config)
      let prompt = sessionId && findings.length
        ? `계획에 대한 지적이다. 모두 반영한 Plan JSON 전체를 처음과 같은 출력 계약으로 다시 출력하라.\n${jsonBlock(findings)}\n`
        : buildPrompt({ role: 'planner' })
      if (guidance) prompt += section('사람 지침', guidance)
      const promptRef = await this.savePrompt(`plan-r${round}-planner`, prompt)
      await publish({ type: 'ASSIGN', from: 'controller', to: 'planner', round, promptRef, payload: { title: '기획', model } })
      const res = await this.callRetry(this.deps.claude, {
        role: 'planner', prompt, model, cwd: this.repo, timeoutMs: cfg.timeoutsMs.planner, rawLogPath: log,
        ...(sessionId ? { resumeSessionId: sessionId } : { resumeSessionId: await this.seedFor(model), fork: true }),
      })
      if (res.sessionId && res.sessionId !== sessionId) {
        sessionId = res.sessionId
        await publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', round, payload: { sessionId } })
      }
      const parsed = PlanSchema.safeParse(parseLooseJson(res.text))
      const meta = { sessionRef: this.rel(log), usage: res.usage }
      await publish({
        type: round === 1 ? 'REPORT' : 'REVISION', from: 'planner', to: 'controller', round, ...meta,
        payload: { claims: [parsed.success ? `태스크 ${parsed.data.tasks.length}개` : '계획 형식 오류'], ...(round > 1 ? { addressed: findings.map((f) => f.id) } : {}) },
      })
      let verdict: Verdict
      let from = 'harness'
      if (!parsed.success) {
        verdict = harnessVerdict(PLAN_ID, [{ key: 'plan:format', issue: `계획 JSON 형식 오류: ${parsed.error.message.slice(0, 500)}` }])
      } else {
        const problems = validatePlan(parsed.data)
        if (problems.length) {
          verdict = harnessVerdict(PLAN_ID, problems.map((p) => ({ key: `plan:${p}`, issue: p })))
        } else {
          const rvPrompt = buildPrompt({ role: 'reviewer-plan', spec, plan: parsed.data, previousFindings: findings })
          const rvRef = await this.savePrompt(`plan-r${round}-review`, rvPrompt)
          await publish({ type: 'REVIEW_REQUEST', from: 'controller', to: 'reviewer', round, promptRef: rvRef, payload: { tasks: parsed.data.tasks.map((t) => t.id) } })
          const v = await this.review({
            role: 'reviewer', prompt: rvPrompt, model: pickModel('reviewer', {}, this.deps.config), cwd: this.repo, timeoutMs: cfg.timeoutsMs.reviewer,
            outputSchema: verdictJsonSchema, rawLogPath: this.store.sessionLogPath('reviewer', PLAN_ID),
          })
          if (v instanceof RunnerError) return this.humanRequired(PLAN_ID, 'repeat_error', `계획 검수 실패 (${v.kind}): ${v.message}`, round)
          verdict = v
          from = 'reviewer'
          if (v.verdict === 'approve') {
            await this.savePlan(parsed.data)
            await publish({ type: 'APPROVE', from: 'reviewer', to: 'controller', round, payload: v })
            return 'ok'
          }
        }
      }
      await publish({ type: 'REJECT', from, to: 'planner', round, payload: verdict })
      findings = verdict.findings
      const rec = tracker.record(PLAN_ID, verdict)
      if (rec.deadlocked) return this.humanRequired(PLAN_ID, rec.reason!, findings.map((f) => f.id).join(', '), round)
    }
  }

  // ---------------- BUILD ----------------

  private loopDeps(): LoopDeps {
    return {
      bus: this.bus, store: this.store, config: this.deps.config, clock: this.deps.clock,
      claude: this.deps.claude, reviewer: this.reviewer,
      run: (fn) => this.gate.guard(fn),
      askMaster: (input) => this.askMaster(input),
      plan: this.plan!, repo: this.repo,
      seedFor: (model) => this.seedFor(model, 'dev'),
    }
  }

  /** 스케줄러가 보는 상태: 실행 중은 running, 사람 대기는 blocked, 재대기 태스크는 rejected. */
  private schedView(inFlight: Set<string>): RunState {
    const waitingTasks = new Set(this.waiting.values())
    const tasks = { ...this.st.tasks }
    for (const t of this.plan!.tasks) {
      const cur: TaskState = tasks[t.id] ?? { status: 'pending', round: 0 }
      if (inFlight.has(t.id)) tasks[t.id] = { ...cur, status: 'running' }
      else if (waitingTasks.has(t.id)) tasks[t.id] = { ...cur, status: 'blocked' }
      else if (this.starts.has(t.id) && (cur.status === 'running' || cur.status === 'review')) tasks[t.id] = { ...cur, status: 'rejected' }
    }
    return { ...this.st, tasks }
  }

  private async build(): Promise<StageResult> {
    // 재개 등으로 승인됐지만 아직 병합되지 않은 태스크를 먼저 병합해 의존 태스크를 풀어 준다 (사람 대기는 아래에서 판단)
    await this.mergeApprovedSweep()
    const inFlight = new Map<string, Promise<{ id: string; out: LoopOutcome }>>()
    try {
      for (;;) {
        // 정지되면 새 태스크는 띄우지 않고, 이미 돌고 있는 태스크만 끝까지 기다린다.
        const ready = this.st.pipeline === 'running' ? readyTasks(this.plan!, this.schedView(new Set(inFlight.keys())), this.deps.config.maxParallel) : []
        for (const t of ready) {
          const start = this.starts.get(t.id) ?? {}
          this.starts.delete(t.id)
          const pending = runTaskLoop(t, this.loopDeps(), start).then((out) => ({ id: t.id, out }))
        // A sibling may fail while we await wiki/merge work rather than Promise.race.
        void pending.catch(() => undefined)
        inFlight.set(t.id, pending)
        }
        if (inFlight.size === 0) break
        const { id, out } = await Promise.race(inFlight.values())
        inFlight.delete(id)
        if (out.kind === 'approved') {
          await this.updateWiki(id) // worktree diff가 필요하므로 병합 전에
          await this.mergeApproved(this.plan!.tasks.find((t) => t.id === id)!) // 실패하면 HUMAN_REQUIRED가 남는다
        } else if (out.kind === 'split') await this.split(id, out.subtasks)
      }
    } catch (e) {
      // 형제 태스크가 뒤에서 러너를 부르고 이벤트를 남기지 않도록 모두 끝날 때까지 기다린 뒤, 중단된 태스크를 재대기로 되돌린다
      await Promise.allSettled(inFlight.values())
      this.requeueInterrupted(await this.store.readEvents())
      throw e
    }
    if (this.plan!.tasks.some((t) => this.isWaiting(t.id))) return 'waiting_human'
    if (this.st.pipeline !== 'running') return 'stopped'
    // 의존이 막혀 실행할 수 없는 태스크는 blocked로 정리한다
    for (const t of topoOrder(this.plan!)) {
      const s = this.st.tasks[t.id]?.status
      if (s === 'approved' || s === 'merged' || s === 'blocked') continue
      await this.blockForDeps(t.id)
    }
    return 'ok'
  }

  private blockForDeps(id: string): Promise<Envelope> {
    return this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', task: id, payload: { taskStatus: 'blocked', detail: '의존 태스크가 막힘' } })
  }

  /** 하위 태스크를 원래 자리에 넣고, 원래 태스크에 의존하던 태스크는 하위 태스크 전부에 의존하게 한다. */
  private async split(id: string, subtasks: PlanTask[]): Promise<void> {
    const subIds = subtasks.map((s) => s.id)
    const tasks = this.plan!.tasks.flatMap((t) => (t.id === id ? [t, ...subtasks] : [t]))
      .map((t) => (t.deps.includes(id) && !subIds.includes(t.id) ? { ...t, deps: [...t.deps.filter((d) => d !== id), ...subIds] } : t))
    await this.savePlan({ ...this.plan!, tasks })
    await this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', task: id, payload: { taskStatus: 'blocked', detail: `분할: ${subIds.join(', ')}` } })
  }

  /** 승인된 태스크의 diff·iteration으로 위키를 갱신하고 minor 지적을 backlog에 남긴다. 실패해도 진행을 막지 않는다. */
  private async updateWiki(taskId: string): Promise<void> {
    let events: Envelope[] = []
    try {
      events = await this.store.readEvents()
      const worktree = this.st.tasks[taskId]?.worktree ?? join(this.repo, '.worktrees', taskId)
      const prompt = buildPrompt({
        role: 'wiki', taskId, diff: await diff(worktree, await headRev(this.repo)),
        iterationSummary: renderIteration(taskId, events), currentWiki: await this.readWiki(),
      })
      const res = await this.gate.guard(() => this.deps.claude.run({
        role: 'wiki', prompt, model: pickModel('wiki', {}, this.deps.config), cwd: this.repo, timeoutMs: this.deps.config.timeoutsMs.wiki,
        rawLogPath: this.store.sessionLogPath('wiki', taskId),
      }))
      const files = obj(parseLooseJson(res.text)?.files)
      if (!Object.keys(files).length) console.warn(`위키 응답에 files가 없음 (${taskId})`)
      for (const [name, content] of Object.entries(files)) {
        const safe = basename(name)
        if (typeof content === 'string' && safe.endsWith('.md') && safe !== 'backlog.md') await this.store.writeHuman(`wiki/${safe}`, content)
      }
    } catch (e) {
      console.warn(`위키 갱신 실패 (${taskId}):`, e)
    }
    try {
      const approve = [...events].reverse().find((e) => e.type === 'APPROVE' && e.task === taskId)
      const minors = ((obj(approve?.payload).findings as Finding[] | undefined) ?? []).filter((f) => f.severity === 'minor')
      if (!minors.length) return
      const path = join(this.store.paths.wiki, 'backlog.md')
      const head = existsSync(path) ? '' : '# 백로그\n\n'
      await fs.appendFile(path, head + minors.map((f) => `- [${taskId}] ${f.id} ${f.issue}${f.file ? ` (${f.file})` : ''}\n`).join(''))
    } catch (e) {
      console.warn(`backlog 갱신 실패 (${taskId}):`, e)
    }
  }

  private async readWiki(): Promise<string> {
    const names = existsSync(this.store.paths.wiki) ? (await fs.readdir(this.store.paths.wiki)).filter((f) => f.endsWith('.md')).sort() : []
    const parts: string[] = []
    for (const n of names) parts.push(`### ${n}\n${await fs.readFile(join(this.store.paths.wiki, n), 'utf8')}`)
    return parts.join('\n\n') || '(없음)'
  }

  // ---------------- INTEGRATE ----------------

  /** INTEGRATE: 승인됐지만 아직 병합되지 않은 태스크를 정리한다(보통은 BUILD에서 승인 즉시 병합됨). */
  private async integrate(): Promise<StageResult> {
    return (await this.mergeApprovedSweep()) ? 'ok' : 'waiting_human'
  }

  /** 승인·미병합 태스크를 topoOrder로 병합한다. 의존이 막힌 태스크는 병합하지 않고 blocked로. 사람 대기가 생기면 false. */
  private async mergeApprovedSweep(): Promise<boolean> {
    const skipped = new Set<string>()
    let waiting = false
    for (const t of topoOrder(this.plan!)) {
      const s = this.st.tasks[t.id]?.status
      if (s === 'blocked') { skipped.add(t.id); continue }
      if (s !== 'approved') continue
      if (t.deps.some((d) => skipped.has(d))) {
        skipped.add(t.id)
        await this.blockForDeps(t.id)
        continue
      }
      if (!t.deps.every((id) => this.st.tasks[id]?.status === 'merged')) { waiting = true; continue }
      if (this.isWaiting(t.id) || !(await this.mergeApproved(t))) waiting = true // 나머지는 계속 정리
    }
    return !waiting
  }

  /** 승인된 태스크를 main에 병합(충돌이면 dev 해결 → 마스터 → 사람). 성공하면 merged + worktree 제거. 병합은 직렬화한다. */
  private mergeApproved(t: PlanTask): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      if (!(await this.mergeWithResolution(t))) return false
      await this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', task: t.id, payload: { taskStatus: 'merged' } })
      await removeWorktree(this.repo, t.id)
      return true
    }
    const p = this.mergeLock.then(run)
    this.mergeLock = p.catch(() => undefined)
    return p
  }

  private async mergeWithResolution(t: PlanTask): Promise<boolean> {
    let guidance = this.starts.get(t.id)?.guidance
    this.starts.delete(t.id)
    let res = await mergeTask(this.repo, t.id)
    for (let i = 0; !res.ok && i < this.deps.config.mergeConflictRetry; i++) {
      await this.resolveConflict(t, res.conflicts, guidance)
      res = await mergeTask(this.repo, t.id)
    }
    if (res.ok) return true
    const round = this.st.tasks[t.id]?.round
    const detail = `병합 충돌: ${res.conflicts.join(', ')}`
    const input = {
      role: 'master' as const, mode: 'escalation' as const, taskId: t.id, reason: 'merge_conflict', findings: [],
      history: `개발자가 병합 충돌을 ${this.deps.config.mergeConflictRetry}회 해결하지 못함. ${detail}`,
    }
    const promptRef = await this.savePrompt(`${t.id}-merge-escalate`, buildPrompt(input))
    await this.bus.publish({ type: 'ESCALATE', from: 'controller', to: 'master', task: t.id, round, promptRef, payload: { reason: 'merge_conflict', detail } })
    const d = await this.askMaster(input)
    await this.bus.publish({ type: 'GUIDANCE', from: 'master', to: 'controller', task: t.id, round, payload: { action: d.action, text: d.text } })
    if (d.action !== 'give_up') {
      guidance = d.text
      await this.resolveConflict(t, res.conflicts, guidance)
      res = await mergeTask(this.repo, t.id)
      if (res.ok) return true
    }
    await this.humanRequired(t.id, 'merge_conflict', d.action === 'give_up' ? d.text : detail, round)
    return false
  }

  /** 태스크의 dev 세션을 그 worktree에서 이어 메인을 태스크 브랜치에 병합하고 충돌을 풀게 한다. */
  private async resolveConflict(t: PlanTask, conflicts: string[], guidance?: string): Promise<void> {
    const ts = this.st.tasks[t.id]
    const worktree = ts?.worktree ?? join(this.repo, '.worktrees', t.id)
    const branch = await currentBranch(this.repo)
    const model = pickModel('dev', {}, this.deps.config)
    const prompt = buildPrompt({ role: 'dev', task: t, worktree, conflicts, ...(guidance ? { guidance } : {}) }) + section('병합 충돌 해결',
      `메인 브랜치 \`${branch}\`와 이 태스크 브랜치가 위 파일에서 충돌한다. 이번 작업은 충돌 해결뿐이다: 작업 디렉터리에서 ` +
      `\`git merge ${branch}\`로 메인을 이 브랜치에 병합하고, 양쪽 의도를 살려 충돌을 해결한 뒤 커밋하라.`)
    const promptRef = await this.savePrompt(`${t.id}-merge`, prompt)
    await this.bus.publish({
      type: 'ASSIGN', from: 'controller', to: 'dev', task: t.id, round: ts?.round, promptRef,
      payload: { title: t.title, ownedFiles: t.ownedFiles, acceptance: t.acceptance, model, conflicts },
    })
    const res = await this.tryCall(this.deps.claude, {
      role: 'dev', prompt, model, cwd: worktree, timeoutMs: this.deps.config.timeoutsMs.dev,
      rawLogPath: this.store.sessionLogPath('dev', t.id), ...(ts?.sessionId ? { resumeSessionId: ts.sessionId } : {}),
    })
    if (res instanceof RunnerError) console.warn(`충돌 해결 dev 실행 실패 (${t.id}): ${res.kind} ${res.message}`)
    if (!(await settleMerge(worktree, `${t.id}: resolve merge conflicts`))) console.warn(`충돌이 남아 병합을 취소함 (${t.id})`)
    await this.bus.publish({ type: 'STATE_CHANGE', from: 'controller', to: 'all', task: t.id, payload: { taskStatus: 'approved' } })
  }

  // ---------------- FINAL_QA ----------------

  private async ensureQaConfig(): Promise<string> {
    if (!this.qaConfigPath) {
      this.qaConfigPath = join(this.store.paths.raw, 'playwright-mcp.json')
      await fs.writeFile(this.qaConfigPath, JSON.stringify(PLAYWRIGHT_MCP, null, 2))
    }
    return this.qaConfigPath
  }

  private async finalQa(): Promise<'ok' | 'rejected' | 'waiting_human'> {
    if (this.isWaiting(FINAL_ID)) return 'waiting_human'
    const cfg = this.deps.config
    const events = await this.store.readEvents()
    const finalRejects = events.filter((e) => e.type === 'REJECT' && e.task === FINAL_ID)
    const n = finalRejects.length + 1
    const lastGuide = events.map((e) => e.type === 'GUIDANCE' && e.task === FINAL_ID).lastIndexOf(true)
    const sinceGuide = events.filter((e, i) => i > lastGuide && e.type === 'REJECT' && e.task === FINAL_ID).length
    if (sinceGuide >= cfg.rejectLimit) return this.humanRequired(FINAL_ID, 'reject_limit', `최종 검수 반려 ${sinceGuide}회`, n)

    const plan = this.plan!
    const live = plan.tasks.filter((t) => this.st.tasks[t.id]?.status !== 'blocked')
    const scenarios = live.flatMap((t) => t.qaScenarios)
    const evidenceDir = join(this.store.paths.evidence, FINAL_ID, `r${n}`)
    const publish = (e: Omit<NewEnvelope, 'task' | 'round'>) => this.bus.publish({ ...e, task: FINAL_ID, round: n })
    let manifest: EvidenceManifest = []
    let verdict: Verdict | undefined
    let from = 'harness'
    if (scenarios.length) {
      await fs.mkdir(evidenceDir, { recursive: true })
      const prompt = buildPrompt({ role: 'qa', task: null, scenarios, devCommand: plan.devCommand, evidenceDir })
      await this.savePrompt(`final-r${n}-qa`, prompt)
      const qa = await this.tryCall(this.deps.claude, {
        role: 'qa', prompt, model: pickModel('qa', {}, this.deps.config), cwd: this.repo, timeoutMs: cfg.timeoutsMs.qa, mcpConfig: await this.ensureQaConfig(),
        allowedTools: QA_ALLOWED_TOOLS, addDirs: [evidenceDir], rawLogPath: this.store.sessionLogPath('qa', FINAL_ID),
      })
      if (qa instanceof RunnerError) return this.humanRequired(FINAL_ID, 'repeat_error', `최종 QA 실행 실패 (${qa.kind}): ${qa.message}`, n)
      const ev = await verifyEvidence(evidenceDir, await lastCommitAt(this.repo))
      if (!ev.ok) verdict = harnessVerdict(FINAL_ID, ev.problems.map((p) => ({ key: evidenceKey(p), issue: `QA 증거 문제: ${p}` })))
      else manifest = JSON.parse(await fs.readFile(join(evidenceDir, 'manifest.json'), 'utf8')) as EvidenceManifest
    }
    if (!verdict) {
      const images = reviewImages(manifest, evidenceDir)
      const prompt = buildPrompt({
        role: 'reviewer', acceptance: live.flatMap((t) => t.acceptance), diff: await diff(this.repo, await firstCommit(this.repo)),
        evidenceManifest: JSON.stringify(manifest, null, 2), previousFindings: lastFindings(events, FINAL_ID),
      })
      const promptRef = await this.savePrompt(`final-r${n}-review`, prompt)
      await publish({ type: 'REVIEW_REQUEST', from: 'controller', to: 'reviewer', promptRef, payload: { evidenceDir: this.rel(evidenceDir), images: images.map((i) => this.rel(i)) } })
      const v = await this.review({
        role: 'reviewer', prompt, model: pickModel('reviewer', {}, this.deps.config), cwd: this.repo, timeoutMs: cfg.timeoutsMs.reviewer,
        outputSchema: verdictJsonSchema, images, rawLogPath: this.store.sessionLogPath('reviewer', FINAL_ID),
      })
      if (v instanceof RunnerError) return this.humanRequired(FINAL_ID, 'repeat_error', `최종 검수 실패 (${v.kind}): ${v.message}`, n)
      if (v.verdict === 'approve') {
        await publish({ type: 'APPROVE', from: 'reviewer', to: 'controller', payload: v })
        return 'ok'
      }
      verdict = v
      from = 'reviewer'
    }
    await publish({ type: 'REJECT', from, to: 'controller', payload: verdict })
    const files = [...new Set(verdict.findings.map((f) => f.file).filter((f): f is string => !!f))]
    const fix: PlanTask = {
      id: `final-fix-${n}`, title: `최종 검수 수정 ${n}`, deps: [], ownedFiles: files.length ? files : ['**'],
      difficulty: 'mid', acceptance: verdict.findings.map((f) => f.issue), qaScenarios: [],
    }
    await this.savePlan({ ...plan, tasks: [...plan.tasks, fix] })
    if (this.finalGuidance) {
      this.starts.set(fix.id, { guidance: this.finalGuidance })
      this.finalGuidance = undefined
    }
    return 'rejected'
  }

  // ---------------- REPORT ----------------

  private async report(): Promise<void> {
    await renderAll(this.store)
    const timeline = await fs.readFile(join(this.store.paths.human, 'timeline.md'), 'utf8')
    const iterations = (await fs.readdir(this.store.paths.iterations)).filter((f) => f.endsWith('.md')).sort().map((f) => `iterations/${f}`)
    const res = await this.callRetry(this.deps.claude, {
      role: 'master', prompt: buildPrompt({ role: 'master', mode: 'report', timeline, iterations }), model: pickModel('master', {}, this.deps.config),
      cwd: this.dir, timeoutMs: this.deps.config.timeoutsMs.master, rawLogPath: this.store.sessionLogPath('master', 'report'),
    })
    await this.store.writeHuman('report.md', res.text)
  }
}
