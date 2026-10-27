import { describe, it, expect } from 'vitest'
import { readyTasks, topoOrder } from '../../src/engine/scheduler.js'
import { planOf, stateWith } from '../helpers.js'

describe('readyTasks', () => {
  it('readyTasks는 의존과 병렬 상한을 지킨다', () => {
    expect(readyTasks(planOf(['a'], ['b'], ['c', ['a']], ['d'], ['e']), stateWith({}), 3).map((t) => t.id)).toEqual(['a', 'b', 'd'])
  })
  it('실행 중인 태스크 수만큼 빼고, 의존이 merged여야 풀린다 (approved만으로는 안 됨)', () => {
    const plan = planOf(['a'], ['b'], ['c', ['a']], ['d', ['b']], ['e'])
    expect(readyTasks(plan, stateWith({ a: 'approved', b: 'merged', e: 'running' }), 3).map((t) => t.id)).toEqual(['d'])
    const st = stateWith({ a: 'merged', b: 'merged', e: 'running' })
    expect(readyTasks(plan, st, 3).map((t) => t.id)).toEqual(['c', 'd'])
    expect(readyTasks(plan, st, 2).map((t) => t.id)).toEqual(['c'])
  })
  it('rejected는 다시 대기, blocked·review·approved는 제외', () => {
    const plan = planOf(['a'], ['b'], ['c'], ['d', ['c']])
    expect(readyTasks(plan, stateWith({ a: 'rejected', b: 'blocked', c: 'approved' }), 3).map((t) => t.id)).toEqual(['a'])
    expect(readyTasks(plan, stateWith({ a: 'rejected', b: 'blocked', c: 'merged' }), 3).map((t) => t.id)).toEqual(['a', 'd'])
    expect(readyTasks(plan, stateWith({ a: 'review', b: 'running', c: 'running' }), 3)).toEqual([])
  })
})

describe('topoOrder', () => {
  it('의존 순서를 지키고 나머지는 계획 순서', () => {
    expect(topoOrder(planOf(['c', ['b']], ['a'], ['b', ['a']], ['d'])).map((t) => t.id)).toEqual(['a', 'b', 'd', 'c'])
  })
  it('없는 의존은 무시하고 순환이 있어도 모두 돌려준다', () => {
    expect(topoOrder(planOf(['a', ['x']], ['b', ['c']], ['c', ['b']])).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})
