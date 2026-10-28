import { describe, expect, it } from 'vitest'
import { boardGroups } from '../../src/model/board'
import { PLAN, stateWith } from './helpers'

describe('board', () => {
  it('보드 그룹 순서와 의사 태스크 제외', () => {
    expect(boardGroups(stateWith({ plan: 'approved', a: 'merged', b: 'review', c: 'rejected', d: 'pending' }), PLAN).map((g) => g.group)).toEqual(['review', 'rejected', 'pending', 'done'])
  })
  it('제목은 plan에서, 없으면 id', () => {
    const g = boardGroups(stateWith({ a: 'running', z: 'blocked' }), PLAN)
    expect(g[0]!.tasks[0]).toMatchObject({ id: 'a', title: '태스크 a', round: 1 })
    const blocked = g.find((x) => x.group === 'blocked')!
    expect(blocked).toMatchObject({ label: '건너뜀' }); expect(blocked.tasks[0]!.title).toBe('z')
    expect(boardGroups(stateWith({ a: 'approved', b: 'merged' }), null)[0]).toMatchObject({ group: 'done', label: '완료' })
  })
  it('계획에 있지만 아직 상태가 없는 태스크는 대기 (round 0)', () => {
    const plan = { ...PLAN, tasks: [{ ...PLAN.tasks[0]!, id: 't1' }, { ...PLAN.tasks[1]!, id: 't2' }] }
    const g = boardGroups(stateWith({ t1: 'running' }), plan)
    expect(g.map((x) => [x.group, x.tasks.map((t) => t.id)])).toEqual([['running', ['t1']], ['pending', ['t2']]])
    expect(g[1]!.tasks[0]).toMatchObject({ status: 'pending', round: 0, title: '태스크 b' })
  })
})
