import type { Envelope, Finding } from '../protocol/messages.js'
import type { Plan } from '../protocol/plan.js'
import { hhmm, reasonLabel } from '../render/humanRenderer.js'
import type { RunState, Stage } from '../store/state.js'
import type { Callback } from './callbacks.js'

export interface OutMessage {
  text: string
  silent: boolean
  buttons?: { text: string; callback?: Callback; url?: string }[][]
  kind: 'spec' | 'human' | 'login' | 'error' | 'done' | 'stage' | 'paused' | 'resumed' | 'approved' | 'digest' | 'heartbeat' | 'reply'
  eventId?: string
}
export interface FormatContext {
  events: Envelope[]
  state: RunState
  plan: Plan | null
  dashboardUrl: string | null
  specSummary?: string[]
  reportMd?: string | null
}

const STAGE_LABELS: Record<Stage, string> = {
  INTAKE: '요구사항', SPEC_APPROVED: '스펙 승인', SEED: '시드', PLAN: '기획', BUILD: '개발',
  INTEGRATE: '통합', FINAL_QA: '최종 QA', REPORT: '보고', DONE: '완료',
}
export function stageLabel(stage: string): string {
  return Object.hasOwn(STAGE_LABELS, stage) ? STAGE_LABELS[stage as Stage] : stage
}

const SUFFIX = '\n…(대시보드에서 보기)'

/** 텔레그램 4096자 제한용. max 코드 유닛에서 자르되 서로게이트 쌍을 쪼개지 않는다. */
export function clip(text: string, max = 3900): string {
  if (text.length <= max) return text
  let end = max
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1 // 높은 서로게이트로 끝나면 쌍이 깨진다
  return text.slice(0, end) + SUFFIX
}

type P = Record<string, unknown>
const pl = (e: Envelope): P => (e.payload && typeof e.payload === 'object' ? (e.payload as P) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

const LINE_MAX = 200
const cap = (l: string): string => (l.length > LINE_MAX ? l.slice(0, /[\ud800-\udbff]/.test(l[LINE_MAX - 1]!) ? LINE_MAX - 1 : LINE_MAX) + '…' : l)

/** diff 머리글과, 그 뒤 hunk 본문(+/-/공백으로 시작하는 줄)을 버리는 필터 */
function diffFilter(): (l: string) => boolean {
  let inDiff = false
  return (l) => {
    if (/^(diff --git |index |--- |\+\+\+ |@@ )/.test(l)) { inDiff = true; return false }
    if (inDiff && /^[-+ ]/.test(l)) return false
    inDiff = false
    return true
  }
}

/** 코드 블록 통째, diff 줄, 프롬프트 경로를 제거하고 각 줄을 200자로 줄인다. */
function sanitize(s: string): string {
  return s
    .replace(/```[\s\S]*?(```|$)/g, '')
    .split('\n')
    .filter(diffFilter())
    .map((l) => cap(l.replace(/\S*raw[\\/]prompts\S*/g, '')))
    .join('\n')
}
export { sanitize as sanitizeTelegramText }
const oneLine = (s: string): string => cap(sanitize(s).replace(/\s+/g, ' ').trim())
const reasonOf = (v: unknown): string => (str(v) ? reasonLabel(v as string) : '알 수 없음')

function findingsOf(e: Envelope): Finding[] {
  const f = pl(e).findings
  return Array.isArray(f) ? (f as Finding[]).filter((x) => x && typeof x.id === 'string') : []
}

function lastReject(task: string | undefined, events: Envelope[], before?: Envelope): Envelope | undefined {
  const idx = before ? events.findIndex((x) => x.id === before.id) : -1
  const pool = idx >= 0 ? events.slice(0, idx) : events
  for (let i = pool.length - 1; i >= 0; i--) {
    const x = pool[i]!
    if (x.type === 'REJECT' && x.task === task) return x
  }
  return undefined
}

function keyIssue(rej: Envelope | undefined): string | undefined {
  if (!rej) return undefined
  const fs = findingsOf(rej)
  const pick = fs.find((f) => f.severity === 'blocker' || f.severity === 'major') ?? fs[0]
  return pick ? sanitize(pick.issue).replace(/\s+/g, ' ').trim() : undefined
}

