import { describe, it, expect } from 'vitest'
import { EnvelopeSchema, FindingSchema, VerdictSchema, verdictJsonSchema, type Finding } from '../../src/protocol/messages.js'

describe('Finding optional keys', () => {
  it('file and evidence_ref can be omitted in the Finding type (type-level test)', () => {
    const f: Finding = { id: 'F-1', severity: 'minor', issue: 'x' }
    expect(f.issue).toBe('x')
  })
  it('missing file/evidence_ref parse to undefined', () => {
    const parsed = FindingSchema.parse({ id: 'F-1', severity: 'minor', issue: 'x' })
    expect(parsed.file).toBeUndefined()
    expect(parsed.evidence_ref).toBeUndefined()
  })
})

describe('messages', () => {
  it('Verdict 스키마는 잘못된 severity를 거부', () => {
    expect(VerdictSchema.safeParse({ verdict: 'reject', findings: [{ id: 'F-1', severity: 'huge', issue: 'x' }], resolved: [] }).success).toBe(false)
  })
  it('올바른 Verdict 통과', () => {
    expect(VerdictSchema.safeParse({ verdict: 'approve', findings: [], resolved: [] }).success).toBe(true)
  })
  it('Envelope 파싱, CHAT 허용, 잘못된 type 거부', () => {
    const base = { id: '1', ts: '2026-01-01T00:00:00Z', from: 'a', to: 'b', payload: { x: 1 } }
    expect(EnvelopeSchema.safeParse({ ...base, type: 'CHAT' }).success).toBe(true)
    expect(EnvelopeSchema.safeParse({ ...base, type: 'NOPE' }).success).toBe(false)
  })
  it('verdictJsonSchema는 필수 필드와 additionalProperties false', () => {
    const s = verdictJsonSchema as any
    expect(s.required).toEqual(expect.arrayContaining(['verdict', 'findings', 'resolved']))
    expect(s.additionalProperties).toBe(false)
    expect(s.properties.findings.items.additionalProperties).toBe(false)
  })
})

describe('verdictJsonSchema strict', () => {
  const walk = (n: any, path: string, out: string[]) => {
    if (n && typeof n === 'object') {
      if (n.properties) {
        if (JSON.stringify([...(n.required ?? [])].sort()) !== JSON.stringify(Object.keys(n.properties).sort())) out.push(path)
        for (const [k, v] of Object.entries(n.properties)) walk(v, `${path}.${k}`, out)
      }
      if (n.items) walk(n.items, `${path}[]`, out)
    }
  }
  it('모든 객체 레벨에서 required == properties 키', () => {
    const bad: string[] = []
    walk(verdictJsonSchema, '$', bad)
    expect(bad).toEqual([])
  })
  it('file: null 도 파싱되고 undefined로 정규화', () => {
    const r = VerdictSchema.safeParse({ verdict: 'reject', findings: [{ id: 'F-1', severity: 'major', file: null, issue: 'x', evidence_ref: null }], resolved: [] })
    expect(r.success).toBe(true)
    if (r.success) { expect(r.data.findings[0].file).toBeUndefined(); expect(r.data.findings[0].evidence_ref).toBeUndefined() }
  })
})
