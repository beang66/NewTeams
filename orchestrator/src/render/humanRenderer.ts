// 네임스페이스 import: 대시보드가 이 파일을 브라우저에서 불러도 로드 시점에 node:fs에 접근하지 않게
import * as fs from 'node:fs/promises'
import type { Envelope, Verdict } from '../protocol/messages.js'
import { PlanSchema, type Plan } from '../protocol/plan.js'
import type { ProjectStore } from '../store/projectStore.js'

const REASONS: Record<string, string> = {
  rate_limit: '사용량 한도',
  auth: '로그인 만료',
  repeat_finding: '같은 지적 반복',
  reject_limit: '반려 상한 도달',
  permission: '권한 부족',
  repeat_error: '같은 오류 반복',
}
const reasonText = (code: unknown): string => (typeof code === 'string' ? REASONS[code] ?? code : '알 수 없음')

/** 사유 코드 → 사람이 읽는 문구 (표에 없으면 코드 그대로) */
export function reasonLabel(code: string): string {
  return Object.hasOwn(REASONS, code) ? REASONS[code]! : code
}

export const rawLink = (id: string): string => `[원본](../raw/events.jsonl#${id})`

/** ISO 시각 → 로컬 HH:mm */
export function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type P = Record<string, unknown>
const pl = (e: Envelope): P => (e.payload && typeof e.payload === 'object' ? (e.payload as P) : {})
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function renderTimeline(events: Envelope[]): string {
  const lines: string[] = []
  for (const e of events) {
    const p = pl(e)
    const texts: string[] = []
    switch (e.type) {
      case 'STATE_CHANGE': {
        if (typeof p.stage === 'string') texts.push(`단계: ${p.stage}`)
        const task = e.task ?? (typeof p.task === 'string' ? p.task : undefined)
        if (task && typeof p.taskStatus === 'string') texts.push(`${task} 상태: ${p.taskStatus}`)
        break
      }
      case 'PAUSED':
        texts.push(`일시정지 — 사유: ${reasonText(p.reason)}${typeof p.until === 'string' ? `, 재개 예정 ${hhmm(p.until)}` : ''}`)
        break
      case 'RESUMED': texts.push('재개'); break
      case 'ESCALATE': texts.push(`${e.task ?? '?'} → 마스터 호출 (${reasonText(p.reason)})`); break
      case 'HUMAN_REQUIRED': texts.push(`${e.task ?? '?'} 사람 개입 필요 (${reasonText(p.reason)})`); break
      case 'GUIDANCE': texts.push(`${e.task ?? '?'} 마스터 지침`); break
      case 'REPORT': case 'REVISION': texts.push(`${e.task ?? '?'} 제출${e.round ? ` (${e.round}회차)` : ''}`); break
      case 'REJECT': texts.push(`${e.task ?? '?'} 반려${e.round ? ` (${e.round}회차)` : ''}`); break
      case 'APPROVE': texts.push(`${e.task ?? '?'} 승인`); break
      default: break
    }
    for (const t of texts) lines.push(`- ${hhmm(e.ts)} ${t} ${rawLink(e.id)}`)
  }
  return `# 타임라인\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`
}

function findingLines(v: Partial<Verdict>): string[] {
  return (v.findings ?? []).map((f) => `- ${f.id} [${f.severity}] ${f.issue}${f.file ? ` (${f.file})` : ''}`)
}

export function renderIteration(taskId: string, events: Envelope[]): string {
  const rounds = new Map<number, string[]>()
  let last = 1
  const add = (round: number, ...lines: string[]): void => {
    rounds.set(round, [...(rounds.get(round) ?? []), ...lines])
  }
  for (const e of events.filter((x) => x.task === taskId)) {
    const round = e.round ?? last
    last = round
    const p = pl(e)
    const link = rawLink(e.id)
    switch (e.type) {
      case 'REPORT': case 'REVISION': {
        add(round, `### ${e.type === 'REPORT' ? '제출' : '수정'} ${link}`)
        const files = strs(p.changedFiles), tests = strs(p.testsRun), claims = strs(p.claims), addressed = strs(p.addressed)
        if (addressed.length) add(round, `- 반영한 지적: ${addressed.join(', ')}`)
        if (files.length) add(round, `- 변경 파일: ${files.join(', ')}`)
        if (tests.length) add(round, `- 실행한 테스트: ${tests.join(', ')}`)
        for (const c of claims) add(round, `- 주장: ${c}`)
        break
      }
      case 'REJECT':
        add(round, `### ❌ 반려 (${e.from}) ${link}`, ...findingLines(p as Partial<Verdict>))
        break
      case 'APPROVE':
        add(round, `### ✅ 승인 ${link}`)
        break
      case 'ESCALATE':
        add(round, `### 마스터 호출 (${reasonText(p.reason)}) ${link}`, ...(typeof p.detail === 'string' ? [`- ${p.detail}`] : []))
        break
      case 'GUIDANCE':
        add(round, `### 마스터 지침 [${String(p.action)}] ${link}`, `- ${String(p.text ?? '')}`)
        break
      case 'HUMAN_REQUIRED':
        add(round, `### 사람 개입 필요 (${reasonText(p.reason)}) ${link}`, ...(typeof p.detail === 'string' ? [`- ${p.detail}`] : []))
        break
      default: break
    }
  }
  const out = [`# ${taskId === 'plan' ? '기획' : taskId} 진행 기록`]
  for (const r of [...rounds.keys()].sort((a, b) => a - b)) {
    out.push('', `## ${r}회차`, '', ...rounds.get(r)!)
  }
  return out.join('\n') + '\n'
}

