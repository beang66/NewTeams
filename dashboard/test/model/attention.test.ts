import { describe, expect, it } from 'vitest'
import { attentionItems } from '../../src/model/attention'
import { F, guidance, human, reject, stateWith } from './helpers'

const withHuman = (...ids: string[]) => stateWith({ t1: 'blocked' }, { humanRequired: ids })

describe('attention', () => {
  it('교착 카드에 마지막 반려 지적과 시도한 지침', () => {
    const items = attentionItems(withHuman('msg-0010'), [reject('t1', [F('F-0')]), reject('t1', [F('F-1')]), guidance('t1', '서버에서 검증'), human('msg-0010', 't1', 'repeat_finding')], { hasSpecDraft: false })
    expect(items[0]).toMatchObject({ kind: 'human', task: 't1', reason: 'repeat_finding', tried: ['서버에서 검증'] })
    expect((items[0] as { findings: { id: string }[] }).findings.map((f) => f.id)).toEqual(['F-1'])
  })
  it('auth HUMAN_REQUIRED는 login 카드', () => {
    expect(attentionItems(withHuman('msg-3'), [human('msg-3', undefined, 'auth')], { hasSpecDraft: false })[0]!.kind).toBe('login')
  })
  it('스펙 초안 카드는 INTAKE에서만, 맨 앞', () => {
    expect(attentionItems(stateWith({}), [], { hasSpecDraft: true })).toEqual([{ kind: 'spec', draftPath: 'spec.draft.md' }])
    expect(attentionItems(stateWith({}, { stage: 'BUILD' }), [], { hasSpecDraft: true })).toEqual([])
  })
  it('해결된 항목은 나오지 않는다', () => {
    expect(attentionItems(stateWith({}), [human('msg-9', 't1', 'permission')], { hasSpecDraft: false })).toEqual([])
  })
})
