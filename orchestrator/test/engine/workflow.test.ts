import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs, existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { Workflow } from '../../src/engine/workflow.js'
import type { SpendTracker } from '../../src/runners/openaiRunner.js'
import type { RunRequest } from '../../src/runners/types.js'
import type { Envelope } from '../../src/protocol/messages.js'
import { tmpDir } from '../helpers.js'
import { fakeDeps, type TestWorkflowDeps } from '../fixtures/scripts/common.js'
import {
  HAPPY_SCRIPT, REJECT_ONCE_SCRIPT, CRASH_AFTER_REPORT_SCRIPT, CONTINUE_SCRIPT, DEADLOCK_SCRIPT,
  PLAN_DEADLOCK_SCRIPT, CONFLICT_SCRIPT, FINAL_REJECT_SCRIPT, UPGRADE_SCRIPT,
  PARALLEL_CRASH_SCRIPT, PARALLEL_CONTINUE_SCRIPT, DEPS_SCRIPT, FINAL_GUIDANCE_SCRIPT, DEPS_PLAN,
} from '../fixtures/scripts/scenarios.js'

let root: string
let dir: string
let deps: TestWorkflowDeps
beforeEach(async () => {
  root = await tmpDir()
  dir = join(root, 'proj')
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 })
})

const rawEvents = (): Envelope[] =>
  readFileSync(join(dir, 'raw/events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Envelope)
const rawTypes = () => rawEvents().map((e) => e.type)
const claudeCalls = (role?: string): RunRequest[] => deps.claude.calls.filter((c) => !role || c.role === role)
const lastDevPrompt = () => claudeCalls('dev').at(-1)!.prompt
const seedCalls = () => claudeCalls('planner').filter((c) => !c.resumeSessionId)
const gitLog = (cwd: string) => execFileSync('git', ['log', '--format=%s'], { cwd }).toString()

async function openWith(d: TestWorkflowDeps): Promise<Workflow> {
  deps = d
  return Workflow.open(dir, d)
}
async function intake(wf: Workflow): Promise<void> {
  await wf.chat('할 일 앱 만들어줘')
  await wf.approveSpec()
  await wf.startPipeline()
}

describe('Workflow', { timeout: 30_000 }, () => {
  it('가짜 러너로 INTAKE→DONE 전체', async () => {
    const wf = await openWith(fakeDeps(HAPPY_SCRIPT()))
    expect(await wf.runUntilBlocked()).toBe('waiting_spec')
    const { reply, specDraft } = await wf.chat('할 일 앱 만들어줘')
    expect(reply).toBe('이렇게 만들겠습니다')
    expect(specDraft).toContain('구현 범위')
    expect(readFileSync(join(dir, 'human/spec.draft.md'), 'utf8')).toBe(specDraft)
    expect(wf.state().masterSessionId).toBe('s-master')
    await wf.approveSpec()
    expect(await wf.runUntilBlocked()).toBe('not_started') // 스펙 승인만으로는 돌지 않는다
    await wf.startPipeline()
    expect(await wf.runUntilBlocked()).toBe('done')
    for (const f of ['human/intake.md', 'human/spec.md', 'human/plan.md', 'human/timeline.md', 'human/iterations/plan.md', 'human/iterations/t1.md', 'human/report.md']) {
      expect(existsSync(join(dir, f)), f).toBe(true)
    }
    expect(wf.state().stage).toBe('DONE')
    expect(wf.state().tasks.t1!.status).toBe('merged')
    // CHAT 2개(user→master), 시드는 모델별 하나씩, 위키 갱신, 보고서
    const chats = rawEvents().filter((e) => e.type === 'CHAT')
    expect(chats.map((e) => [e.from, (e.payload as { text: string }).text])).toEqual([['user', '할 일 앱 만들어줘'], ['master', '이렇게 만들겠습니다']])
    expect(seedCalls().map((c) => c.model).sort()).toEqual(['opus', 'sonnet'])
    expect(seedCalls()[0]!.prompt).toContain('구현 범위')
    expect(claudeCalls('planner').find((c) => c.resumeSessionId)).toMatchObject({ resumeSessionId: 'seed-opus', fork: true })
    expect(readFileSync(join(dir, 'human/wiki/architecture.md'), 'utf8')).toContain('할 일 목록 모듈')
    expect(readFileSync(join(dir, 'human/report.md'), 'utf8')).toContain('최종 보고')
    expect(JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')).tasks[0].id).toBe('t1')
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).stage).toBe('DONE')
    // 병합되어 worktree는 지워지고 main에 결과가 있다
    expect(existsSync(join(dir, 'workspace/src/t1/a.ts'))).toBe(true)
    expect(existsSync(join(dir, 'workspace/.worktrees/t1'))).toBe(false)
    // 단계마다 human/ 커밋
    const log = gitLog(dir)
    for (const s of ['INTAKE 완료', 'PLAN 완료', 'BUILD 완료', 'INTEGRATE 완료', 'FINAL_QA 완료', 'REPORT 완료']) expect(log).toContain(s)
    // 최종 QA는 전체 시나리오(task=null), 증거는 human/evidence/final/r1
    const finalQa = claudeCalls('qa').at(-1)!
    expect(finalQa.cwd).toBe(join(dir, 'workspace'))
    expect(finalQa.addDirs).toEqual([join(dir, 'human/evidence/final/r1')])
    expect(finalQa.prompt).toContain('전체 통합 검증')
    // 로그 질의
    expect(await wf.askLog('언제 시작했어?')).toContain('msg-0001')
    expect(claudeCalls('logQuery')[0]).toMatchObject({ cwd: dir, allowedTools: ['Read', 'Grep'] })
    expect(claudeCalls('logQuery')[0]!.prompt).toContain('타임라인')
  })

  it('반려 루프가 iterations와 raw 양쪽에 남는다', async () => {
    const wf = await openWith(fakeDeps(REJECT_ONCE_SCRIPT()))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('done')
    expect(readFileSync(join(dir, 'human/iterations/t1.md'), 'utf8')).toContain('## 2회차')
    expect(rawTypes()).toContain('REJECT')
    expect(readFileSync(join(dir, 'human/wiki/backlog.md'), 'utf8')).toContain('변수 이름 다듬기')
  })

  it('BUILD 도중 강제 종료 후 다시 열면 이어서 완료', async () => {
    const wf1 = await openWith(fakeDeps(CRASH_AFTER_REPORT_SCRIPT()))
    await intake(wf1)
    await expect(wf1.runUntilBlocked()).rejects.toThrow('강제 종료')
    expect(rawTypes()).toContain('REPORT')
    expect(wf1.state().tasks.t1).toMatchObject({ status: 'rejected', round: 1, sessionId: 'dev-t1' }) // 실패 뒤 메모리에서 재대기로 되돌림
    const wf2 = await openWith(fakeDeps(CONTINUE_SCRIPT()))
    expect(wf2.state().stage).toBe('BUILD')
    expect(wf2.state().tasks.t1!.status).toBe('rejected')
    expect(await wf2.runUntilBlocked()).toBe('done')
    expect(wf2.state().tasks.t1!.round).toBe(1) // 회차가 초기화되지 않음
    // 시드를 다시 만들지 않고 같은 dev 세션을 이어간다
    expect(seedCalls()).toHaveLength(0)
    expect(claudeCalls('dev')[0]).toMatchObject({ resumeSessionId: 'dev-t1' })
    expect(claudeCalls('dev')[0]!.fork).toBeFalsy()
    // 이벤트 ID가 이어진다
    const ids = rawEvents().map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('병렬 중 한 태스크가 강제 종료되면 나머지를 기다린 뒤 던지고, 다시 열면 중복 없이 완료', async () => {
    const wf1 = await openWith(fakeDeps(PARALLEL_CRASH_SCRIPT()))
    await intake(wf1)
    await expect(wf1.runUntilBlocked()).rejects.toThrow('강제 종료')
    const after = rawEvents().length
    await new Promise((r) => setTimeout(r, 1500))
    expect(rawEvents().length).toBe(after) // 거절된 뒤에는 아무 이벤트도 나오지 않는다
    expect(wf1.state().tasks.t1!.status).toBe('rejected') // 메모리에서 재대기로 되돌림
    expect(wf1.state().tasks.t2!.status).toBe('approved') // 형제 태스크는 끝까지 돌았다(병합은 아직)
    const wf2 = await openWith(fakeDeps(PARALLEL_CONTINUE_SCRIPT()))
    expect(await wf2.runUntilBlocked()).toBe('done')
    expect(wf2.state().tasks.t1!.status).toBe('merged')
    expect(wf2.state().tasks.t2!.status).toBe('merged')
    expect(claudeCalls('dev').map((c) => c.cwd.slice(-2))).toEqual(['t1']) // t2는 다시 돌지 않는다
    const ids = rawEvents().map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('승인된 태스크는 바로 main에 병합되고, 의존 태스크는 그 결과 위에서 시작한다', async () => {
    const seen: Record<string, boolean> = {}
    const wf = await openWith(fakeDeps(DEPS_SCRIPT(seen)))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('done')
    expect(seen).toEqual({ a: false, c: true })
    const ev = rawEvents()
    const mergedA = ev.findIndex((e) => e.task === 'a' && (e.payload as { taskStatus?: string }).taskStatus === 'merged')
    const assignC = ev.findIndex((e) => e.task === 'c' && e.type === 'ASSIGN')
    const integrate = ev.findIndex((e) => (e.payload as { stage?: string }).stage === 'INTEGRATE')
    expect(mergedA).toBeGreaterThan(-1)
    expect(mergedA).toBeLessThan(assignC)
    expect(assignC).toBeLessThan(integrate)
  })

  it('최종 검수 사람 지침은 다음 final-fix 태스크의 지침이 된다', async () => {
    const wf = await openWith(fakeDeps(FINAL_GUIDANCE_SCRIPT(), { rejectLimit: 2 }))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('waiting_human')
    const hr = rawEvents().filter((e) => e.type === 'HUMAN_REQUIRED').at(-1)!
    expect(hr.task).toBe('final')
    await wf.answerHuman(hr.id, { action: 'guidance', text: '추가 버튼을 상단에 고정' })
    expect(await wf.runUntilBlocked()).toBe('done')
    const fixDev = (id: string) => claudeCalls('dev').find((c) => c.cwd.endsWith(id))!
    expect(fixDev('final-fix-3').prompt).toContain('추가 버튼을 상단에 고정')
    expect(fixDev('final-fix-2').prompt).not.toContain('추가 버튼을 상단에 고정')
    expect(wf.state().tasks['final-fix-3']!.status).toBe('merged')
  }, 30_000)

  it('의존이 막힌 승인 태스크는 INTEGRATE에서 병합하지 않고 blocked로 정리한다', async () => {
    const wf1 = await openWith(fakeDeps(HAPPY_SCRIPT()))
    await intake(wf1)
    await fs.writeFile(join(dir, 'plan.json'), JSON.stringify(DEPS_PLAN, null, 2))
    const sc = (payload: object, task?: string) => wf1.bus.publish({ type: 'STATE_CHANGE', from: 'test', to: 'all', ...(task ? { task } : {}), payload })
    await sc({ taskStatus: 'blocked' }, 'a')
    await sc({ taskStatus: 'approved' }, 'c') // (이전 로그 등) 의존이 막혔는데 승인된 상태
    await sc({ stage: 'INTEGRATE' })
    const wf2 = await openWith(fakeDeps(HAPPY_SCRIPT()))
    expect(await wf2.runUntilBlocked()).toBe('done') // task/c 브랜치가 없으므로 병합을 시도하면 실패한다
    expect(wf2.state().tasks.c!.status).toBe('blocked')
  })

  it('미병합 의존이 사람을 기다리면 승인된 자식도 병합을 기다린다', async () => {
    const wf1 = await openWith(fakeDeps(HAPPY_SCRIPT()))
    await intake(wf1)
    await fs.writeFile(join(dir, 'plan.json'), JSON.stringify(DEPS_PLAN))
    for (const task of ['a', 'c']) await wf1.bus.publish({ type: 'STATE_CHANGE', from: 'test', to: 'all', task, payload: { taskStatus: 'approved' } })
    await wf1.bus.publish({ type: 'HUMAN_REQUIRED', from: 'test', to: 'user', task: 'a', payload: {} })
    await wf1.bus.publish({ type: 'STATE_CHANGE', from: 'test', to: 'all', payload: { stage: 'INTEGRATE' } })
    const wf2 = await openWith(fakeDeps(HAPPY_SCRIPT()))
    expect(await wf2.runUntilBlocked()).toBe('waiting_human')
    expect(wf2.state().tasks.c!.status).toBe('approved')
  })

  it('교착이 해결되지 않으면 waiting_human, answerHuman 후 진행', async () => {
    const wf = await openWith(fakeDeps(DEADLOCK_SCRIPT()))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('waiting_human')
    expect(wf.state().humanRequired).toHaveLength(1)
    const hrId = wf.state().humanRequired[0]!
    await wf.answerHuman(hrId, { action: 'skip', text: '이 태스크는 건너뛰어도 됨' })
    expect(await wf.runUntilBlocked()).toBe('done')
    expect(wf.state().tasks.t1!.status).toBe('blocked')
    expect(wf.state().humanRequired).toEqual([])
    const g = rawEvents().find((e) => e.type === 'GUIDANCE' && (e.payload as { resolves?: string }).resolves === hrId)!
    expect(g.payload).toEqual({ action: 'skip', text: '이 태스크는 건너뛰어도 됨', resolves: hrId })
  })

  it('answerHuman guidance는 지침을 넣어 다음 회차로 다시 대기시킨다', async () => {
    const wf = await openWith(fakeDeps(DEADLOCK_SCRIPT(4)))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('waiting_human')
    expect(wf.state().tasks.t1!.round).toBe(4)
    await wf.answerHuman(wf.state().humanRequired[0]!, { action: 'guidance', text: '빈 제목은 서버에서 막아라' })
    expect(await wf.runUntilBlocked()).toBe('done')
    expect(wf.state().tasks.t1).toMatchObject({ status: 'merged', round: 5 })
    const dev5 = claudeCalls('dev').at(-1)!
    expect(dev5.prompt).toContain('빈 제목은 서버에서 막아라')
    expect(dev5.prompt).toContain('F-1')
    expect(dev5).toMatchObject({ resumeSessionId: 'dev-t1' })
  })

  it('지침 대기 중 재시작해도 지침이 유지된다', async () => {
    const wf1 = await openWith(fakeDeps(DEADLOCK_SCRIPT()))
    await intake(wf1)
    expect(await wf1.runUntilBlocked()).toBe('waiting_human')
    await wf1.answerHuman(wf1.state().humanRequired[0]!, { action: 'guidance', text: '재시작 후에도 남는 지침' })
    const wf2 = await openWith(fakeDeps(DEADLOCK_SCRIPT(0)))
    expect(await wf2.runUntilBlocked()).toBe('done')
    expect(claudeCalls('dev')[0]!.prompt).toContain('재시작 후에도 남는 지침')
    expect(wf2.state().tasks.t1!.round).toBe(5)
  })

  it('계획 검수 교착은 사람에게, 지침을 받으면 기획을 다시 한다', async () => {
    const wf = await openWith(fakeDeps(PLAN_DEADLOCK_SCRIPT()))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('waiting_human')
    expect(wf.state().stage).toBe('PLAN')
    const hr = rawEvents().find((e) => e.type === 'HUMAN_REQUIRED')!
    expect(hr.task).toBe('plan')
    await wf.answerHuman(hr.id, { action: 'skip', text: '수용 기준을 보강하라' }) // plan의 skip은 guidance로 취급
    expect(await wf.runUntilBlocked()).toBe('done')
    const planners = claudeCalls('planner').filter((c) => c.resumeSessionId)
    expect(planners.at(-1)!.prompt).toContain('수용 기준을 보강하라')
    expect(planners[1]).toMatchObject({ resumeSessionId: 's-planner' })
    expect(planners[1]!.prompt).toContain('P-1')
    expect(readFileSync(join(dir, 'human/iterations/plan.md'), 'utf8')).toContain('## 3회차')
  })

  it('병합 충돌은 dev가 해결', async () => {
    const wf = await openWith(fakeDeps(CONFLICT_SCRIPT()))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('done')
    expect(lastDevPrompt()).toContain('충돌')
    expect(lastDevPrompt()).toContain('shared.txt')
    expect(lastDevPrompt()).toContain('git merge')
    const fixer = claudeCalls('dev').at(-1)!
    const second = fixer.cwd.slice(-2) // 먼저 승인된 쪽이 먼저 병합되고, 나중 쪽이 충돌을 해결한다
    expect(['t1', 't2']).toContain(second)
    expect(fixer).toMatchObject({ resumeSessionId: `dev-${second}`, cwd: join(dir, `workspace/.worktrees/${second}`) })
    expect(readFileSync(join(dir, 'workspace/shared.txt'), 'utf8').trim()).toBe('resolved') // 시스템 autocrlf에 따라 줄바꿈이 다를 수 있다
    expect(wf.state().tasks.t1!.status).toBe('merged')
    expect(wf.state().tasks.t2!.status).toBe('merged')
  })

  it('최종 검수 반려는 final-fix 태스크를 만든다', async () => {
    const wf = await openWith(fakeDeps(FINAL_REJECT_SCRIPT()))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('done')
    expect(wf.state().tasks['final-fix-1']).toBeDefined()
    expect(wf.state().tasks['final-fix-1']!.status).toBe('merged')
    const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'))
    expect(plan.tasks.at(-1)).toMatchObject({ id: 'final-fix-1', ownedFiles: ['src/t1/a.ts'], acceptance: ['추가 버튼이 보이지 않음'] })
    // 최종 검수 diff는 첫 커밋부터 HEAD까지
    const finals = deps.reviewer.calls.filter((c) => c.cwd === join(dir, 'workspace') && !c.prompt.includes('계획 검수자'))
    expect(finals).toHaveLength(2)
    expect(finals[0]!.prompt).toContain('src/t1/a.ts')
    expect(existsSync(join(dir, 'human/evidence/final/r2/manifest.json'))).toBe(true)
  })

  it('dev가 상향(opus)되면 seedFor는 모델마다 시드를 한 번만 만든다 (병렬 포함)', async () => {
    const wf = await openWith(fakeDeps(UPGRADE_SCRIPT()))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('done')
    expect(seedCalls().filter((c) => c.model === 'sonnet')).toHaveLength(1)
    expect(seedCalls().filter((c) => c.model === 'opus')).toHaveLength(1)
    const opusDevs = claudeCalls('dev').filter((c) => c.model === 'opus')
    expect(opusDevs.length).toBe(2)
    for (const c of opusDevs) expect(c).toMatchObject({ resumeSessionId: 'seed-opus', fork: true })
    expect(wf.state().seedSessionIds).toEqual({ opus: 'seed-opus', sonnet: 'seed-sonnet' })
  })

  it('같은 모델의 seedFor 동시 호출은 시드를 하나만 만든다', async () => {
    const wf = await openWith(fakeDeps(HAPPY_SCRIPT()))
    await intake(wf)
    const ids = await Promise.all([wf.seedFor('haiku'), wf.seedFor('haiku'), wf.seedFor('haiku')])
    expect(ids).toEqual(['seed-haiku', 'seed-haiku', 'seed-haiku'])
    expect(seedCalls().filter((c) => c.model === 'haiku')).toHaveLength(1)
    expect(seedCalls()[0]).toMatchObject({ role: 'planner', cwd: join(dir, 'workspace'), timeoutMs: deps.config.timeoutsMs.planner })
    expect(rawEvents().filter((e) => (e.payload as { seed?: unknown }).seed)).toHaveLength(1)
    expect(await wf.seedFor('haiku')).toBe('seed-haiku')
    expect(seedCalls()).toHaveLength(1)
  })

  it('스펙 초안 없이 승인하면 오류, INTAKE가 아니면 chat 불가', async () => {
    const wf = await openWith(fakeDeps(HAPPY_SCRIPT()))
    await expect(wf.approveSpec()).rejects.toThrow()
    await intake(wf)
    await expect(wf.chat('또')).rejects.toThrow()
  })

  it('권한 복구 지침은 이전 작업 세션을 버리고 새 시드에서 시작할 수 있다', async () => {
    const wf = await openWith(fakeDeps(DEADLOCK_SCRIPT()))
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('waiting_human')
    const id = wf.state().humanRequired[0]!
    await wf.answerHuman(id, { action: 'guidance', text: '새 권한으로 재시작', restartSession: true })
    expect(wf.state().tasks.t1!.sessionId).toBe('')
    expect(wf.state().humanRequired).toEqual([])
  })

  it('프로세스 재시작 후 이전 PAUSED 표시를 지우고 새 제공자에서 한도를 재확인한다', async () => {
    const first = await openWith(fakeDeps(HAPPY_SCRIPT()))
    await first.bus.publish({ type: 'PAUSED', from: 'test', to: 'all', payload: { reason: 'rate_limit', until: '2099-01-01T00:00:00Z' } })
    const deps = fakeDeps(HAPPY_SCRIPT())
    deps.config.agents.master.provider = 'codex'
    const reopened = await openWith(deps)
    expect(reopened.state().paused).toBeUndefined()
    expect(rawEvents().at(-1)!.type).toBe('RESUMED')
    expect(rawEvents().find((event) => event.type === 'PAUSED')).toBeDefined()
  })

  it('Codex 역할 설정을 모든 호출과 제공자별 시드에 적용한다', async () => {
    const d = fakeDeps(HAPPY_SCRIPT())
    d.config.agents = { master: { provider: 'codex' }, worker: { provider: 'codex', model: 'worker-model' } }
    const wf = await openWith(d)
    await intake(wf)
    expect(await wf.runUntilBlocked()).toBe('done')
    for (const role of ['dev', 'qa', 'wiki'] as const) expect(d.claude.calls.filter((call) => call.role === role).every((call) => call.model === 'worker-model')).toBe(true)
    expect(wf.state().seedSessionIds['codex:planner:codex-default']).toBeDefined()
    expect(wf.state().seedSessionIds['codex:dev:worker-model']).toBeDefined()
    expect(d.claude.calls.filter((call) => call.role === 'planner' && !call.resumeSessionId).every((call) => call.provider === 'codex')).toBe(true)
  })

  it('reviewer 팩토리는 RunState.apiSpendUsd 위의 SpendTracker를 받는다', async () => {
    let spend: SpendTracker | undefined
    const d = fakeDeps(HAPPY_SCRIPT())
    const wf = await openWith({ ...d, reviewer: (s: SpendTracker) => { spend = s; return d.reviewer } } as unknown as TestWorkflowDeps)
    expect(spend!.get()).toBe(0)
    await spend!.add(0.25)
    await spend!.add(0.5)
    expect(spend!.get()).toBe(0.75)
    expect(wf.state().apiSpendUsd).toBe(0.75)
    const reopened = await Workflow.open(dir, d)
    expect(reopened.state().apiSpendUsd).toBe(0.75)
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).apiSpendUsd).toBe(0.75)
  })
})
