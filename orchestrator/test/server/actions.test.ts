import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  it('HTTP와 공유: 텔레그램 쪽에서 먼저 답하면 HTTP는 409', async () => {
    const actions = createWorkflowActions(wf, vi.fn())
    const app = buildServer(wf, { actions })
    try {
      await actions.answer(humanId, G)
      expect((await app.inject({ method: 'POST', url: `/api/human/${humanId}`, payload: G })).statusCode).toBe(409)
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
