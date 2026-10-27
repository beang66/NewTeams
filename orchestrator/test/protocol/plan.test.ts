import { describe, it, expect } from 'vitest'
import { PlanSchema, validatePlan, type Plan, type PlanTask } from '../../src/protocol/plan.js'

const task = (id: string, o: Partial<PlanTask> = {}): PlanTask => ({
  id, title: id, deps: [], ownedFiles: [`src/${id}.ts`], difficulty: 'low', acceptance: ['ok'], qaScenarios: [], ...o,
})
const plan = (tasks: PlanTask[]): Plan => ({ tasks, testCommands: ['npm test'], devCommand: 'npm run dev' })

describe('plan', () => {
  it('정상 계획은 통과', () => {
    expect(validatePlan(plan([task('t1'), task('t2', { deps: ['t1'] })]))).toEqual([])
    expect(PlanSchema.safeParse(plan([task('t1')])).success).toBe(true)
  })
  it('중복 태스크 id와 경로로 쓸 수 없는 id를 잡는다', () => {
    expect(validatePlan(plan([task('t1'), task('t1')])).some((message) => message.includes('중복 태스크 id'))).toBe(true)
    for (const id of ['../raw', 'a/b', 'a\\b', '..', 'CON', 'a:', '-option', 'trailing.']) {
      expect(validatePlan(plan([task(id)])).some((message) => message.includes('잘못된 태스크 id'))).toBe(true)
    }
  })
  it('소유 파일 중복을 잡는다', () => {
    const p = plan([task('t1', { ownedFiles: ['src/a.ts'] }), task('t2', { ownedFiles: ['src/a.ts'] })])
    expect(validatePlan(p)).toContain('src/a.ts: t1, t2 가 함께 소유')
  })
  it('의존 순환을 잡는다', () => {
    const p = plan([task('t1', { deps: ['t2'] }), task('t2', { deps: ['t1'] })])
    expect(validatePlan(p).some(m => m.startsWith('의존 순환'))).toBe(true)
  })
  it('없는 태스크에 대한 의존을 잡는다', () => {
    expect(validatePlan(plan([task('t1', { deps: ['t9'] })]))).toContain('t1: 없는 의존 t9')
  })
  it('예약된 태스크 id(plan, final)를 잡는다', () => {
    const problems = validatePlan(plan([task('plan'), task('final'), task('t1')]))
    expect(problems).toContain('예약된 태스크 id: plan')
    expect(problems).toContain('예약된 태스크 id: final')
    expect(problems.filter((m) => m.startsWith('예약된'))).toHaveLength(2)
  })
})
