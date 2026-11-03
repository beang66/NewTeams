import { readFileSync } from 'node:fs'
import type { Finding } from '../protocol/messages.js'
import type { Plan, PlanTask, QaScenario } from '../protocol/plan.js'

export type PromptInput =
  | { role: 'master'; mode: 'intake'; userMessage: string }
  | { role: 'master'; mode: 'escalation'; taskId: string; reason: string; findings: Finding[]; history: string }
  | { role: 'master'; mode: 'report'; timeline: string; iterations: string[] }
  | { role: 'seed'; spec: string; repoMap: string; rules: string }
  | { role: 'planner' }
  | { role: 'dev'; task: PlanTask; worktree: string; findings?: Finding[]; guidance?: string; conflicts?: string[]; setupCommands?: string[]; testCommands?: string[] }
  | { role: 'qa'; task: PlanTask | null; scenarios: QaScenario[]; devCommand: string; evidenceDir: string }
  | { role: 'reviewer'; acceptance: string[]; diff: string; evidenceManifest: string; previousFindings: Finding[] }
  | { role: 'reviewer-followup'; diff: string; evidenceManifest: string; previousFindings: Finding[] }
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

/** 파이프라인 문서(Vault)의 단계별 노트 이름. 노트 파일은 `<폴더>/<이름>.md`. */
export const PIPELINE_NOTES = ['00 파이프라인 설계', '01 요구사항·스펙', '02 시드', '03 기획', '04 개발', '05 검수', '06 통합·위키', '07 최종 QA', '08 보고'] as const
export type PipelineNote = (typeof PIPELINE_NOTES)[number]

/** 역할(단계)마다 읽어야 할 노트. 설계 개요는 항상 함께 붙는다. */
export function pipelineNoteFor(input: PromptInput): PipelineNote | undefined {
  switch (input.role) {
    case 'master': return input.mode === 'intake' ? '01 요구사항·스펙' : input.mode === 'report' ? '08 보고' : '05 검수'
    case 'seed': return '02 시드'
    case 'planner': case 'reviewer-plan': return '03 기획'
    case 'dev': return '04 개발'
    case 'qa': return input.task ? '05 검수' : '07 최종 QA'
    case 'reviewer': case 'reviewer-followup': return '05 검수'
    case 'wiki': return '06 통합·위키'
    case 'logQuery': return undefined
  }
}

/** 전문가 그래프의 시작 키(작업 노드의 applies_to). 그래프에 이 키의 작업이 없으면 단계 노트로 대신한다. */
export function graphKeyFor(input: PromptInput): string | undefined {
  switch (input.role) {
    case 'planner': case 'reviewer-plan': return 'plan'
    case 'dev': return 'dev'
    case 'qa': return input.task ? 'qa' : 'final-qa'
    case 'reviewer': case 'reviewer-followup': return 'review'
    case 'master': return input.mode === 'report' ? 'report' : input.mode === 'intake' ? 'spec' : 'review'
    case 'seed': return 'seed'
    case 'wiki': return 'integrate'
    case 'logQuery': return undefined
  }
}

type Doc = { path: string; text: string; via?: string }
let readNote: ((note: PipelineNote) => Doc | undefined) | undefined
let readGraph: ((key: string) => Doc[]) | undefined
/** 서버가 Vault를 연결하면 노트 읽기를 등록한다. 등록이 없으면(테스트·Vault 없음) 프롬프트는 그대로다. */
export function usePipelineNotes(reader: typeof readNote, graph?: typeof readGraph): void { readNote = reader; readGraph = graph }

/** 매 호출마다 새로 읽어, Vault에서 고친 기준이 다음 에이전트 실행에 바로 반영된다. */
function pipelineSection(input: PromptInput): string {
  const note = pipelineNoteFor(input)
  if (!readNote || !note) return ''
  const key = graphKeyFor(input)
  const graph = key && readGraph ? readGraph(key) : []
  const docs = [readNote('00 파이프라인 설계'), ...(graph.length ? graph : [readNote(note)])].filter((d): d is Doc => !!d)
  if (!docs.length) return ''
  const route = graph.length ? `읽은 경로: ${graph.map((d) => d.via).join(' · ')}\n\n` : ''
  return section('작업 지식 (Vault) — 이 작업의 지식·과정·도구를 따르고, 완료 기준을 모두 채우기 전에는 끝났다고 보고하지 마세요.',
    route + docs.map((d) => `### ${d.path}\n${d.text.trim()}`).join('\n\n'))
}

export function buildPrompt(input: PromptInput): string {
  return buildBase(input) + pipelineSection(input)
}

function buildBase(input: PromptInput): string {
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
        checksSection: input.testCommands?.length
          ? section('자체 검사', [
            '보고 전에 아래 명령을 순서대로 실행한다. 실패하면 원인을 고치고 통과할 때까지 다시 실행한다.',
            '실제로 실행한 명령과 결과만 testsRun에 적는다. 끝내 통과하지 못하면 실패 사실을 claims에 적는다.',
            ...(input.setupCommands?.length ? ['', '설치:', list(input.setupCommands)] : []),
            '', '테스트:', list(input.testCommands),
          ].join('\n'))
          : '',
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
    case 'reviewer-followup':
      return render('reviewer-followup', {
        diff: input.diff, evidenceManifest: input.evidenceManifest, previousFindings: json(input.previousFindings),
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
