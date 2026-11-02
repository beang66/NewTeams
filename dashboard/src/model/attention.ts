import type { Envelope, Finding } from '@orch/protocol/messages'
import type { RunState } from '@orch/store/state'

export type AttentionItem =
  | { kind: 'spec'; draftPath: 'spec.draft.md' }
  | { kind: 'human'; eventId: string; task?: string; reason: string; detail: string; findings: Finding[]; tried: string[]; since: string }
  | { kind: 'login'; eventId: string; since: string }

/** Pauses that only a human [재개] ends; a later RESUMED means the human already acted. */
const RESUME_CLEARS = new Set(['auth', 'openai_cap'])

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function attentionItems(state: RunState, events: Envelope[], opts: { hasSpecDraft: boolean }): AttentionItem[] {
  const items: AttentionItem[] = []
  if (state.stage === 'INTAKE' && opts.hasSpecDraft) items.push({ kind: 'spec', draftPath: 'spec.draft.md' })
  for (const id of state.humanRequired) {
    const idx = events.findIndex((e) => e.id === id)
    if (idx < 0) continue
    const ev = events[idx]!
    const p = obj(ev.payload)
    const reason = typeof p.reason === 'string' ? p.reason : ''
    // 사람이 [재개]하면 서버는 RESUMED만 발행한다(humanRequired는 GUIDANCE로만 비워진다). 재개된 로그인·상한 요청은 더 이상 사람 차례가 아니다.
    if (RESUME_CLEARS.has(reason) && events.slice(idx + 1).some((e) => e.type === 'RESUMED')) continue
    if (reason === 'auth') { items.push({ kind: 'login', eventId: id, since: ev.ts }); continue }
    let findings: Finding[] = []
    const tried: string[] = []
    if (ev.task) {
      let rejectAt = -1
      events.forEach((e, i) => { if (e.type === 'REJECT' && e.task === ev.task && i < idx) rejectAt = i })
      if (rejectAt >= 0) {
        const f = obj(events[rejectAt]!.payload).findings
        findings = Array.isArray(f) ? (f as Finding[]) : []
      }
      for (const e of events.slice(rejectAt + 1, idx)) {
        const text = obj(e.payload).text
        if (e.type === 'GUIDANCE' && e.task === ev.task && typeof text === 'string') tried.push(text)
      }
    }
    items.push({ kind: 'human', eventId: id, task: ev.task, reason, detail: typeof p.detail === 'string' ? p.detail : '', findings, tried, since: ev.ts })
  }
  return items
}
