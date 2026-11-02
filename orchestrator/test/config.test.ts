import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, loadConfig, resolveConfig } from '../src/config.js'

describe('config', () => {
  it('스펙 기본값', () => {
    expect(DEFAULT_CONFIG.maxParallel).toBe(3)
    expect(DEFAULT_CONFIG.rejectLimit).toBe(3)
    expect(DEFAULT_CONFIG.repeatFindingLimit).toBe(2)
    expect(DEFAULT_CONFIG.timeoutsMs).toMatchObject({ dev: 1_200_000, qa: 600_000, reviewer: 300_000, planner: 600_000, wiki: 180_000, master: 600_000, logQuery: 120_000 })
    expect(DEFAULT_CONFIG.openaiCapUsd).toBe(8)
    expect(DEFAULT_CONFIG.mergeConflictRetry).toBe(2)
  })
  it('경로 없으면 기본값', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)
  })
  it('파일 값을 덮어쓰고 timeoutsMs는 깊게 병합', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    const p = join(dir, 'c.json')
    writeFileSync(p, JSON.stringify({ maxParallel: 5, timeoutsMs: { dev: 1 }, openaiPricePerMTok: { in: 1 } }))
    const c = loadConfig(p)
    expect(c.maxParallel).toBe(5)
    expect(c.timeoutsMs.dev).toBe(1)
    expect(c.timeoutsMs.qa).toBe(600_000)
    expect(c.openaiPricePerMTok).toEqual({ in: 1, out: 2.0 })
  })
  it('마스터와 작업 AI 설정을 독립적으로 병합한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    const file = join(dir, 'agents.json')
    writeFileSync(file, JSON.stringify({ agents: { master: { provider: 'codex', model: 'custom-master' }, worker: { provider: 'claude', escalatedModel: 'custom-upgrade' } } }))
    const config = loadConfig(file)
    expect(config.agents.master).toEqual({ provider: 'codex', model: 'custom-master' })
    expect(config.agents.worker).toEqual({ provider: 'claude', escalatedModel: 'custom-upgrade' })
    writeFileSync(file, JSON.stringify({ agents: { worker: { provider: 'unknown' } } }))
    expect(() => loadConfig(file)).toThrow(/agents|provider/)
  })
  it('없는 파일은 경로를 담아 던진다', () => {
    expect(() => loadConfig('/nope/missing.json')).toThrow(/missing\.json/)
  })
})

describe('config telegram', () => {
  it('telegram 기본값', () => {
    expect(DEFAULT_CONFIG.telegram).toEqual({ apiBase: 'https://api.telegram.org', quietHours: null, heartbeatMinutes: 0, batchSeconds: 30, notifyTaskApprovals: false, dashboardUrl: null, pollTimeoutSec: 30 })
  })
  it('잘못된 조용한 시간은 거부', () => {
    expect(() => resolveConfig({ telegram: { quietHours: { start: '25:00', end: '07:00' } } } as any)).toThrow(/telegram/)
    expect(() => resolveConfig({ telegram: { quietHours: { start: '22:00', end: '22:00' } } } as any)).toThrow(/telegram/)
    expect(() => resolveConfig({ telegram: { heartbeatMinutes: 3 } } as any)).toThrow(/telegram/)
  })
  it('숫자와 URL 검증', () => {
    for (const t of [{ pollTimeoutSec: 0 }, { pollTimeoutSec: 1.5 }, { batchSeconds: -1 }, { batchSeconds: 1.5 }, { apiBase: 'nope' }, { dashboardUrl: 'nope' }])
      expect(() => resolveConfig({ telegram: t } as any)).toThrow(/telegram/)
    expect(resolveConfig({ telegram: { dashboardUrl: 'http://localhost:4317', pollTimeoutSec: 1, batchSeconds: 0 } } as any).telegram.dashboardUrl).toBe('http://localhost:4317')
  })
  it('telegram은 깊게 병합되고 telegram 없는 설정도 로드', () => {
    const c = resolveConfig({ telegram: { batchSeconds: 10, quietHours: { start: '23:00', end: '07:00' }, heartbeatMinutes: 60 } } as any)
    expect(c.telegram.batchSeconds).toBe(10)
    expect(c.telegram.pollTimeoutSec).toBe(30)
    expect(c.telegram.quietHours).toEqual({ start: '23:00', end: '07:00' })
    expect(resolveConfig({}).telegram).toEqual(DEFAULT_CONFIG.telegram)
  })
  it.each(['apiBase', 'dashboardUrl'])('%s는 http/https만 허용한다', key => {
    for (const bad of ['javascript:alert(1)', 'ftp://x']) expect(() => resolveConfig({ telegram: { [key]: bad } } as any)).toThrow(/telegram/)
    expect(resolveConfig({ telegram: { [key]: 'https://example.com' } } as any).telegram[key as 'apiBase']).toBe('https://example.com')
  })
})
