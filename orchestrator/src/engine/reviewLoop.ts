import { promises as fs, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import type { Clock } from '../clock.js'
import type { Config } from '../config.js'
import type { EventBus } from '../bus/eventBus.js'
import type { ProjectStore } from '../store/projectStore.js'
import { RunnerError, type Runner, type RunRequest, type RunResult } from '../runners/types.js'
import { buildPrompt, type PromptInput } from '../context/contextBuilder.js'
import { pickModel } from '../router/modelRouter.js'
import { checkAgentConfig, checkOwnership, runChecks, verifyEvidence, type EvidenceManifest } from '../harness/checks.js'
import { DeadlockTracker, harnessReject, normalizeVerdict, parseVerdict } from '../harness/verdict.js'
import { changedFiles, commitAll, createWorktree, diff, headRev, lastCommitAt, restoreFiles } from '../workspace/git.js'
import { verdictJsonSchema, type Envelope, type Finding, type NewEnvelope, type Verdict } from '../protocol/messages.js'
import type { Plan, PlanTask } from '../protocol/plan.js'

export interface LoopDeps {
  bus: EventBus; store: ProjectStore; config: Config; clock: Clock
  claude: Runner; reviewer: Runner
  run: <T>(fn: () => Promise<T>) => Promise<T>
  askMaster: (input: Extract<PromptInput, { role: 'master'; mode: 'escalation' }>) => Promise<MasterDecision>
  plan: Plan; repo: string
  seedFor: (model: string) => Promise<string>
}
export interface MasterDecision { action: 'guidance' | 'split' | 'upgrade' | 'give_up'; text: string; subtasks?: PlanTask[] }
/** 재개·사람 지침 재대기용 시작점. sessionId가 있으면 시드를 포크하지 않고 그 세션을 이어간다. */
export interface LoopStart { round?: number; sessionId?: string; guidance?: string; findings?: Finding[] }
export type LoopOutcome = { kind: 'approved' } | { kind: 'split'; subtasks: PlanTask[] } | { kind: 'human_required'; eventId: string }

export const QA_ALLOWED_TOOLS = ['mcp__playwright', 'Bash', 'Read', 'Write']
export const PLAYWRIGHT_MCP = { mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@0.0.83'] } } }
const MAX_REVIEW_IMAGES = 6
const TEST_OUTPUT_TAIL = 1500
const RETRYABLE = new Set(['crash', 'timeout', 'format'])

/** 하네스 지적에 내용 기반의 고정 ID를 붙인다. 같은 문제는 회차가 달라도 같은 ID가 되어 반복을 추적할 수 있다. */
export function harnessVerdict(taskId: string, items: { key: string; issue: string }[]): Verdict {
  const v = harnessReject(taskId, items.map((i) => i.issue))
  return { ...v, findings: v.findings.map((f, i) => ({ ...f, id: `H-${items[i]!.key}` })) }
}

/** verifyEvidence 문제 문자열 → 고정 키 (manifest 또는 캡처 파일명). */
export function evidenceKey(problem: string): string {
  if (problem.startsWith('manifest.json')) return 'qa:manifest'
  return `qa:${problem.split(/[: ]/)[0]}`
}

interface DevReport { changedFiles?: unknown; testsRun?: unknown; claims?: unknown; blocked?: { reason?: unknown; detail?: unknown } }

/** 펜스(```json …```) 또는 날 JSON 객체를 최대한 읽는다. 실패하면 undefined. */
export function parseLooseJson(text: string): Record<string, unknown> | undefined {
  const t = text.trim()
  const candidates = [t]
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n?```/i.exec(t)
  if (fence) candidates.push(fence[1]!)
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) candidates.push(t.slice(a, b + 1))
  for (const c of candidates) {
    try {
      const v: unknown = JSON.parse(c)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch { /* 다음 후보 */ }
  }
  return undefined
}

/** 각 시나리오의 마지막 캡처(절대 경로), 최대 6장. */
export function reviewImages(manifest: EvidenceManifest, evidenceDir: string): string[] {
  const out: string[] = []
  for (const s of manifest) {
    const last = s.steps.at(-1)
    if (last?.screenshot) out.push(join(evidenceDir, last.screenshot))
  }
  return out.slice(0, MAX_REVIEW_IMAGES)
}

type EscalationReason = 'reject_limit' | 'repeat_finding' | 'permission' | 'repeat_error' | 'other'
const asReason = (r: unknown): EscalationReason =>
  r === 'reject_limit' || r === 'repeat_finding' || r === 'permission' || r === 'repeat_error' ? r : 'other'

export async function runTaskLoop(task: PlanTask, deps: LoopDeps, start: LoopStart = {}): Promise<LoopOutcome> {
  const { bus, store, config, plan } = deps
  const projectRoot = dirname(store.paths.raw)
  const rel = (abs: string) => relative(projectRoot, abs).replaceAll('\\', '/')
  const tracker = new DeadlockTracker(config.rejectLimit, config.repeatFindingLimit)

  const worktree = await createWorktree(deps.repo, task.id)
  const base = await headRev(deps.repo)

  let round = start.round ?? 1
  let sessionId: string | undefined = start.sessionId
  let findings: Finding[] = start.findings ?? []
  let escalated = false
  let guidance: string | undefined = start.guidance
  let upgraded = false
  let needSeed = !sessionId
  let worktreePublished = false
  // 검수 세션을 이어 쓰면 2회차부터 지난 검수 이후 diff만 보낸다. 세션이 없으면(OpenAI 대체 등) 다시 전체 검수.
  let reviewSessionId: string | undefined
  let reviewedRev: string | undefined
  const history: string[] = []

  const publish = (e: Omit<NewEnvelope, 'task'>): Promise<Envelope> => bus.publish({ ...e, task: task.id })

  /** 같은 이름의 프롬프트가 이미 있으면(재실행 등) 접미사를 붙여 덮어쓰지 않는다. */
  const savePrompt = async (name: string, text: string): Promise<string> => {
    let id = name
    for (let i = 2; existsSync(join(store.paths.prompts, `${id}.txt`)); i++) id = `${name}-${i}`
    return store.writePrompt(id, text)
  }

  /** crash/timeout/format(러너가 던진 것)은 cliRetry회 다시 시도. 그래도 실패하면 마지막 오류를 돌려준다. 그 밖의 오류는 던진다. */
  const call = async (runner: Runner, req: RunRequest): Promise<RunResult | RunnerError> => {
    let last: RunnerError | undefined
    for (let attempt = 0; attempt <= config.cliRetry; attempt++) {
      try {
        return await deps.run(() => runner.run(req))
      } catch (e) {
        if (e instanceof RunnerError && RETRYABLE.has(e.kind)) { last = e; continue }
        throw e
      }
    }
    return last!
  }

  const agentMeta = (agent: string, res: RunResult | undefined, promptRef?: string) => ({
    ...(promptRef ? { promptRef } : {}),
    ...(res ? { sessionRef: rel(store.sessionLogPath(agent, task.id)), usage: res.usage } : {}),
  })

  /** 교착·blocked·반복 오류 공통 경로. null이면 다음 회차로 진행. */
  const escalate = async (reason: EscalationReason, detail?: string): Promise<LoopOutcome | null> => {
    if (escalated) {
      const hr = await publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', round, payload: { reason, detail: detail ?? history.at(-1) } })
      return { kind: 'human_required', eventId: hr.id }
    }
    const input = { role: 'master' as const, mode: 'escalation' as const, taskId: task.id, reason, findings, history: [...history, ...(detail ? [`현재 차단 상세: ${detail}`] : [])].join('\n') }
    const promptRef = await savePrompt(`${task.id}-r${round}-escalate`, buildPrompt(input))
    await publish({ type: 'ESCALATE', from: 'controller', to: 'master', round, promptRef, payload: { reason, ...(detail !== undefined ? { detail } : {}) } })
    const decision = await deps.askMaster(input)
    await publish({ type: 'GUIDANCE', from: 'master', to: 'controller', round, payload: { action: decision.action, text: decision.text } })
    history.push(`r${round}: 마스터 결정 ${decision.action}`)
    switch (decision.action) {
      case 'guidance': guidance = decision.text; break
      case 'upgrade': upgraded = true; needSeed = true; break
      case 'split':
        if (decision.subtasks?.length) return { kind: 'split', subtasks: decision.subtasks }
        // 하위 태스크 없는 split은 give_up으로 본다
        // falls through
      case 'give_up': {
        const hr = await publish({ type: 'HUMAN_REQUIRED', from: 'controller', to: 'user', round, payload: { reason, detail: decision.text } })
        return { kind: 'human_required', eventId: hr.id }
      }
    }
    escalated = true
    tracker.reset(task.id)
    return null
  }

  let qaConfigPath: string | undefined
  const ensureQaConfig = async (): Promise<string> => {
    if (!qaConfigPath) {
      qaConfigPath = join(store.paths.raw, 'playwright-mcp.json')
      await fs.mkdir(store.paths.raw, { recursive: true })
      await fs.writeFile(qaConfigPath, JSON.stringify(PLAYWRIGHT_MCP, null, 2))
    }
    return qaConfigPath
  }

  /** 검수자 실행 + 형식 복구. 실패하면 RunnerError. */
  const review = async (req: RunRequest): Promise<{ verdict: Verdict; res: RunResult } | RunnerError> => {
    let res = await call(deps.reviewer, req)
    if (res instanceof RunnerError) return res
    let attempt = 0
    for (;;) {
      try {
        return { verdict: normalizeVerdict(parseVerdict(res.text)), res }
      } catch (e) {
        if (!(e instanceof RunnerError) || e.kind !== 'format') throw e
        if (attempt++ >= config.formatRepairRetry) return e
        const fix = `출력 형식이 올바르지 않았다 (${e.message}). 판정 JSON 하나만 스키마 형식에 맞게 다시 출력하라. 다른 글은 쓰지 마라.`
        // 세션이 있으면 이어서 형식만 고치게 한다. 없으면 새 세션은 diff·이미지를 모르므로 원래 요청 전체에 안내를 덧붙여 다시 보낸다.
        let repairReq: RunRequest
        if (res.sessionId) {
          const { images: _images, ...rest } = req
          repairReq = { ...rest, prompt: fix, resumeSessionId: res.sessionId, freshPrompt: `${req.freshPrompt ?? req.prompt}\n\n## 형식 주의\n${fix}` }
        } else {
          repairReq = { ...req, prompt: `${req.prompt}\n\n## 형식 주의\n${fix}` }
        }
        const next = await call(deps.reviewer, repairReq)
        if (next instanceof RunnerError) return next
        res = next
      }
    }
  }

  for (;; round++) {
    // ---- dev ----
    const model = pickModel('dev', { difficulty: task.difficulty, escalated: upgraded }, config)
    const devPrompt = buildPrompt({
      role: 'dev', task, worktree, setupCommands: plan.setupCommands ?? [], testCommands: plan.testCommands,
      ...(findings.length ? { findings } : {}), ...(guidance ? { guidance } : {}),
    })
    const devPromptRef = await savePrompt(`${task.id}-r${round}-dev`, devPrompt)
    await publish({
      type: 'ASSIGN', from: 'controller', to: 'dev', round, promptRef: devPromptRef,
      payload: { title: task.title, ownedFiles: task.ownedFiles, acceptance: task.acceptance, model, ...(guidance ? { guidance } : {}) },
    })
    const devReq: RunRequest = {
      role: 'dev', prompt: devPrompt, model, cwd: worktree, timeoutMs: config.timeoutsMs.dev,
      rawLogPath: store.sessionLogPath('dev', task.id),
      ...(needSeed ? { resumeSessionId: await deps.seedFor(model), fork: true } : sessionId ? { resumeSessionId: sessionId } : {}),
    }
    const devRes = await call(deps.claude, devReq)
    if (devRes instanceof RunnerError) {
      history.push(`r${round}: dev 실행 실패 (${devRes.kind})`)
      const out = await escalate('repeat_error', `dev ${devRes.kind}: ${devRes.message}`)
      if (out) return out
      continue
    }
    needSeed = false
    const sessionChanged = devRes.sessionId !== undefined && devRes.sessionId !== sessionId
    if (sessionChanged || !worktreePublished) {
      if (sessionChanged) sessionId = devRes.sessionId
      await publish({
        type: 'STATE_CHANGE', from: 'controller', to: 'all', round,
        payload: { ...(sessionChanged ? { sessionId } : {}), ...(!worktreePublished ? { worktree } : {}) },
      })
      worktreePublished = true
    }
    const devJson = parseLooseJson(devRes.text)
    const dev = devJson as DevReport | undefined
    if (dev?.blocked && typeof dev.blocked === 'object') {
      const reason = asReason(dev.blocked.reason)
      let detail = typeof dev.blocked.detail === 'string' ? dev.blocked.detail : undefined
      if (reason === 'other' && dev.blocked.reason !== 'other' && dev.blocked.reason !== undefined) {
        detail = `원래 사유: ${String(dev.blocked.reason)}${detail ? ` — ${detail}` : ''}`
      }
      history.push(`r${round}: dev blocked (${String(dev.blocked.reason)})`)
      const out = await escalate(reason, detail)
      if (out) return out
      continue
    }

    await commitAll(worktree, `${task.id}: round ${round}`)
    const changed = await changedFiles(worktree, base)
    const report: Record<string, unknown> = devJson ?? { changedFiles: changed, testsRun: [], claims: [] }
    const devMeta = agentMeta('dev', devRes, devPromptRef)
    if (round === 1) {
      await publish({ type: 'REPORT', from: 'dev', to: 'controller', round, ...devMeta, payload: report })
    } else {
      await publish({ type: 'REVISION', from: 'dev', to: 'controller', round, ...devMeta, payload: { ...report, addressed: findings.map((f) => f.id) } })
    }

    // ---- 하네스 ----
    let verdict: Verdict | undefined
    let from: 'harness' | 'reviewer' = 'harness'
    let rejectMeta: Partial<Envelope> = {}
    const agentConfig = checkAgentConfig(changed)
    // 반려만 하면 파일이 남아 다음 회차 에이전트가 그 훅·권한을 불러온다. 바로 되돌린다.
    if (agentConfig.length) await restoreFiles(worktree, base, agentConfig, `${task.id}: revert agent config`)
    const problems = [
      ...agentConfig.map((f) => ({ key: `cfg:${f}`, issue: `에이전트 설정 파일 수정 금지: ${f}` })),
      ...checkOwnership(changed, task.ownedFiles).map((f) => ({ key: `own:${f}`, issue: `소유 범위 밖 파일 수정: ${f}` })),
    ]
    // 설치는 매 라운드 다시 돈다: dev가 의존성을 추가했을 수 있다. 설치가 실패하면 테스트는 의미가 없다.
    const setup = await runChecks(worktree, plan.setupCommands ?? [], config.timeoutsMs.qa)
    const checks = setup.ok ? await runChecks(worktree, plan.testCommands, config.timeoutsMs.qa) : setup
    const [kind, label] = setup.ok ? ['test', '테스트 명령 실패'] : ['setup', '설치 명령 실패']
    for (const r of checks.results) {
      if (r.exitCode !== 0) {
        problems.push({ key: `${kind}:${r.cmd}`, issue: `${label} (exit ${r.exitCode}): ${r.cmd}\n${r.output.slice(-TEST_OUTPUT_TAIL)}` })
      }
    }
    if (problems.length) verdict = harnessVerdict(task.id, problems)

    // ---- QA ----
    const evidenceDir = join(store.paths.evidence, task.id, `r${round}`)
    let manifest: EvidenceManifest = []
    let qaMeta: Record<string, unknown> = {}
    if (!verdict && task.qaScenarios.length) {
      await fs.mkdir(evidenceDir, { recursive: true })
      const qaPrompt = buildPrompt({ role: 'qa', task, scenarios: task.qaScenarios, devCommand: plan.devCommand, evidenceDir })
      const qaPromptRef = await savePrompt(`${task.id}-r${round}-qa`, qaPrompt)
      const qaRes = await call(deps.claude, {
        role: 'qa', prompt: qaPrompt, model: pickModel('qa', {}, config), cwd: worktree, timeoutMs: config.timeoutsMs.qa,
        mcpConfig: await ensureQaConfig(), allowedTools: QA_ALLOWED_TOOLS, addDirs: [evidenceDir],
        rawLogPath: store.sessionLogPath('qa', task.id),
      })
      if (qaRes instanceof RunnerError) {
        history.push(`r${round}: QA 실행 실패 (${qaRes.kind})`)
        const out = await escalate('repeat_error', `qa ${qaRes.kind}: ${qaRes.message}`)
        if (out) return out
        continue
      }
      qaMeta = { qa: { ...agentMeta('qa', qaRes, qaPromptRef), result: parseLooseJson(qaRes.text) ?? null } }
      const ev = await verifyEvidence(evidenceDir, await lastCommitAt(worktree))
      if (!ev.ok) {
        verdict = harnessVerdict(task.id, ev.problems.map((p) => ({ key: evidenceKey(p), issue: `QA 증거 문제: ${p}` })))
        rejectMeta = agentMeta('qa', qaRes, qaPromptRef)
      } else {
        manifest = JSON.parse(await fs.readFile(join(evidenceDir, 'manifest.json'), 'utf8')) as EvidenceManifest
      }
    }

    // ---- GPT 검수 ----
    if (!verdict) {
      const images = reviewImages(manifest, evidenceDir)
      const evidenceManifest = JSON.stringify(manifest, null, 2)
      const fullPrompt = buildPrompt({
        role: 'reviewer', acceptance: task.acceptance, diff: await diff(worktree, base), evidenceManifest, previousFindings: findings,
      })
      const followUp = reviewSessionId && reviewedRev
        ? { resumeSessionId: reviewSessionId, freshPrompt: fullPrompt }
        : undefined
      const rvPrompt = followUp
        ? buildPrompt({ role: 'reviewer-followup', diff: await diff(worktree, reviewedRev!), evidenceManifest, previousFindings: findings })
        : fullPrompt
      const reviewingRev = await headRev(worktree)
      const rvPromptRef = await savePrompt(`${task.id}-r${round}-review`, rvPrompt)
      await publish({
        type: 'REVIEW_REQUEST', from: 'controller', to: 'reviewer', round, promptRef: rvPromptRef,
        payload: { changedFiles: changed, evidenceDir: rel(evidenceDir), images: images.map(rel), ...qaMeta },
      })
      const r = await review({
        role: 'reviewer', prompt: rvPrompt, model: pickModel('reviewer', {}, config), cwd: worktree, timeoutMs: config.timeoutsMs.reviewer,
        outputSchema: verdictJsonSchema, images, rawLogPath: store.sessionLogPath('reviewer', task.id), ...followUp,
      })
      if (r instanceof RunnerError) {
        reviewSessionId = undefined
        history.push(`r${round}: 검수 실패 (${r.kind})`)
        const out = await escalate('repeat_error', `reviewer ${r.kind}: ${r.message}`)
        if (out) return out
        continue
      }
      verdict = r.verdict
      reviewSessionId = r.res.sessionId
      reviewedRev = reviewingRev
      from = 'reviewer'
      rejectMeta = agentMeta('reviewer', r.res, rvPromptRef)
      if (verdict.verdict === 'approve') {
        await publish({ type: 'APPROVE', from: 'reviewer', to: 'controller', round, ...rejectMeta, payload: verdict })
        return { kind: 'approved' }
      }
    }

    // ---- 반려 ----
    await publish({ type: 'REJECT', from, to: 'dev', round, ...rejectMeta, payload: verdict })
    history.push(`r${round}: 반려(${from}) ${verdict.findings.map((f) => f.id).join(', ') || '(지적 없음)'}`)
    findings = verdict.findings
    const rec = tracker.record(task.id, verdict)
    if (rec.deadlocked) {
      const out = await escalate(rec.reason!)
      if (out) return out
    }
  }
}
