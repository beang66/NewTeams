import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { PauseGate } from '../../src/engine/pauseGate.js'
import { EventBus } from '../../src/bus/eventBus.js'
import { ProjectStore } from '../../src/store/projectStore.js'
import { RunnerError } from '../../src/runners/types.js'
import type { Envelope } from '../../src/protocol/messages.js'
import { rebuildState } from '../../src/store/state.js'
import { tmpDir, recordingClock, type RecordingClock } from '../helpers.js'

let root: string
let bus: EventBus
let clock: RecordingClock
let log: Envelope[]
const T0 = new Date('2026-10-26T00:00:00.000Z')
const at = (m: number) => new Date(T0.getTime() + m * 60_000)
const types = () => log.map((e) => e.type)

function onceFailing<T>(err: RunnerError, ok: T) {
  let n = 0
  return vi.fn(async () => { if (n++ === 0) throw err; return ok })
}

beforeEach(async () => {
  root = await tmpDir()
  const store = new ProjectStore(join(root, 'proj'))
  await store.init()
  clock = recordingClock(T0)
  bus = new EventBus(store, clock)
  log = []
  bus.subscribe((e) => log.push(e))
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }) })

describe('PauseGate', () => {
  it('동시에 3개가 한도에 걸려도 PAUSED 1개, 재개 시각은 최댓값', async () => {
    const gate = new PauseGate(bus, clock)
    const fns = [10, 30, 20].map((m) => onceFailing(new RunnerError('rate_limit', 'limit', at(m)), m))
    const out = await Promise.all(fns.map((f) => gate.guard(f)))
    expect(out).toEqual([10, 30, 20])
    expect(types().filter((t) => t === 'PAUSED')).toHaveLength(1)
    expect(types().filter((t) => t === 'RESUMED')).toHaveLength(1)
    expect(clock.sleptUntil()).toEqual(at(30))
    expect(log.find((e) => e.type === 'PAUSED')!.payload).toMatchObject({ reason: 'rate_limit' })
    expect(fns.every((f) => f.mock.calls.length === 2)).toBe(true)
    expect(gate.paused).toBe(false)
  })

  it('resetAt이 없으면 1시간 뒤까지 기다린다', async () => {
    const gate = new PauseGate(bus, clock)
    await gate.guard(onceFailing(new RunnerError('rate_limit', 'x'), 1))
    expect(clock.sleptUntil()).toEqual(at(60))
    expect(log[0]).toMatchObject({ from: 'orchestrator', to: 'all' })
  })

  it('재개 후 또 한도면 새 pause (PAUSED 2회)', async () => {
    const gate = new PauseGate(bus, clock)
    let n = 0
    const fn = async () => { if (n++ < 2) throw new RunnerError('rate_limit', 'x', at(10 * n)); return 'ok' }
    await expect(gate.guard(fn)).resolves.toBe('ok')
    expect(types()).toEqual(['PAUSED', 'RESUMED', 'PAUSED', 'RESUMED'])
  })

  it('auth는 사람이 재개할 때까지 기다린다', async () => {
    const gate = new PauseGate(bus, clock)
    const p = gate.guard(onceFailing(new RunnerError('auth', 'login'), 'done'))
    await vi.waitFor(() => expect(types()).toEqual(['PAUSED', 'HUMAN_REQUIRED']))
    expect(gate.paused).toBe(true)
    expect(clock.sleeps).toHaveLength(0)
    expect(log[0]!.payload).toEqual({ reason: 'auth' })
    expect(log[0]).toMatchObject({ from: 'orchestrator', to: 'all' })
    expect(log[1]!.payload).toEqual({ reason: 'auth', detail: '터미널에서 다시 로그인 필요' })
    await gate.resumeByHuman()
    await expect(p).resolves.toBe('done')
    expect(types()).toEqual(['PAUSED', 'HUMAN_REQUIRED', 'GUIDANCE', 'RESUMED'])
    expect(log[2]).toMatchObject({ from: 'user', payload: { action: 'resume', resolves: log[1]!.id } })
    expect(rebuildState(log).humanRequired).toEqual([])
    expect(gate.paused).toBe(false)
  })

  it('rate_limit 정지 중 auth가 오면 사람 재개 모드로 전환 (HUMAN_REQUIRED 1회)', async () => {
    const gate = new PauseGate(bus, clock)
    const a = gate.guard(onceFailing(new RunnerError('rate_limit', 'x', at(5)), 'a'))
    const b = gate.guard(onceFailing(new RunnerError('auth', 'x'), 'b'))
    const c = gate.guard(onceFailing(new RunnerError('auth', 'x'), 'c'))
    await vi.waitFor(() => expect(types()).toContain('HUMAN_REQUIRED'))
    await new Promise((r) => setTimeout(r, 30))
    expect(types().filter((t) => t === 'HUMAN_REQUIRED')).toHaveLength(1)
    expect(types()).not.toContain('RESUMED')
    await gate.resumeByHuman()
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c'])
    expect(types().filter((t) => t === 'RESUMED')).toHaveLength(1)
    const hr = log.find((e) => e.type === 'HUMAN_REQUIRED')!
    expect(log.filter((e) => e.type === 'GUIDANCE').map((e) => (e.payload as { resolves: string }).resolves)).toEqual([hr.id])
    expect(rebuildState(log).humanRequired).toEqual([])
  })

  it('openai cap은 PAUSED(openai_cap)+HUMAN_REQUIRED 후 사람 재개를 기다린다', async () => {
    const gate = new PauseGate(bus, clock)
    const p = gate.guard(onceFailing(new RunnerError('rate_limit', 'openai cap'), 'ok'))
    await vi.waitFor(() => expect(types()).toEqual(['PAUSED', 'HUMAN_REQUIRED']))
    expect(log[0]!.payload).toEqual({ reason: 'openai_cap' })
    expect((log[1]!.payload as { detail: string }).detail).toContain('$8')
    await gate.resumeByHuman()
    await expect(p).resolves.toBe('ok')
    expect(types()).toEqual(['PAUSED', 'HUMAN_REQUIRED', 'GUIDANCE', 'RESUMED'])
    expect(log[2]!.payload).toMatchObject({ resolves: log[1]!.id })
    expect(rebuildState(log).humanRequired).toEqual([])
  })

  it('timeout/crash/format은 그대로 던진다', async () => {
    const gate = new PauseGate(bus, clock)
    for (const k of ['timeout', 'crash', 'format'] as const) {
      const err = new RunnerError(k, 'boom')
      await expect(gate.guard(async () => { throw err })).rejects.toBe(err)
    }
    const plain = new Error('x')
    await expect(gate.guard(async () => { throw plain })).rejects.toBe(plain)
    expect(log).toHaveLength(0)
  })

  it('resumeByHuman은 정지 중이 아니면 아무 일도 안 한다', async () => {
    const gate = new PauseGate(bus, clock)
    await gate.resumeByHuman()
    expect(log).toHaveLength(0)
    expect(types()).not.toContain('GUIDANCE')
  })
})
