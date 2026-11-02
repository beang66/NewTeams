import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dashboardUsage } from '../../src/usage/dashboardUsage.js'

const line = (o: object) => JSON.stringify(o) + '\n'

describe('대시보드 전체 사용량', () => {
  it('모든 프로젝트 이벤트와 스킬 실행(마지막 줄)을 합친다', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-'))
    for (const p of ['a', 'b']) mkdirSync(join(root, p, 'raw'), { recursive: true })
    writeFileSync(join(root, 'a', 'raw', 'events.jsonl'),
      line({ id: 'm1', ts: '2026-11-02T00:00:00Z', type: 'CHAT', from: 'master', to: 'user', usage: { in: 100, out: 20, cached: 0, costUsd: 0.5 } })
      + line({ id: 'm2', ts: '2026-11-02T00:00:00Z', type: 'CHAT', from: 'user', to: 'master', usage: { in: 999, out: 0, cached: 0 } }))
    writeFileSync(join(root, 'b', 'raw', 'events.jsonl'), line({ id: 'm1', ts: '2026-11-02T00:00:00Z', type: 'REPORT', from: 'dev', to: 'controller', usage: { in: 10, out: 5, cached: 0 } }))
    mkdirSync(join(root, 'a', 'skill-runs'))
    writeFileSync(join(root, 'a', 'skill-runs', 'history.jsonl'), line({ id: 's1', status: 'running' }) + line({ id: 's1', status: 'done', usage: { in: 30, out: 10, cached: 0, costUsd: 0.1 } }))
    const u = dashboardUsage(root)
    expect(u.projects).toEqual([{ name: 'a', tokens: 160, costUsd: 0.6, hasCost: true }, { name: 'b', tokens: 15, costUsd: 0, hasCost: false }])
    expect(u.total).toEqual({ tokens: 175, costUsd: 0.6, hasCost: true })
    expect(u.skills.tokens).toBe(40)
  })
})
