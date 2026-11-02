import type { Envelope, Usage } from '../protocol/messages.js'

const SYSTEM = new Set(['harness', 'orchestrator', 'controller'])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** 토큰은 usage를 만든(응답한) 역할에 귀속한다. 대시보드와 서버가 같은 규칙으로 센다. */
export function usageSources(e: Envelope): { role: string; usage: Usage }[] {
  const out: { role: string; usage: Usage }[] = []
  const qa = obj(obj(e.payload).qa).usage as Usage | undefined
  if (e.type === 'REVIEW_REQUEST' && qa) out.push({ role: 'qa', usage: qa })
  if (!e.usage) return out
  if (e.type === 'REPORT' || e.type === 'REVISION') out.push({ role: 'dev', usage: e.usage })
  else if (e.type === 'REJECT' || e.type === 'APPROVE') { if (e.from === 'reviewer') out.push({ role: 'reviewer', usage: e.usage }) }
  else if (e.type === 'GUIDANCE') out.push({ role: 'master', usage: e.usage })
  else if (!SYSTEM.has(e.from) && e.from !== 'user') out.push({ role: e.from, usage: e.usage })
  return out
}

export interface UsageTotal { tokens: number; costUsd: number; hasCost: boolean }
export const emptyTotal = (): UsageTotal => ({ tokens: 0, costUsd: 0, hasCost: false })
export function addUsage(t: UsageTotal, u: Usage): void {
  t.tokens += u.in + u.out
  if (u.costUsd !== undefined) { t.costUsd += u.costUsd; t.hasCost = true }
}

