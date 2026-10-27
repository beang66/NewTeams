import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { FakeRunner } from '../../../src/runners/fakeRunner.js'
import type { RunnerError, RunRequest, RunResult } from '../../../src/runners/types.js'
import { DEFAULT_CONFIG, type Config } from '../../../src/config.js'
import type { WorkflowDeps } from '../../../src/engine/workflow.js'
import type { Plan, PlanTask } from '../../../src/protocol/plan.js'
import { fakeClock, PNG_1X1 } from '../../helpers.js'

export const USAGE = { in: 10, out: 5, cached: 1 }
type Out = RunResult | RunnerError
type FindingSpec = { id: string; severity?: 'blocker' | 'major' | 'minor'; file?: string; issue?: string }

export const T1: PlanTask = {
  id: 't1', title: '할 일 목록', deps: [], ownedFiles: ['src/t1/**'], difficulty: 'mid',
  acceptance: ['할 일을 추가할 수 있다'], qaScenarios: [{ id: 'S-1', steps: ['열기', '추가'] }],
}
export const PLAN_ONE: Plan = { tasks: [T1], testCommands: [], devCommand: 'npm run dev' }

export const verdict = (v: 'approve' | 'reject', findings: FindingSpec[] = [], resolved: string[] = []): RunResult => ({
  text: JSON.stringify({
    verdict: v, resolved,
    findings: findings.map((f) => ({ id: f.id, severity: f.severity ?? 'major', file: f.file ?? null, issue: f.issue ?? `문제 ${f.id}`, evidence_ref: null })),
  }),
  sessionId: 's-rev', usage: USAGE,
})
export const APPROVE = verdict('approve')

export interface ScriptOpts {
  plan?: Plan
  /** 계획 응답(회차 n, 1부터). 기본: plan 그대로 */
  planner?: (n: number, req: RunRequest) => string
  /** 태스크별 dev가 쓸 파일. 기본: src/<id>/a.ts */
  devFiles?: Record<string, string>
  master?: (req: RunRequest) => { action: string; text: string; subtasks?: PlanTask[] }
  reviewPlan?: (n: number) => Out
  reviewTask?: (taskId: string, n: number) => Out
  reviewFinal?: (n: number) => Out
  /** true를 돌려주면 그 claude 호출에서 강제 종료(일반 Error)를 흉내 낸다. n은 전체 claude 호출 순번(1부터). */
  crash?: (req: RunRequest, n: number) => boolean
  /** dev 호출마다(파일을 쓰기 전에) 불린다. */
  onDev?: (taskId: string, req: RunRequest) => void
}
export interface Script { claude: (req: RunRequest) => Out; reviewer: (req: RunRequest) => Out }

let writeSeq = 0

function resolveConflict(cwd: string): void {
  const repo = join(cwd, '..', '..')
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo }).toString().trim()
  try { execFileSync('git', ['merge', branch], { cwd, stdio: 'pipe' }) } catch { /* 충돌 */ }
  writeFileSync(join(cwd, 'shared.txt'), 'resolved\n')
  execFileSync('git', ['add', '-A'], { cwd, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', 'resolve conflicts'], { cwd, stdio: 'pipe' })
}

function qaEvidence(req: RunRequest): RunResult {
  const dir = req.addDirs![0]!
  mkdirSync(dir, { recursive: true })
  const shot = 'S-1.png'
  writeFileSync(join(dir, shot), PNG_1X1)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify([{ scenarioId: 'S-1', steps: [{ step: 1, action: '열기', screenshot: shot, ts: new Date().toISOString() }] }]))
  return { text: JSON.stringify({ scenarios: [{ id: 'S-1', passed: true }] }), sessionId: 's-qa', usage: USAGE }
}

export function makeScript(o: ScriptOpts = {}): Script {
  const plan = o.plan ?? PLAN_ONE
  let claudeN = 0, plannerN = 0, planReviewN = 0, finalN = 0
  const taskN = new Map<string, number>()
  return {
    claude: (req) => {
      claudeN += 1
      if (o.crash?.(req, claudeN)) throw new Error(`강제 종료 (claude 호출 ${claudeN})`)
      if (req.prompt.includes('너는 이 프로젝트의 시드 세션')) return { text: '확인했다', sessionId: `seed-${req.model}`, usage: USAGE }
      switch (req.role) {
        case 'planner':
          if (!req.resumeSessionId) return { text: '확인했다', sessionId: `seed-${req.model}`, usage: USAGE }
          plannerN += 1
          return { text: o.planner ? o.planner(plannerN, req) : JSON.stringify(plan), sessionId: 's-planner', usage: USAGE }
        case 'master':
          if (req.prompt.includes('스펙 초안')) {
            return { text: JSON.stringify({ reply: '이렇게 만들겠습니다', specDraft: '# 스펙\n\n- 구현 범위: 할 일 추가\n- 제외 범위: 로그인\n- 수용 기준: 추가 가능' }), sessionId: 's-master', usage: USAGE }
          }
          if (req.prompt.includes('교착되어')) {
            return { text: JSON.stringify(o.master?.(req) ?? { action: 'guidance', text: '마스터 지침' }), sessionId: 's-esc', usage: USAGE }
          }
          return { text: '# 최종 보고\n\n모든 태스크 완료 (msg-0001)', sessionId: 's-report', usage: USAGE }
        case 'dev': {
          const id = basename(req.cwd)
          o.onDev?.(id, req)
          if (req.prompt.includes('병합 충돌 파일')) {
            resolveConflict(req.cwd)
            return { text: JSON.stringify({ changedFiles: ['shared.txt'], testsRun: [], claims: ['충돌 해결'] }), sessionId: `dev-${id}`, usage: USAGE }
          }
          const file = o.devFiles?.[id] ?? `src/${id}/a.ts`
          const p = join(req.cwd, file)
          mkdirSync(dirname(p), { recursive: true })
          writeSeq += 1
          writeFileSync(p, `// ${id} ${writeSeq}\n`)
          return { text: JSON.stringify({ changedFiles: [file], testsRun: [], claims: ['구현함'] }), sessionId: `dev-${id}`, usage: USAGE }
        }
        case 'qa': return qaEvidence(req)
        case 'wiki': return { text: JSON.stringify({ files: { 'architecture.md': '# 구조\n\n할 일 목록 모듈' } }), sessionId: 's-wiki', usage: USAGE }
        case 'logQuery': return { text: 'msg-0001 에서 시작했습니다', sessionId: 's-log', usage: USAGE }
        default: throw new Error(`예상하지 못한 역할 ${req.role}`)
      }
    },
    reviewer: (req) => {
      if (req.prompt.includes('계획 검수자')) return o.reviewPlan?.(++planReviewN) ?? APPROVE
      if (req.cwd.includes('.worktrees')) {
        const id = basename(req.cwd)
        const n = (taskN.get(id) ?? 0) + 1
        taskN.set(id, n)
        return o.reviewTask?.(id, n) ?? APPROVE
      }
      return o.reviewFinal?.(++finalN) ?? APPROVE
    },
  }
}

export type TestWorkflowDeps = Omit<WorkflowDeps, 'store'> & { claude: FakeRunner; reviewer: FakeRunner }

export function fakeDeps(script: Script, over: Partial<Config> = {}): TestWorkflowDeps {
  const many = (fn: Script['claude']) => Array.from({ length: 400 }, () => fn)
  return {
    config: { ...structuredClone(DEFAULT_CONFIG), ...over },
    clock: fakeClock,
    claude: new FakeRunner(many(script.claude)),
    reviewer: new FakeRunner(many(script.reviewer)),
  }
}
