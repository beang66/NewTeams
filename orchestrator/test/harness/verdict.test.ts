import { describe, expect, it } from 'vitest'
import type { Verdict } from '../../src/protocol/messages.js'
import { DeadlockTracker, harnessReject, normalizeVerdict, parseVerdict } from '../../src/harness/verdict.js'
import { RunnerError } from '../../src/runners/types.js'

const f = (id: string, severity: 'blocker' | 'major' | 'minor') => ({ id, severity, issue: 'x', file: undefined, evidence_ref: undefined })
const rej = (ids: string[]): Verdict => ({
  verdict: 'reject',
  findings: ids.map((id) => f(id, 'major')),
  resolved: [],
})

describe('normalizeVerdict', () => {
  it('approve인데 major가 있으면 reject', () => {
    expect(normalizeVerdict({ verdict: 'approve', findings: [f('F-1', 'major')], resolved: [] }).verdict).toBe('reject')
  })
  it('minor만 있으면 approve 유지', () => {
    expect(normalizeVerdict({ verdict: 'approve', findings: [f('F-1', 'minor')], resolved: [] }).verdict).toBe('approve')
  })
  it('입력을 변경하지 않는다', () => {
    const v: Verdict = { verdict: 'approve', findings: [f('F-1', 'blocker')], resolved: [] }
    normalizeVerdict(v)
    expect(v.verdict).toBe('approve')
  })
  it('finding 없는 reject는 그대로', () => {
    const v: Verdict = { verdict: 'reject', findings: [], resolved: [] }
    expect(normalizeVerdict(v)).toEqual(v)
  })
})

describe('parseVerdict', () => {
  const json = '{"verdict":"reject","findings":[{"id":"F-1","severity":"minor","file":null,"issue":"x","evidence_ref":null}],"resolved":[]}'
  it('raw JSON', () => {
    const v = parseVerdict(json)
    expect(v.verdict).toBe('reject')
    expect(v.findings[0].file).toBeUndefined()
  })
  it('```json 펜스', () => {
    expect(parseVerdict('```json\n' + json + '\n```').findings).toHaveLength(1)
  })
  it('잘못된 JSON/스키마는 RunnerError(format)', () => {
    for (const bad of ['not json', '{"verdict":"maybe"}']) {
      try { parseVerdict(bad); throw new Error('no throw') } catch (e) {
        expect(e).toBeInstanceOf(RunnerError)
        expect((e as RunnerError).kind).toBe('format')
      }
    }
  })
})

describe('harnessReject', () => {
  it('H-n 블로커 reject', () => {
    const v = harnessReject('t1', ['a', 'b'])
    expect(v).toEqual({
      verdict: 'reject',
      findings: [
        { id: 'H-1', severity: 'blocker', issue: 'a', file: undefined, evidence_ref: undefined },
        { id: 'H-2', severity: 'blocker', issue: 'b', file: undefined, evidence_ref: undefined },
      ],
      resolved: [],
    })
  })
})

describe('DeadlockTracker', () => {
  it('같은 지적 ID 2회면 교착', () => {
    const t = new DeadlockTracker(5, 2)
    expect(t.record('t1', rej(['F-1'])).deadlocked).toBe(false)
    expect(t.record('t1', rej(['F-1', 'F-2']))).toEqual({ deadlocked: true, reason: 'repeat_finding' })
  })
  it('반려 5회면 교착', () => {
    const t = new DeadlockTracker(5, 2)
    for (let i = 1; i <= 4; i++) t.record('t1', rej([`F-${i}`]))
    expect(t.record('t1', rej(['F-5']))).toEqual({ deadlocked: true, reason: 'reject_limit' })
  })
  it('approve는 세지 않고, reset은 기록을 지운다', () => {
    const t = new DeadlockTracker(2, 2)
    t.record('t1', rej(['F-1']))
    expect(t.record('t1', { verdict: 'approve', findings: [], resolved: [] })).toEqual({ deadlocked: false })
    t.reset('t1')
    expect(t.record('t1', rej(['F-1'])).deadlocked).toBe(false)
  })
})
