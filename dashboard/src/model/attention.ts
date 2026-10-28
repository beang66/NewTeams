import type { Envelope, Finding } from '@orch/protocol/messages'
import type { RunState } from '@orch/store/state'

export type AttentionItem =
  | { kind: 'spec'; draftPath: 'spec.draft.md' }
  | { kind: 'human'; eventId: string; task?: string; reason: string; detail: string; findings: Finding[]; tried: string[] }
  | { kind: 'login'; eventId: string }

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
    if (reason === 'auth') { items.push({ kind: 'login', eventId: id }); continue }
    let findings: Finding[] = []
    const tried: string[] = []
    if (ev.task) {
      let rejectAt = -1
      events.forEach((e, i) => { if (e.type === 'REJECT' && e.task === ev.task && i < idx) rejectAt = i })
      if (rejectAt >= 0) {
        const f = obj(events[rejectAt]!.payload).findings
        findings = Array.isArray(f) ? (f as Finding[]) : []
      }
      for (const e of events.slice(rejectAt + 1)) {
        const text = obj(e.payload).text
        if (e.type === 'GUIDANCE' && e.task === ev.task && typeof text === 'string') tried.push(text)
      }
    }
    items.push({ kind: 'human', eventId: id, task: ev.task, reason, detail: typeof p.detail === 'string' ? p.detail : '', findings, tried })
  }
  return items
}
