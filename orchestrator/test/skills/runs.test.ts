import { promises as fs, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PINNED, SkillBusy, SkillRuns, type SkillRun } from '../../src/skills/runs.js'
import { SkillNotFound } from '../../src/skills/skills.js'
import { FakeRunner } from '../../src/runners/fakeRunner.js'
import { RunnerError, type RunRequest, type RunResult } from '../../src/runners/types.js'

const USAGE = { in: 1, out: 1, cached: 0 }
const list = async () => [{ name: 'blog', desc: '', source: 'user' as const }]
let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(join(tmpdir(), 'skill-runs-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

/** 실행이 끝나 상태가 running이 아니게 될 때까지 기다린다. */
async function settle(runs: SkillRuns, id: string): Promise<SkillRun> {
  for (let i = 0; i < 200; i++) { const r = runs.get(id); if (r.status !== 'running') return r; await new Promise((ok) => setTimeout(ok, 5)) }
  throw new Error('끝나지 않음')
}
const start = (runs: SkillRuns) => runs.start({ skill: 'blog', input: '주제', model: 'Sonnet', effort: 'high' })

describe('SkillRuns', () => {
  it('실행하고 결과·만든 파일·기록을 남긴다. 사용자 설정을 싣고 권한은 열지 않는다', async () => {
    const fake = new FakeRunner([(req: RunRequest) => { writeFileSync(join(req.cwd, 'x.md'), 'x'); return { text: '완료', sessionId: 's1', usage: USAGE } }])
    const runs = new SkillRuns(dir, fake, list, 1000)
    const r = await settle(runs, (await start(runs)).id)
    expect(r).toMatchObject({ status: 'done', text: '완료', files: ['x.md'] })
    expect(fake.calls[0]).toMatchObject({ prompt: '/blog 주제', model: 'sonnet', effort: 'high', userSettings: true })
    expect(fake.calls[0]!.acceptEdits).toBeUndefined()
    // 새로 열어도 기록이 남아 있다
    expect(new SkillRuns(dir, fake, list, 1000).get(r.id).status).toBe('done')
  })

  it('파일 쓰기가 거부되면 승인을 기다리고, 승인하면 같은 세션을 파일 편집만 허용해 잇는다', async () => {
    const fake = new FakeRunner([
      { text: '쓰려 했으나 거부됨', sessionId: 's1', usage: USAGE, denied: ['Write: report.md'] } as RunResult,
      { text: '저장함', sessionId: 's1', usage: USAGE },
    ])
    const runs = new SkillRuns(dir, fake, list, 1000)
    const id = (await start(runs)).id
    expect(await settle(runs, id)).toMatchObject({ status: 'needs_approval', denied: ['Write: report.md'] })
    await runs.approve(id)
    expect(await settle(runs, id)).toMatchObject({ status: 'done', text: '저장함' })
    expect(fake.calls[1]).toMatchObject({ resumeSessionId: 's1', acceptEdits: true })
    expect(runs.get(id).denied).toBeUndefined() // 승인 뒤 다 됐으면 거부 목록이 남지 않는다
  })

  it('거절하면 실행하지 않고 취소로 끝난다', async () => {
    const fake = new FakeRunner([{ text: '', sessionId: 's1', usage: USAGE, denied: ['Write: a.md'] } as RunResult])
    const runs = new SkillRuns(dir, fake, list, 1000)
    const id = (await start(runs)).id
    await settle(runs, id)
    expect((await runs.reject(id)).status).toBe('cancelled')
    expect(fake.calls).toHaveLength(1)
  })

  it('실행 중 중단하면 신호를 보내고 cancelled로 남긴다', async () => {
    const claude = { run: (req: RunRequest) => new Promise<RunResult>((_ok, fail) => req.signal!.addEventListener('abort', () => fail(new RunnerError('crash', 'killed')))) }
    const runs = new SkillRuns(dir, claude, list, 1000)
    const id = (await start(runs)).id
    runs.cancel(id)
    expect(await settle(runs, id)).toMatchObject({ status: 'cancelled', error: '사람이 중단함' })
    expect(runs.busy()).toBe(false)
  })

  it('한 번에 하나만 돌고, 설치되지 않은 스킬은 거부한다', async () => {
    const claude = { run: () => new Promise<RunResult>(() => {}) }
    const runs = new SkillRuns(dir, claude, list, 1000)
    await start(runs)
    await expect(start(runs)).rejects.toBeInstanceOf(SkillBusy)
    await expect(new SkillRuns(join(dir, 'b'), claude, list, 1000).start({ skill: 'nope', input: '', model: '기본 모델', effort: '기본' })).rejects.toBeInstanceOf(SkillNotFound)
  })

  it('고정 목록은 기본값으로 시작하고 저장한다', async () => {
    const runs = new SkillRuns(dir, new FakeRunner([]), list, 1000)
    expect(await runs.pinned()).toEqual(DEFAULT_PINNED)
    await runs.setPinned(['blog', 'blog'])
    expect(await new SkillRuns(dir, new FakeRunner([]), list, 1000).pinned()).toEqual(['blog'])
    expect(existsSync(join(dir, 'pinned.json'))).toBe(true)
  })

  it('사용자 고정 목록: 예전 프로젝트 목록을 옮기고, 파일이 깨져도 기본값으로 덮지 않는다', async () => {
    writeFileSync(join(dir, 'pinned.json'), JSON.stringify(['old-pin']))
    const user = join(dir, 'home', 'pinned-skills.json')
    const runs = new SkillRuns(dir, new FakeRunner([]), list, 1000, undefined, user)
    expect(await runs.pinned()).toEqual(['old-pin'])
    expect(existsSync(user)).toBe(true)
    await runs.setPinned(['a', 'b'])
    await runs.setPinned(['a'])
    writeFileSync(user, '{깨짐')
    expect(await runs.pinned()).toEqual(['a', 'b']) // 직전 저장본(.bak)
  })
})
