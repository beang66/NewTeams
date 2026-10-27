import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { AgentRunner } from '../../src/runners/agentRunner.js'
import { FakeRunner } from '../../src/runners/fakeRunner.js'
import type { RunRequest } from '../../src/runners/types.js'

const request: RunRequest = { role: 'master', prompt: 'test', model: 'codex-default', cwd: '.', timeoutMs: 1000, rawLogPath: 'unused' }
const result = { text: 'ok', sessionId: 'session', usage: { in: 1, out: 1, cached: 0 } }
describe('AgentRunner', () => {
  it('routes master and worker independently and tags sessions', async () => {
    const claude = new FakeRunner([result])
    const codex = new FakeRunner([result])
    const config = structuredClone(DEFAULT_CONFIG)
    config.agents.master.provider = 'codex'
    const runner = new AgentRunner(config, { claude, codex })
    expect((await runner.run(request)).sessionId).toBe('@codex/session')
    await runner.run({ ...request, role: 'dev' })
    expect(claude.calls[0]!.role).toBe('dev')
    expect(codex.calls[0]!.role).toBe('master')
  })
  it('resumes only matching providers and routes worker seed via explicit provider', async () => {
    const claude = new FakeRunner([result])
    const codex = new FakeRunner([result, result])
    const runner = new AgentRunner(DEFAULT_CONFIG, { claude, codex })
    await runner.run({ ...request, provider: 'codex', resumeSessionId: '@codex/parent', fork: true })
    expect(codex.calls[0]).toMatchObject({ resumeSessionId: 'parent', fork: true })
    await runner.run({ ...request, provider: 'codex', resumeSessionId: '@claude/parent', fork: true })
    expect(codex.calls[1]!.resumeSessionId).toBeUndefined()
    await runner.run({ ...request, resumeSessionId: 'legacy-claude' })
    expect(claude.calls[0]!.resumeSessionId).toBe('legacy-claude')
  })
})
