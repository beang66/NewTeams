import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { pickModel, pickProvider } from '../../src/router/modelRouter.js'

describe('modelRouter', () => {
  it('Codex 마스터와 작업 모델·상향 모델을 선택한다', () => {
    const config = { ...structuredClone(DEFAULT_CONFIG), agents: { master: { provider: 'codex' as const, model: 'master-model' }, worker: { provider: 'codex' as const, model: 'worker-model', escalatedModel: 'upgrade-model' } } }
    expect(pickProvider('planner', config)).toBe('codex')
    expect(pickModel('master', {}, config)).toBe('master-model')
    expect(pickModel('planner', {}, config)).toBe('master-model')
    expect(pickModel('dev', {}, config)).toBe('worker-model')
    expect(pickModel('dev', { escalated: true }, config)).toBe('upgrade-model')
    expect(pickProvider('reviewer', config)).toBe('codex')
    const claudeConfig = structuredClone(DEFAULT_CONFIG)
    claudeConfig.agents.worker.model = 'sonnet'
    expect(pickModel('dev', { escalated: true }, claudeConfig)).toBe('opus')
  })
  it('라우터 기본값과 상향', () => {
    expect(pickModel('master')).toBe('opus'); expect(pickModel('planner', { difficulty: 'low' })).toBe('sonnet')
    expect(pickModel('planner', { difficulty: 'high' })).toBe('opus')
    expect(pickModel('dev')).toBe('sonnet'); expect(pickModel('dev', { escalated: true })).toBe('opus')
    expect(pickModel('wiki')).toBe('haiku'); expect(pickModel('logQuery')).toBe('sonnet')
    expect(pickModel('qa')).toBe('sonnet')
  })
})
