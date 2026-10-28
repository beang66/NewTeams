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
    expect(g[1]).toMatchObject({ group: 'blocked', label: '건너뜀' }); expect(g[1]!.tasks[0]!.title).toBe('z')
    expect(boardGroups(stateWith({ a: 'approved', b: 'merged' }), null)[0]).toMatchObject({ group: 'done', label: '완료' })
  })
})
