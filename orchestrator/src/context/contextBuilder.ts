import { readFileSync } from 'node:fs'
import type { Finding } from '../protocol/messages.js'
import type { Plan, PlanTask, QaScenario } from '../protocol/plan.js'

export type PromptInput =
  | { role: 'master'; mode: 'intake'; userMessage: string }
  | { role: 'master'; mode: 'escalation'; taskId: string; reason: string; findings: Finding[]; history: string }
  | { role: 'master'; mode: 'report'; timeline: string; iterations: string[] }
  | { role: 'seed'; spec: string; repoMap: string; rules: string }
  | { role: 'planner' }
  | { role: 'dev'; task: PlanTask; worktree: string; findings?: Finding[]; guidance?: string; conflicts?: string[] }
  | { role: 'qa'; task: PlanTask | null; scenarios: QaScenario[]; devCommand: string; evidenceDir: string }
  | { role: 'reviewer'; acceptance: string[]; diff: string; evidenceManifest: string; previousFindings: Finding[] }
  | { role: 'reviewer-plan'; spec: string; plan: Plan; previousFindings: Finding[] }
  | { role: 'wiki'; taskId: string; diff: string; iterationSummary: string; currentWiki: string }
  | { role: 'logQuery'; question: string; timeline: string }

// dist/context/ 와 src/context/ 모두 ../../prompts 가 orchestrator/prompts 를 가리킨다.
const PROMPTS_DIR = new URL('../../prompts/', import.meta.url)
const PLACEHOLDER = /\{\{(\w+)\}\}/g

const json = (v: unknown): string => '```json\n' + JSON.stringify(v, (_k, x) => (x === undefined ? null : x), 2) + '\n```'
const list = (xs: string[]): string => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '(없음)')
const section = (title: string, body: string): string => `\n## ${title}\n${body}\n`

function render(name: string, vars: Record<string, string>): string {
  const tpl = readFileSync(new URL(`${name}.md`, PROMPTS_DIR), 'utf8')
  // 한 번만 치환하므로 값 안의 `{{x}}` 는 다시 해석되지 않는다.
  return tpl.replace(PLACEHOLDER, (_m, key: string) => {
    if (!(key in vars)) throw new Error(`프롬프트 템플릿 ${name}.md: 채워지지 않은 자리표시자 {{${key}}}`)
    return vars[key]!
  })
}

export function buildPrompt(input: PromptInput): string {
  switch (input.role) {
    case 'master':
      switch (input.mode) {
        case 'intake': return render('master-intake', { userMessage: input.userMessage })
        case 'escalation':
          return render('master-escalation', {
            taskId: input.taskId, reason: input.reason, findings: json(input.findings), history: input.history,
          })
        case 'report':
          return render('master-report', { timeline: input.timeline, iterations: list(input.iterations) })
      }
      throw new Error('알 수 없는 master mode')
    case 'seed': return render('seed', { spec: input.spec, repoMap: input.repoMap, rules: input.rules })
    case 'planner': return render('planner', {})
    case 'dev':
      return render('dev', {
        task: json(input.task),
        worktree: input.worktree,
        findingsSection: input.findings?.length ? section('수정할 지적 목록', json(input.findings)) : '',
        guidanceSection: input.guidance ? section('마스터 지침', input.guidance) : '',
        conflictsSection: input.conflicts?.length ? section('병합 충돌 파일', list(input.conflicts)) : '',
      })
    case 'qa':
      return render('qa', {
        task: input.task ? json(input.task) : '(전체 통합 검증)',
        scenarios: json(input.scenarios),
        devCommand: input.devCommand,
        evidenceDir: input.evidenceDir,
      })
    case 'reviewer':
      return render('reviewer', {
        acceptance: list(input.acceptance),
        diff: input.diff,
        evidenceManifest: input.evidenceManifest,
        previousFindings: json(input.previousFindings),
      })
    case 'reviewer-plan':
      return render('reviewer-plan', {
        spec: input.spec, plan: json(input.plan), previousFindings: json(input.previousFindings),
      })
    case 'wiki':
      return render('wiki', {
        taskId: input.taskId, diff: input.diff, iterationSummary: input.iterationSummary, currentWiki: input.currentWiki,
      })
    case 'logQuery': return render('logQuery', { question: input.question, timeline: input.timeline })
  }
}
