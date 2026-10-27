import { VerdictSchema, type Finding, type Verdict } from '../protocol/messages.js'
import { RunnerError } from '../runners/types.js'

/** 하네스 검사 실패를 LLM 리뷰 없이 곧바로 반려로 바꾼다. taskId는 향후 id 접두사용으로 예약. */
export function harnessReject(_taskId: string, problems: string[]): Verdict {
  const findings: Finding[] = problems.map((issue, i) => ({
    id: `H-${i + 1}`,
    severity: 'blocker',
    issue,
    file: undefined,
    evidence_ref: undefined,
  }))
  return { verdict: 'reject', findings, resolved: [] }
}

export function parseVerdict(text: string): Verdict {
  const trimmed = text.trim()
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed)
  const body = fence ? fence[1] : trimmed
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch (e) {
    throw new RunnerError('format', `판정 JSON 파싱 실패: ${(e as Error).message}`)
  }
  const parsed = VerdictSchema.safeParse(raw)
  if (!parsed.success) throw new RunnerError('format', `판정 스키마 불일치: ${parsed.error.message}`)
  return parsed.data
}

/** approve인데 blocker/major가 있으면 reject로 바로잡는다. 입력은 변경하지 않는다. */
export function normalizeVerdict(v: Verdict): Verdict {
  if (v.verdict === 'approve' && v.findings.some((f) => f.severity === 'blocker' || f.severity === 'major')) {
    return { ...v, verdict: 'reject' }
  }
  return v
}

export class DeadlockTracker {
  private rejects = new Map<string, number>()
  private appearances = new Map<string, Map<string, number>>()

  constructor(private rejectLimit: number, private repeatFindingLimit: number) {}

  record(taskId: string, v: Verdict): { deadlocked: boolean; reason?: 'reject_limit' | 'repeat_finding' } {
    if (v.verdict === 'approve') return { deadlocked: false }
    const count = (this.rejects.get(taskId) ?? 0) + 1
    this.rejects.set(taskId, count)
    const seen = this.appearances.get(taskId) ?? new Map<string, number>()
    this.appearances.set(taskId, seen)
    let repeated = false
    for (const id of new Set(v.findings.map((f) => f.id))) {
      const n = (seen.get(id) ?? 0) + 1
      seen.set(id, n)
      if (n >= this.repeatFindingLimit) repeated = true
    }
    if (repeated) return { deadlocked: true, reason: 'repeat_finding' }
    if (count >= this.rejectLimit) return { deadlocked: true, reason: 'reject_limit' }
    return { deadlocked: false }
  }

  reset(taskId: string): void {
    this.rejects.delete(taskId)
    this.appearances.delete(taskId)
  }
}