export function renderIntake(events: Envelope[]): string {
  const parts = events
    .filter((e) => e.type === 'CHAT')
    .map((e) => `**${e.from === 'user' ? '사용자' : '마스터'}:** ${String(pl(e).text ?? '')}`)
  return `# 요구사항 대화\n\n${parts.join('\n\n')}${parts.length ? '\n' : ''}`
}

export function renderDecisions(events: Envelope[]): string {
  const lines: string[] = []
  for (const e of events) {
    const p = pl(e)
    const t = hhmm(e.ts)
    const link = rawLink(e.id)
    const detail = typeof p.detail === 'string' ? ` — ${p.detail}` : ''
    if (e.type === 'STATE_CHANGE' && p.stage === 'SPEC_APPROVED') lines.push(`- ${t} 스펙 승인 ${link}`)
    else if (e.type === 'ESCALATE') lines.push(`- ${t} ${e.task ?? '?'} 마스터 호출 (${reasonText(p.reason)})${detail} ${link}`)
    else if (e.type === 'GUIDANCE' && p.action === 'resume')
      lines.push(`- ${t} 사람 재개${typeof p.resolves === 'string' ? ` (해결: ${p.resolves})` : ''} ${link}`)
    else if (e.type === 'GUIDANCE')
      lines.push(`- ${t} ${e.task ?? '?'} 마스터 지침 [${String(p.action)}]: ${String(p.text ?? '')}${typeof p.resolves === 'string' ? ` (해결: ${p.resolves})` : ''} ${link}`)
    else if (e.type === 'HUMAN_REQUIRED') lines.push(`- ${t} ${e.task ?? '?'} 사람 개입 필요 (${reasonText(p.reason)})${detail} ${link}`)
  }
  return `# 결정 기록\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`
}

export function renderPlan(plan: Plan): string {
  const out = ['# 계획', '']
  for (const t of plan.tasks) {
    out.push(`## ${t.id} ${t.title}`, '', `- 난이도: ${t.difficulty}`, `- 의존: ${t.deps.length ? t.deps.join(', ') : '없음'}`,
      `- 담당 파일: ${t.ownedFiles.join(', ') || '없음'}`, '- 인수 조건:', ...t.acceptance.map((a) => `  - ${a}`))
    if (t.qaScenarios.length) {
      out.push('- QA 시나리오:')
      for (const q of t.qaScenarios) out.push(`  - ${q.id}: ${q.steps.join(' → ')}`)
    }
    out.push('')
  }
  out.push('## 명령', '')
  if (plan.setupCommands?.length) out.push(`- 설치: ${plan.setupCommands.map((c) => `\`${c}\``).join(', ')}`)
  out.push(`- 테스트: ${plan.testCommands.map((c) => `\`${c}\``).join(', ') || '없음'}`, `- 개발 서버: \`${plan.devCommand}\``)
  return out.join('\n') + '\n'
}

export async function renderAll(store: ProjectStore): Promise<void> {
  const events = await store.readEvents()
  await store.writeHuman('intake.md', renderIntake(events))
  await store.writeHuman('timeline.md', renderTimeline(events))
  await store.writeHuman('decisions.md', renderDecisions(events))
  let planText: string | undefined
  try {
    planText = await fs.readFile(store.paths.plan, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  if (planText !== undefined) await store.writeHuman('plan.md', renderPlan(PlanSchema.parse(JSON.parse(planText))))
  const tasks = new Set<string>()
  for (const e of events) if (e.task) tasks.add(e.task)
  for (const id of tasks) await store.writeHuman(`iterations/${id}.md`, renderIteration(id, events))
}
