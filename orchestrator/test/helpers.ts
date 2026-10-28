import { promises as fs } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type { Envelope, MessageType, NewEnvelope } from '../src/protocol/messages.js'
import type { Clock } from '../src/clock.js'

export async function tmpDir(): Promise<string> {
  return fs.mkdtemp(join(os.tmpdir(), 'orch-'))
}
export async function rmDir(d: string): Promise<void> {
  await fs.rm(d, { recursive: true, force: true })
}
export const fakeClock: Clock = {
  now: () => new Date('2026-10-26T00:00:00.000Z'),
  sleep: async () => {},
}
export function ev(type: MessageType, extra: Partial<NewEnvelope> = {}): NewEnvelope {
  return { type, from: 'a', to: 'b', payload: {}, ...extra }
}
export function full(id: string, type: MessageType = 'CHAT', extra: Partial<Envelope> = {}): Envelope {
  return { id, ts: '2026-10-26T00:00:00.000Z', type, from: 'a', to: 'b', payload: {}, ...extra }
}

// ---- 렌더러 테스트용 이벤트 빌더 ----
let seq = 0
function mk(type: MessageType, from: string, to: string, payload: unknown, extra: Partial<Envelope> = {}): Envelope {
  seq += 1
  return { id: `msg-${String(seq).padStart(4, '0')}`, ts: '2026-10-26T05:00:00.000Z', type, from, to, payload, ...extra }
}
export const stage = (s: string): Envelope => mk('STATE_CHANGE', 'controller', 'all', { stage: s })
export const paused = (reason: string, until?: string): Envelope => mk('PAUSED', 'controller', 'all', { reason, until })
export const resumed = (): Envelope => mk('RESUMED', 'controller', 'all', {})
export const escalate = (task: string, reason: string, detail?: string): Envelope =>
  mk('ESCALATE', 'controller', 'master', { reason, detail }, { task })
export const guidance = (task: string, action: string, text: string, resolves?: string): Envelope =>
  mk('GUIDANCE', 'master', 'controller', { action, text, resolves }, { task })
export const humanRequired = (task: string, reason: string, detail?: string): Envelope =>
  mk('HUMAN_REQUIRED', 'controller', 'user', { reason, detail }, { task })
export const chat = (from: 'user' | 'master', text: string): Envelope => mk('CHAT', from, from === 'user' ? 'master' : 'user', { text })
export const report = (task: string, round: number, dev = { changedFiles: ['a.ts'], testsRun: ['npm test'], claims: ['동작함'] }): Envelope =>
  mk('REPORT', 'dev', 'controller', dev, { task, round })
export const revision = (task: string, round: number, addressed: string[] = ['F-1']): Envelope =>
  mk('REVISION', 'dev', 'controller', { changedFiles: ['a.ts'], testsRun: ['npm test'], claims: ['고침'], addressed }, { task, round })
export const reject = (task: string, round: number, findings: Array<{ id: string; severity: string; issue: string; file?: string }>, from = 'reviewer'): Envelope =>
  mk('REJECT', from, 'dev', { verdict: 'reject', findings, resolved: [] }, { task, round })
export const approve = (task: string, round?: number): Envelope =>
  mk('APPROVE', 'reviewer', 'controller', { verdict: 'approve', findings: [], resolved: [] }, { task, ...(round !== undefined ? { round } : {}) })

// 1×1 투명 PNG (QA 증거 캡처용)
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// ---- sleep이 즉시 resolve되며 요청된 기상 시각을 기록하는 시계 (PauseGate 테스트용) ----
export interface RecordingClock extends Clock { sleptUntil(): Date | undefined; sleeps: Date[] }
export function recordingClock(start = new Date("2026-10-26T00:00:00.000Z")): RecordingClock {
  let cur = start.getTime()
  const sleeps: Date[] = []
  return {
    sleeps,
    now: () => new Date(cur),
    sleep: async (ms: number) => {
      cur += Math.max(0, ms)
      sleeps.push(new Date(cur))
    },
    sleptUntil: () => sleeps.reduce<Date | undefined>((m, d) => (!m || d > m ? d : m), undefined),
  }
}

// ---- 스케줄러 테스트용 계획/상태 빌더 ----
import type { Plan, PlanTask } from '../src/protocol/plan.js'
import { initialState, type RunState, type TaskStatus } from '../src/store/state.js'
export const taskOf = (id: string, deps: string[] = [], extra: Partial<PlanTask> = {}): PlanTask => ({
  id, title: id, deps, ownedFiles: [`src/${id}/**`], difficulty: 'mid', acceptance: [`${id} 동작`], qaScenarios: [], ...extra,
})
export const planOf = (...specs: Array<[string, string[]?]>): Plan => ({
  tasks: specs.map(([id, deps]) => taskOf(id, deps ?? [])), testCommands: [], devCommand: 'npm run dev',
})
export const stateWith = (statuses: Record<string, TaskStatus>): RunState => ({
  ...structuredClone(initialState),
  tasks: Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { status, round: 1 }])),
})

export const assign = (task: string, round = 1): Envelope => mk('ASSIGN', 'controller', 'dev', { prompt: '작업' }, { task, round })

// ---- 타이머를 직접 굴리는 시계 (Outbox 테스트용) ----
export interface ManualClock extends Clock {
  set(iso: string): void
  advance(ms: number): Promise<void>
  advanceTo(iso: string): Promise<void>
}
export function manualClock(startIso: string): ManualClock {
  let cur = new Date(startIso).getTime()
  const pending: { wake: number; resolve: () => void }[] = []
  const tick = async (n = 4): Promise<void> => { for (let i = 0; i < n; i++) await Promise.resolve() }
  const run = async (target: number): Promise<void> => {
    for (;;) {
      let idx = -1
      for (let i = 0; i < pending.length; i++) if (pending[i]!.wake <= target && (idx < 0 || pending[i]!.wake < pending[idx]!.wake)) idx = i
      if (idx < 0) break
      const [p] = pending.splice(idx, 1)
      cur = Math.max(cur, p!.wake)
      p!.resolve()
      await tick()
    }
    cur = Math.max(cur, target)
    await new Promise<void>(r => setImmediate(r))
  }
  return {
    now: () => new Date(cur),
    sleep: (ms) => new Promise<void>(resolve => { pending.push({ wake: cur + Math.max(0, ms), resolve }) }),
    set: (iso) => { cur = new Date(iso).getTime() },
    advance: (ms) => run(cur + ms),
    advanceTo: (iso) => run(new Date(iso).getTime()),
  }
}
