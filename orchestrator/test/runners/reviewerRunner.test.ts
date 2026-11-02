import { describe, it, expect } from 'vitest'
import { ReviewerRunner } from '../../src/runners/reviewerRunner.js'
import { FakeRunner } from '../../src/runners/fakeRunner.js'
import { RunnerError, type RunRequest } from '../../src/runners/types.js'

const req: RunRequest = { role: 'reviewer', prompt: 'p', model: 'm', cwd: '.', timeoutMs: 1000, rawLogPath: 'raw.log' }
const ok = (text: string) => ({ text, usage: { in: 1, out: 1, cached: 0 } })
const APPROVE = '{"verdict":"approve","findings":[],"resolved":[]}'

describe('ReviewerRunner', () => {
  it('Codex가 정상이면 OpenAI는 호출하지 않는다', async () => {
    const codex = new FakeRunner([ok('codex')]); const openai = new FakeRunner([])
    expect((await new ReviewerRunner(codex, openai).run(req)).text).toBe('codex')
    expect(openai.calls).toHaveLength(0)
  })
  it('Codex 한도면 OpenAI로 전환 (같은 요청)', async () => {
    const codex = new FakeRunner([new RunnerError('rate_limit', 'x')]); const openai = new FakeRunner([ok(APPROVE)])
    const r = new ReviewerRunner(codex, openai)
    expect((await r.run(req)).text).toContain('approve')
    expect(openai.calls[0]).toEqual(req)
  })
  it('이어가기 요청이 OpenAI로 넘어가면 세션 없이 freshPrompt 전체로 보낸다', async () => {
    const codex = new FakeRunner([new RunnerError('rate_limit', 'x')]); const openai = new FakeRunner([ok(APPROVE)])
    await new ReviewerRunner(codex, openai).run({ ...req, prompt: '증분', resumeSessionId: 's-rev', freshPrompt: '전체' })
    expect(openai.calls[0]).toEqual({ ...req, prompt: '전체' })
  })
  it('Codex의 다른 오류는 전파', async () => {
    const err = new RunnerError('crash', 'x')
    const openai = new FakeRunner([])
    await expect(new ReviewerRunner(new FakeRunner([err]), openai).run(req)).rejects.toBe(err)
    expect(openai.calls).toHaveLength(0)
  })
  it('OpenAI 오류(캡)는 그대로 전파', async () => {
    const cap = new RunnerError('rate_limit', 'openai cap')
    await expect(new ReviewerRunner(new FakeRunner([new RunnerError('rate_limit', 'x')]), new FakeRunner([cap])).run(req)).rejects.toBe(cap)
  })
})
