import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunnerError } from '../../src/runners/types.js'
import { Workflow } from '../../src/engine/workflow.js'
import { ActionConflict, createWorkflowActions } from '../../src/server/actions.js'
import { buildServer } from '../../src/server/http.js'
import { fakeDeps, makeScript } from '../fixtures/scripts/common.js'

let dir: string
let wf: Workflow
let humanId: string
const G = { action: 'guidance' as const, text: '계속' }
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orch-actions-'))
  wf = await Workflow.open(dir, fakeDeps(makeScript()))
  humanId = (await wf.bus.publish({ type: 'HUMAN_REQUIRED', from: 'test', to: 'user', task: 'plan', payload: {} })).id
  vi.spyOn(wf, 'runUntilBlocked').mockResolvedValue('waiting_human')
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('workflow actions', { timeout: 30_000 }, () => {
  it('같은 HUMAN_REQUIRED에 두 번 답하면 두 번째는 ActionConflict', async () => {
    const actions = createWorkflowActions(wf, vi.fn())
    const [a, b] = await Promise.allSettled([actions.answer(humanId, G), actions.answer(humanId, G)])
    expect(a.status).toBe('fulfilled')
    expect(b).toMatchObject({ status: 'rejected', reason: expect.any(ActionConflict) })
  })
  it('answer 성공 후 drive가 한 번 호출된다', async () => {
    const actions = createWorkflowActions(wf, vi.fn())
    await actions.answer(humanId, G)
    await vi.waitFor(() => expect(wf.runUntilBlocked).toHaveBeenCalledTimes(1))
  })
  it('실패한 동작이 큐를 막지 않고, 충돌이 아닌 오류는 그대로 전달된다', async () => {
    const actions = createWorkflowActions(wf, vi.fn())
    vi.spyOn(wf, 'chat').mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ reply: 'ok' })
    await expect(actions.chat('a')).rejects.toThrow('boom')
    await expect(actions.chat('b')).resolves.toEqual({ reply: 'ok' })
    await expect(actions.approveSpec()).rejects.toBeInstanceOf(ActionConflict)
  })
  it('스펙 승인 전 시작은 409, 시작·정지는 STATE_CHANGE로 남는다', async () => {
    const actions = createWorkflowActions(wf, vi.fn())
    await expect(actions.startPipeline()).rejects.toBeInstanceOf(ActionConflict) // INTAKE
    await wf.bus.publish({ type: 'STATE_CHANGE', from: 'test', to: 'all', payload: { stage: 'SPEC_APPROVED' } })
    expect(wf.state().pipeline).toBeUndefined()
    await actions.startPipeline()
    expect(wf.state().pipeline).toBe('running')
    await vi.waitFor(() => expect(wf.runUntilBlocked).toHaveBeenCalled())
    await actions.stopPipeline()
    expect(wf.state().pipeline).toBe('stopped')
  })
  it('HTTP와 공유: 텔레그램 쪽에서 먼저 답하면 HTTP는 409', async () => {
    const actions = createWorkflowActions(wf, vi.fn())
    const app = buildServer(wf, { actions })
    try {
      await actions.answer(humanId, G)
      expect((await app.inject({ method: 'POST', url: `/api/human/${humanId}`, payload: G })).statusCode).toBe(409)
    } finally { await app.close() }
  })
  it('게이트가 사람 재개를 기다리는 chat이 있어도 resume은 큐에 막히지 않는다', async () => {
    const actions = createWorkflowActions(wf, vi.fn())
    let first = true
    vi.spyOn(wf, 'chat').mockImplementation(() => wf.gate.guard(async () => {
      if (first) { first = false; throw new RunnerError('auth', 'login') }
      return { reply: '완료' }
    }))
    const chat = actions.chat('안녕')
    await vi.waitFor(() => expect(wf.gate.paused).toBe(true))
    await expect(Promise.race([actions.resume().then(() => 'resumed'), new Promise(r => setTimeout(() => r('deadlock'), 2000))])).resolves.toBe('resumed')
    await expect(chat).resolves.toEqual({ reply: '완료' })
  })
  it('HTTP: 게이트 대기 중 chat이 있어도 POST /api/resume은 204', async () => {
    const actions = createWorkflowActions(wf, vi.fn())
    let first = true
    vi.spyOn(wf, 'chat').mockImplementation(() => wf.gate.guard(async () => {
      if (first) { first = false; throw new RunnerError('auth', 'login') }
      return { reply: '완료' }
    }))
    const app = buildServer(wf, { actions })
    try {
      const chat = app.inject({ method: 'POST', url: '/api/chat', payload: { message: '안녕' } })
      await vi.waitFor(() => expect(wf.gate.paused).toBe(true))
      expect((await app.inject({ method: 'POST', url: '/api/resume' })).statusCode).toBe(204)
      expect((await chat).statusCode).toBe(200)
    } finally { await app.close() }
  })
  it('GET /api/telegram', async () => {
    const a = buildServer(wf)
    const b = buildServer(wf, { telegramStatus: () => ({ state: 'connected', botUsername: 'my_orch_bot' }) })
    try {
      expect((await a.inject('/api/telegram')).json()).toEqual({ state: 'off' })
      expect((await b.inject('/api/telegram')).json().state).toBe('connected')
    } finally { await a.close(); await b.close() }
  })
})