function specBody(lines: string[] | undefined): string[] {
  if (!lines || lines.length === 0) return []
  const i = lines.findIndex((l) => l.includes('구현 범위'))
  if (i >= 0) {
    const out: string[] = []
    for (const l of lines.slice(i + 1)) {
      if (/^\s*[-*•]\s+/.test(l)) out.push(l.trim())
      else if (out.length > 0) break
      else if (l.trim() !== '') break
      if (out.length >= 8) break
    }
    if (out.length > 0) return out
  }
  const first = lines.find((l) => l.trim() !== '')
  return first ? [first.replace(/^#+\s*/, '').trim()] : []
}

function acceptanceCount(md: string | null | undefined): { n: string; m: string } | null {
  const hit = md ? /수용 기준 (\d+)\s*\/\s*(\d+)/.exec(md) : null
  return hit ? { n: hit[1]!, m: hit[2]! } : null
}

function prevStageLabel(e: Envelope, events: Envelope[]): string | undefined {
  const idx = events.findIndex((x) => x.id === e.id)
  const pool = idx >= 0 ? events.slice(0, idx) : events
  for (let i = pool.length - 1; i >= 0; i--) {
    const x = pool[i]!
    if (x.type === 'STATE_CHANGE' && typeof pl(x).stage === 'string') return stageLabel(pl(x).stage as string)
  }
  return undefined
}

const btn = (text: string, callback: Callback): { text: string; callback: Callback } => ({ text, callback })

export function messageForEvent(e: Envelope, ctx: FormatContext): OutMessage | null {
  const p = pl(e)
  switch (e.type) {
    case 'CHAT': {
      if (e.from !== 'master' || p.specApprovalRequired !== true) return null
      const body = specBody(ctx.specSummary ? sanitize(ctx.specSummary.join('\n')).split('\n') : undefined)
      const row = [btn('승인', { kind: 'approve' })] as { text: string; callback?: Callback; url?: string }[]
      if (ctx.dashboardUrl) row.push({ text: '대시보드에서 보기', url: ctx.dashboardUrl })
      return {
        kind: 'spec', silent: false, eventId: e.id, buttons: [row],
        text: clip(['🟣 스펙 초안 준비됨 — 승인하면 작업을 시작합니다', ...body].join('\n')),
      }
    }
    case 'HUMAN_REQUIRED': {
      const reason = str(p.reason) ?? ''
      const detail = str(p.detail)
      const extra = detail ? `\n${sanitize(detail)}` : ''
      if (reason === 'auth' || reason === 'openai_cap') {
        const head = reason === 'openai_cap' ? '🔴 멈춤 — OpenAI API 지출 상한($8) 도달' : '🔴 멈춤 — 터미널에서 다시 로그인 필요'
        return { kind: 'login', silent: false, eventId: e.id, buttons: [[btn('재개', { kind: 'resume' })]], text: clip(head + extra) }
      }
      const who = e.task ?? '전체'
      if (reason === 'workflow_error') {
        return {
          kind: 'error', silent: false, eventId: e.id, buttons: [[btn('자세히', { kind: 'detail', eventId: e.id })]],
          text: clip(`🔴 ${who} 워크플로 오류 — ${reasonOf(reason)}${extra}`),
        }
      }
      const issue = keyIssue(lastReject(e.task, ctx.events, e)) ?? (detail ? sanitize(detail).replace(/\s+/g, ' ').trim() : undefined)
      return {
        kind: 'human', silent: false, eventId: e.id,
        // plan 태스크의 건너뛰기는 Workflow가 지침으로 취급하므로 제공하지 않는다.
        buttons: [[btn('지침 쓰기', { kind: 'guide', eventId: e.id }), ...(e.task === 'plan' ? [] : [btn('건너뛰기', { kind: 'skip', eventId: e.id })]), btn('자세히', { kind: 'detail', eventId: e.id })]],
        text: clip(`🔴 ${who} 사람 필요 — ${reasonOf(reason)}${issue ? `: ${issue}` : ''}`),
      }
    }
    case 'STATE_CHANGE': {
      const s = str(p.stage)
      if (!s) return null
      if (s === 'DONE') {
        const acc = acceptanceCount(ctx.reportMd)
        return {
          kind: 'done', silent: false, eventId: e.id, buttons: [[btn('보고서', { kind: 'report' })]],
          text: clip(acc ? `✅ 완료 — 수용 기준 ${acc.n}/${acc.m}` : '✅ 완료'),
        }
      }
      const prev = prevStageLabel(e, ctx.events)
      return { kind: 'stage', silent: true, eventId: e.id, text: prev ? `${prev} → ${stageLabel(s)}` : stageLabel(s) }
    }
    case 'PAUSED': {
      const until = str(p.until)
      const why = reasonOf(p.reason)
      return { kind: 'paused', silent: true, eventId: e.id, text: `⏸ 일시정지 — ${why}${until ? `, ${hhmm(until)} 재개 예정` : ''}` }
    }
    case 'RESUMED':
      return { kind: 'resumed', silent: true, eventId: e.id, text: '▶ 재개' }
    case 'APPROVE':
      return { kind: 'approved', silent: true, eventId: e.id, text: `✅ ${e.task ?? '?'} 승인${e.round ? ` (${e.round}회차)` : ''}` }
    default:
      return null
  }
}

const RUNNING = new Set(['running', 'review'])
export function statusText(ctx: FormatContext): string {
  const tasks = Object.values(ctx.state.tasks)
  const running = tasks.filter((t) => RUNNING.has(t.status)).length
  const rejected = tasks.filter((t) => t.status === 'rejected').length
  const lines = [
    `단계: ${stageLabel(ctx.state.stage)}`,
    `진행 중 ${running} · 반려 ${rejected} · 주의 ${ctx.state.humanRequired.length}`,
  ]
  const pz = ctx.state.paused
  if (pz) lines.push(`⏸ 일시정지 — ${reasonOf(pz.reason)}${pz.until ? `, ${hhmm(pz.until)} 재개 예정` : ''}`)
  return clip(lines.join('\n'))
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기', running: '진행 중', review: '리뷰 중', rejected: '반려', approved: '승인', merged: '병합됨', blocked: '막힘',
}
export function tasksText(ctx: FormatContext): string {
  const ids = ctx.plan ? ctx.plan.tasks.map((t) => t.id) : Object.keys(ctx.state.tasks)
  if (ids.length === 0) return '아직 태스크가 없습니다'
  const title = new Map(ctx.plan?.tasks.map((t) => [t.id, t.title]) ?? [])
  const lines = ids.map((id) => {
    const st = ctx.state.tasks[id]
    const label = STATUS_LABEL[st?.status ?? 'pending'] ?? st?.status ?? '대기'
    const t = title.get(id)
    return `${id}${t && t !== id ? ` ${t}` : ''} — ${label}${st && st.round > 0 ? ` (${st.round}회차)` : ''}`
  })
  return clip(lines.join('\n'))
}

export function detailText(eventId: string, ctx: FormatContext): string {
  const e = ctx.events.find((x) => x.id === eventId)
  if (!e) return '이벤트를 찾을 수 없습니다'
  const task = e.task
  const reason = str(pl(e).reason)
  const lines = [`${task ?? '전체'} 상세${reason ? ` — ${reasonLabel(reason)}` : ''}`]
  const idx = ctx.events.indexOf(e)
  const before = ctx.events.slice(0, idx + 1)
  const mine = (x: Envelope): boolean => x.task === task
  const rejects = before.filter((x) => x.type === 'REJECT' && mine(x))
  const round = e.round ?? rejects.at(-1)?.round ?? (task ? ctx.state.tasks[task]?.round : undefined)
  if (round) lines.push(`${round}회차`)
  const detail = str(pl(e).detail)
  if (detail) lines.push(sanitize(detail))

  const seen = new Map<string, { f: Finding; count: number }>()
  for (const r of rejects) for (const f of findingsOf(r)) {
    const cur = seen.get(f.id)
    seen.set(f.id, { f, count: (cur?.count ?? 0) + 1 })
  }
  const all = [...seen.values()]
  const repeated = all.filter((x) => x.count > 1)
  const list = repeated.length > 0 ? repeated : (rejects.at(-1) ? findingsOf(rejects.at(-1)!).map((f) => ({ f, count: seen.get(f.id)?.count ?? 1 })) : [])
  if (list.length > 0) {
    lines.push('', repeated.length > 0 ? '반복된 지적:' : '최근 지적:')
    for (const { f, count } of list) lines.push(`- ${f.id} [${f.severity}] ${sanitize(f.issue).replace(/\s+/g, ' ').trim()}${count > 1 ? ` (${count}회)` : ''}`)
  }
  const guides = before.filter((x) => x.type === 'GUIDANCE' && mine(x))
  if (guides.length > 0) {
    lines.push('', '마스터 지침:')
    for (const g of guides) lines.push(`- ${sanitize(String(pl(g).text ?? '')).replace(/\s+/g, ' ').trim()}`)
  }
  return clip(lines.join('\n'))
}

export function reportSummary(reportMd: string | null, _ctx: FormatContext): string {
  if (!reportMd || reportMd.trim() === '') return '보고서가 아직 없습니다'
  const safe = sanitize(reportMd)
  const lines = safe
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trimEnd())
    .filter((l) => l.trim() !== '' && !/^diff --git/.test(l) && !/raw\/prompts/.test(l))
  const acc = acceptanceCount(safe)
  const head = acc ? `✅ 수용 기준 ${acc.n}/${acc.m}` : null
  return clip([...(head ? [head] : []), ...lines.slice(0, 30)].join('\n'))
}
