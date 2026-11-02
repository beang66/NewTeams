import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latestDue, nextDue, Routines, type RoutineInput } from '../../src/skills/routines.js'
import type { SkillRuns } from '../../src/skills/runs.js'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(join(tmpdir(), 'routines-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi)
const base: RoutineInput = { name: '아침 정리', skill: 'blog', input: '', model: '기본 모델', effort: '기본', enabled: true, schedule: { kind: 'daily', time: '07:30' } }

describe('일정 계산', () => {
  it('매일: 오늘 시각 전이면 어제, 지났으면 오늘', () => {
    expect(latestDue({ kind: 'daily', time: '07:30' }, local(2026, 11, 2, 7, 0))).toEqual(local(2026, 11, 1, 7, 30))
    expect(latestDue({ kind: 'daily', time: '07:30' }, local(2026, 11, 2, 7, 30))).toEqual(local(2026, 11, 2, 7, 30))
    expect(nextDue({ kind: 'daily', time: '07:30' }, local(2026, 11, 2, 7, 30))).toEqual(local(2026, 11, 3, 7, 30))
  })
  it('매주: 지정 요일만 (2026-11-02는 월요일)', () => {
    const mon = { kind: 'weekly' as const, time: '09:00', days: [1] }
    expect(latestDue(mon, local(2026, 11, 2, 8, 0))).toEqual(local(2026, 10, 26, 9, 0))
    expect(nextDue(mon, local(2026, 11, 2, 9, 0))).toEqual(local(2026, 11, 9, 9, 0))
    expect(latestDue({ kind: 'weekly', time: '09:00', days: [] }, local(2026, 11, 2, 8, 0))).toBeNull()
  })
})

describe('Routines', () => {
  function setup(now: Date, busy = false) {
    const start = vi.fn(async () => ({ id: 'run-1' }))
    const runs = { busy: () => busy, start } as unknown as SkillRuns
    let clock = now
    const routines = new Routines(join(dir, 'routines.json'), runs, () => clock)
    return { routines, start, setNow: (d: Date) => { clock = d } }
  }

  it('만들고 고치고 지우며 파일에 남긴다', async () => {
    const { routines } = setup(local(2026, 11, 2, 6, 0))
    const r = await routines.create(base)
    await routines.update(r.id, { ...base, name: '바뀐 이름' })
    const reopened = new Routines(join(dir, 'routines.json'), { busy: () => false } as unknown as SkillRuns)
    expect(reopened.list().map((x) => x.name)).toEqual(['바뀐 이름'])
    await routines.remove(r.id)
    expect(routines.list()).toEqual([])
  })

  it('예정 시각이 지나면 한 번만 돌고, 만들기 전 예정분은 돌지 않는다', async () => {
    const { routines, start, setNow } = setup(local(2026, 11, 2, 8, 0))
    await routines.create(base) // 오늘 07:30은 만들기 전이다
    await routines.tick()
    expect(start).not.toHaveBeenCalled()
    setNow(local(2026, 11, 3, 7, 31))
    await routines.tick(); await routines.tick()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ skill: 'blog', routine: '아침 정리' }))
    expect(routines.list()[0]).toMatchObject({ lastRunId: 'run-1' })
  })

  it('다른 스킬이 돌고 있으면 건너뛰고, 꺼진 루틴은 돌지 않는다', async () => {
    const { routines, start } = setup(local(2026, 11, 2, 6, 0), true)
    await routines.create(base)
    await routines.create({ ...base, enabled: false })
    const busyRoutines = routines
    await busyRoutines.tick()
    expect(start).not.toHaveBeenCalled()
  })
})
