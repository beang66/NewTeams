import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs, existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { runTaskLoop, type LoopDeps, type MasterDecision } from '../../src/engine/reviewLoop.js'
import { EventBus } from '../../src/bus/eventBus.js'
import { ProjectStore } from '../../src/store/projectStore.js'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { FakeRunner, type FakeItem } from '../../src/runners/fakeRunner.js'
import { RunnerError, type RunRequest } from '../../src/runners/types.js'
import { ensureRepo } from '../../src/workspace/git.js'
import type { Envelope } from '../../src/protocol/messages.js'
import type { Plan, PlanTask } from '../../src/protocol/plan.js'
import { tmpDir, fakeClock, PNG_1X1 } from '../helpers.js'

const T1: PlanTask = {
  id: 't1', title: '로그인 폼', deps: [], ownedFiles: ['src/t1/**', 'fixed'], difficulty: 'mid',
  acceptance: ['로그인 성공 시 대시보드로 이동'], qaScenarios: [{ id: 'S-1', steps: ['열기', '로그인'] }],
}
const PLAN: Plan = { tasks: [T1], testCommands: [], devCommand: 'npm run dev' }
const USAGE = { in: 10, out: 5, cached: 1 }

let root: string
let store: ProjectStore
let repo: string
let log: Envelope[]
let writeSeq = 0

beforeEach(async () => {
  root = await tmpDir()
  store = new ProjectStore(join(root, 'proj'))
  await store.init()
  repo = join(root, 'repo')
  await ensureRepo(repo)
  log = []
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 })
})

// ---- FakeRunner 항목 ----
interface DevOpts { session?: string; writes?: string[]; removes?: string[]; text?: string; blocked?: { reason: string; detail: string } }
function devOk(o: string | DevOpts = {}): FakeItem {
  const opts: DevOpts = typeof o === 'string' ? { session: o } : o
  return (req: RunRequest) => {
    const writes = opts.writes ?? ['src/t1/a.ts']
    for (const f of writes) {
      const p = join(req.cwd, f)
      mkdirSync(dirname(p), { recursive: true })
      writeSeq += 1
      writeFileSync(p, `// ${writeSeq}\n`)
    }
    for (const f of opts.removes ?? []) rmSync(join(req.cwd, f), { force: true })
    const body = opts.text ?? JSON.stringify({ changedFiles: writes, testsRun: [], claims: ['구현함'], ...(opts.blocked ? { blocked: opts.blocked } : {}) })
    return { text: body, sessionId: opts.session ?? 's-dev', usage: USAGE }
  }
}
function qaOk(scenarios: Record<string, number> = { 'S-1': 1 }): FakeItem {
  return (req: RunRequest) => {
    const dir = req.addDirs![0]!
    mkdirSync(dir, { recursive: true })
    const manifest = Object.entries(scenarios).map(([scenarioId, n]) => ({
      scenarioId,
      steps: Array.from({ length: n }, (_, i) => {
        const shot = `${scenarioId}-${i + 1}.png`
        writeFileSync(join(dir, shot), PNG_1X1)
        return { step: i + 1, action: `step ${i + 1}`, screenshot: shot, ts: new Date().toISOString() }
      }),
    }))
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
    return { text: JSON.stringify({ scenarios: Object.keys(scenarios).map((id) => ({ id, passed: true })) }), sessionId: 's-qa', usage: USAGE }
  }
}
const verdictText = (verdict: 'approve' | 'reject', ids: string[], resolved: string[] = []) => JSON.stringify({
  verdict, resolved,
  findings: ids.map((id) => ({ id, severity: 'major', file: 'src/t1/a.ts', issue: `문제 ${id}`, evidence_ref: null })),
})
const approveV = (resolved: string[] = []): FakeItem => ({ text: verdictText('approve', [], resolved), sessionId: 's-rev', usage: USAGE })
const rejectV = (ids: string[]): FakeItem => ({ text: verdictText('reject', ids), sessionId: 's-rev', usage: USAGE })
const ok = (text: string): FakeItem => ({ text, sessionId: 's-rev', usage: USAGE })
const round = (n: number): FakeItem[] => Array.from({ length: n }, () => [devOk('s-dev'), qaOk()]).flat()


type TestDeps = LoopDeps & { claude: FakeRunner; reviewer: FakeRunner; askMaster: ReturnType<typeof vi.fn>; seedFor: ReturnType<typeof vi.fn> }
function deps(o: { claude: FakeItem[]; reviewer: FakeItem[]; master?: MasterDecision[]; plan?: Plan; cliRetry?: number }): TestDeps {
  const bus = new EventBus(store, fakeClock)
  bus.subscribe((e) => log.push(e))
  const askMaster = vi.fn()
  for (const m of o.master ?? []) askMaster.mockResolvedValueOnce(m)
  const seedFor = vi.fn(async (model: string) => `seed-${model}`)
  return {
    bus, store, clock: fakeClock,
    config: { ...structuredClone(DEFAULT_CONFIG), ...(o.cliRetry !== undefined ? { cliRetry: o.cliRetry } : {}) },
    claude: new FakeRunner(o.claude), reviewer: new FakeRunner(o.reviewer),
    run: (fn) => fn(),
    askMaster, plan: o.plan ?? PLAN, repo, seedFor,
  } as TestDeps
}
const events = () => log
const types = () => log.map((e) => e.type)
const firstReject = () => log.find((e) => e.type === 'REJECT')!.payload as { findings: { issue: string }[] }
const payload = (e: Envelope) => e.payload as Record<string, unknown>

describe('runTaskLoop', () => {
  it('한 번에 승인', async () => {
    const out = await runTaskLoop(T1, deps({ claude: [devOk(), qaOk()], reviewer: [approveV()] }))
    expect(out).toEqual({ kind: 'approved' })
    expect(types()).toEqual(['ASSIGN', 'STATE_CHANGE', 'REPORT', 'REVIEW_REQUEST', 'APPROVE'])
  })

  it('첫 회차 dev는 시드를 포크하고 worktree·세션을 STATE_CHANGE로 남긴다', async () => {
    const d = deps({ claude: [devOk('s-dev'), qaOk()], reviewer: [approveV()] })
    await runTaskLoop(T1, d)
    expect(d.seedFor).toHaveBeenCalledWith('sonnet')
    expect(d.claude.calls[0]).toMatchObject({ role: 'dev', model: 'sonnet', resumeSessionId: 'seed-sonnet', fork: true })
    expect(d.claude.calls[0]!.cwd).toBe(join(repo, '.worktrees', 't1'))
    const sc = events().find((e) => e.type === 'STATE_CHANGE')!
    expect(sc.task).toBe('t1')
    expect(sc.payload).toEqual({ sessionId: 's-dev', worktree: join(repo, '.worktrees', 't1') })
  })

  it('반려 후 같은 세션으로 수정하고 승인', async () => {
    const d = deps({ claude: [devOk('s-dev'), qaOk(), devOk('s-dev'), qaOk()], reviewer: [rejectV(['F-1']), approveV(['F-1'])] })
    await runTaskLoop(T1, d)
    expect(d.claude.calls[2]).toMatchObject({ resumeSessionId: 's-dev' })
    expect(d.claude.calls[2]!.fork).toBeFalsy()
    expect(d.claude.calls[2]!.prompt).toContain('F-1')
    // R6: 2회차 dev 응답은 REVISION(addressed=이전 지적 ID)
    expect(types()).toEqual(['ASSIGN', 'STATE_CHANGE', 'REPORT', 'REVIEW_REQUEST', 'REJECT',
      'ASSIGN', 'REVISION', 'REVIEW_REQUEST', 'APPROVE'])
    const rev = events().find((e) => e.type === 'REVISION')!
    expect(payload(rev).addressed).toEqual(['F-1'])
    expect(rev.round).toBe(2)
    // 검수자에게 이전 지적이 전달된다
    expect(d.reviewer.calls[1]!.prompt).toContain('F-1')
  })

  it('2회차 검수는 검수 세션을 이어 지난 검수 이후 diff만 보내고, 새로 시작할 전체 프롬프트를 함께 둔다', async () => {
    const d = deps({ claude: [devOk(), qaOk(), devOk({ writes: ['src/t1/b.ts'] }), qaOk()], reviewer: [rejectV(['F-1']), approveV(['F-1'])] })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    const [first, second] = d.reviewer.calls
    expect(first!.resumeSessionId).toBeUndefined()
    expect(first!.freshPrompt).toBeUndefined()
    expect(second).toMatchObject({ resumeSessionId: 's-rev', outputSchema: first!.outputSchema })
    expect(second!.images).toHaveLength(1)
    expect(second!.prompt).toContain('diff --git a/src/t1/b.ts')
    expect(second!.prompt).not.toContain('diff --git a/src/t1/a.ts')
    expect(second!.prompt).toContain('F-1')
    expect(second!.freshPrompt).toContain('diff --git a/src/t1/a.ts')
    expect(second!.freshPrompt).toContain('diff --git a/src/t1/b.ts')
    expect(second!.freshPrompt).toContain(T1.acceptance[0])
  })

  it('검수 세션 ID가 없으면(OpenAI 대체 등) 다음 회차도 전체 검수', async () => {
    const d = deps({
      claude: [devOk(), qaOk(), devOk({ writes: ['src/t1/b.ts'] }), qaOk()],
      reviewer: [{ text: verdictText('reject', ['F-1']), usage: USAGE }, approveV(['F-1'])],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    const second = d.reviewer.calls[1]!
    expect(second.resumeSessionId).toBeUndefined()
    expect(second.prompt).toContain('diff --git a/src/t1/a.ts')
    expect(second.prompt).toContain(T1.acceptance[0])
  })

  it('하네스 반려 회차의 변경도 다음 이어가기 검수 diff에 들어간다', async () => {
    const FIXED_CMD = `node -e "process.exit(require('fs').existsSync('fixed')?0:1)"`
    const d = deps({
      plan: { ...PLAN, testCommands: [FIXED_CMD] },
      claude: [devOk({ writes: ['src/t1/a.ts', 'fixed'] }), qaOk(), devOk({ writes: ['src/t1/b.ts'], removes: ['fixed'] }), devOk({ writes: ['src/t1/c.ts', 'fixed'] }), qaOk()],
      reviewer: [rejectV(['F-1']), approveV(['F-1'])],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    const second = d.reviewer.calls[1]!
    expect(second.resumeSessionId).toBe('s-rev')
    expect(second.prompt).toContain('diff --git a/src/t1/b.ts')
    expect(second.prompt).toContain('diff --git a/src/t1/c.ts')
    expect(second.prompt).not.toContain('diff --git a/src/t1/a.ts')
  })

  it('테스트가 실패하면 GPT를 부르지 않고 반려', async () => {
    const d = deps({
      plan: { ...PLAN, testCommands: [`node -e "process.exit(require('fs').existsSync('fixed')?0:1)"`] },
      claude: [devOk(), devOk({ writes: ['fixed'] }), qaOk()], reviewer: [approveV()],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(d.reviewer.calls).toHaveLength(1)
    const rej = events().find((e) => e.type === 'REJECT')!
    expect(rej.from).toBe('harness')
    const issue = (rej.payload as { findings: { issue: string }[] }).findings[0]!.issue
    expect(issue).toContain('existsSync')
  })

  it('설치 명령이 실패하면 테스트를 돌리지 않고 설치 실패로 반려', async () => {
    const d = deps({
      plan: {
        ...PLAN,
        setupCommands: [`node -e "process.exit(require('fs').existsSync('fixed')?0:1)"`],
        testCommands: [`node -e "require('fs').writeFileSync('tested','')"`],
      },
      claude: [devOk(), devOk({ writes: ['fixed'] }), qaOk()], reviewer: [approveV()],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    const rej = events().find((e) => e.type === 'REJECT')!
    expect(rej.from).toBe('harness')
    const issue = (rej.payload as { findings: { issue: string }[] }).findings[0]!.issue
    expect(issue).toContain('설치 명령 실패')
    expect(d.claude.calls[0]!.prompt).toContain('## 자체 검사')
  })

  it('같은 지적 2회 → 마스터 지침 → 승인', async () => {
    const d = deps({ claude: [...round(3)], reviewer: [rejectV(['F-1']), rejectV(['F-1']), approveV()], master: [{ action: 'guidance', text: '입력 검증을 서버에서' }] })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(types()).toContain('ESCALATE')
    expect(d.claude.calls.at(-2)!.prompt).toContain('입력 검증을 서버에서')
    const esc = events().find((e) => e.type === 'ESCALATE')!
    expect(payload(esc).reason).toBe('repeat_finding')
    expect(existsSync(join(store.paths.raw, '..', esc.promptRef!))).toBe(true)
    const g = events().find((e) => e.type === 'GUIDANCE')!
    expect(g.payload).toEqual({ action: 'guidance', text: '입력 검증을 서버에서' })
    const input = d.askMaster.mock.calls[0]![0]
    expect(input).toMatchObject({ role: 'master', mode: 'escalation', taskId: 't1', reason: 'repeat_finding' })
    expect(input.findings[0].id).toBe('F-1')
    expect(input.history).toContain('r1')
  })

  it('지침 후에도 교착이면 사람에게', async () => {
    const out = await runTaskLoop(T1, deps({
      claude: [...round(4)],
      reviewer: [rejectV(['F-1']), rejectV(['F-1']), rejectV(['F-2']), rejectV(['F-2'])],
      master: [{ action: 'guidance', text: 'x' }],
    }))
    expect(out.kind).toBe('human_required')
    const hr = events().find((e) => e.type === 'HUMAN_REQUIRED')!
    expect(out).toEqual({ kind: 'human_required', eventId: hr.id })
    expect(payload(hr).reason).toBe('repeat_finding')
    expect(types().filter((t) => t === 'ESCALATE')).toHaveLength(1)
  })

  it('upgrade면 이후 dev 모델이 opus이고 opus 시드를 포크한다', async () => {
    const d = deps({ claude: [...round(3)], reviewer: [rejectV(['F-1']), rejectV(['F-1']), approveV()], master: [{ action: 'upgrade', text: '모델 상향' }] })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    const devCalls = d.claude.calls.filter((c) => c.role === 'dev')
    const lastDevCall = devCalls.at(-1)!
    expect(lastDevCall.model).toBe('opus')
    expect(lastDevCall).toMatchObject({ resumeSessionId: 'seed-opus', fork: true })
    expect(devCalls[1]!.model).toBe('sonnet')
  })

  it('split이면 하위 태스크를 돌려준다', async () => {
    const sub: PlanTask = { ...T1, id: 't1a' }
    const out = await runTaskLoop(T1, deps({ claude: [...round(2)], reviewer: [rejectV(['F-1']), rejectV(['F-1'])], master: [{ action: 'split', text: '나눔', subtasks: [sub] }] }))
    expect(out).toEqual({ kind: 'split', subtasks: [sub] })
  })

  it('give_up이면 사람에게', async () => {
    const out = await runTaskLoop(T1, deps({ claude: [...round(2)], reviewer: [rejectV(['F-1']), rejectV(['F-1'])], master: [{ action: 'give_up', text: '불가' }] }))
    expect(out.kind).toBe('human_required')
    expect(types().slice(-3)).toEqual(['ESCALATE', 'GUIDANCE', 'HUMAN_REQUIRED'])
  })

  it('검수 출력 형식 오류는 1회 복구', async () => {
    const d = deps({ claude: [devOk(), qaOk()], reviewer: [ok('승인합니다'), approveV()] })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(d.reviewer.calls[1]!.prompt).toContain('형식')
    expect(d.reviewer.calls[1]!.resumeSessionId).toBe('s-rev')
  })

  it('검수 출력 형식 오류가 두 번이면 repeat_error로 상신', async () => {
    const d = deps({ claude: [...round(2)], reviewer: [ok('a'), ok('b'), approveV()], master: [{ action: 'guidance', text: 'g' }] })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(payload(events().find((e) => e.type === 'ESCALATE')!).reason).toBe('repeat_error')
  })

  it('에이전트 설정 파일(.claude 등) 수정은 소유 범위와 무관하게 하네스 반려', async () => {
    const all: PlanTask = { ...T1, ownedFiles: ['**'] }
    let leftOver: boolean | undefined
    const round2: FakeItem = (req) => { leftOver = existsSync(join(req.cwd, '.claude', 'settings.json')); return (devOk() as (r: RunRequest) => ReturnType<typeof devOk>)(req) as never }
    const d = deps({
      claude: [devOk({ writes: ['src/t1/a.ts', '.claude/settings.json'] }), round2, qaOk()],
      reviewer: [approveV()],
    })
    expect(await runTaskLoop(all, d)).toEqual({ kind: 'approved' })
    expect(leftOver).toBe(false) // 다음 회차 에이전트가 시작할 때 이미 지워져 있어야 한다
    expect(firstReject().findings[0]!.issue).toContain('.claude/settings.json')
    expect(events().find((e) => e.type === 'REJECT')!.from).toBe('harness')
  })

  it('소유 범위 밖 수정은 하네스 반려', async () => {
    const d = deps({
      claude: [devOk({ writes: ['src/t1/a.ts', 'src/other.ts'] }), devOk({ writes: ['src/t1/a.ts'], removes: ['src/other.ts'] }), qaOk()],
      reviewer: [approveV()],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(firstReject().findings[0]!.issue).toContain('소유 범위 밖')
    expect(firstReject().findings[0]!.issue).toContain('src/other.ts')
    expect(events().find((e) => e.type === 'REJECT')!.from).toBe('harness')
  })

  it('blocked 응답은 그 사유로 상신한다', async () => {
    const d = deps({
      claude: [devOk({ blocked: { reason: 'permission', detail: '네트워크 권한 없음' } }), ...round(1)],
      reviewer: [approveV()], master: [{ action: 'guidance', text: '권한 없이 진행' }],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(types().slice(0, 4)).toEqual(['ASSIGN', 'STATE_CHANGE', 'ESCALATE', 'GUIDANCE'])
    expect(payload(events().find((e) => e.type === 'ESCALATE')!)).toEqual({ reason: 'permission', detail: '네트워크 권한 없음' })
    expect(d.askMaster.mock.calls[0]![0].history).toContain('네트워크 권한 없음')
  })

  it('dev 응답이 JSON이 아니어도 git 변경 파일로 REPORT를 남긴다', async () => {
    await runTaskLoop(T1, deps({ claude: [devOk({ text: '다 했습니다' }), qaOk()], reviewer: [approveV()] }))
    expect(events().find((e) => e.type === 'REPORT')!.payload).toEqual({ changedFiles: ['src/t1/a.ts'], testsRun: [], claims: [] })
  })

  it('crash는 cliRetry만큼 다시 시도한다', async () => {
    const d = deps({ claude: [new RunnerError('crash', 'boom'), devOk(), qaOk()], reviewer: [approveV()] })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(d.claude.calls[1]).toMatchObject({ role: 'dev', resumeSessionId: 'seed-sonnet', fork: true })
  })

  it('재시도 후에도 timeout이면 repeat_error로 상신한다', async () => {
    const d = deps({
      claude: [new RunnerError('timeout', 't'), new RunnerError('timeout', 't'), ...round(1)],
      reviewer: [approveV()], master: [{ action: 'guidance', text: 'g' }],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(payload(events().find((e) => e.type === 'ESCALATE')!).reason).toBe('repeat_error')
  })

  const FIXED_CMD = `node -e "process.exit(require('fs').existsSync('fixed')?0:1)"`

  it('서로 다른 하네스 실패가 연달아 나와도 상신하지 않는다', async () => {
    const d = deps({
      plan: { ...PLAN, testCommands: [FIXED_CMD] },
      claude: [
        devOk({ writes: ['src/t1/a.ts', 'fixed', 'src/other.ts'] }),          // 소유 범위 위반만
        devOk({ writes: ['src/t1/a.ts'], removes: ['src/other.ts', 'fixed'] }), // 테스트 실패만
        devOk({ writes: ['fixed'] }), qaOk(),
      ],
      reviewer: [approveV()],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(types()).not.toContain('ESCALATE')
    const ids = events().filter((e) => e.type === 'REJECT').map((e) => (e.payload as { findings: { id: string }[] }).findings.map((f) => f.id))
    expect(ids).toEqual([['H-own:src/other.ts'], [`H-test:${FIXED_CMD}`]])
  })

  it('같은 하네스 실패가 두 번이면 repeat_finding으로 상신한다', async () => {
    const d = deps({
      plan: { ...PLAN, testCommands: [FIXED_CMD] },
      claude: [devOk(), devOk(), devOk({ writes: ['fixed'] }), qaOk()],
      reviewer: [approveV()], master: [{ action: 'guidance', text: 'fixed 파일을 만들 것' }],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(payload(events().find((e) => e.type === 'ESCALATE')!).reason).toBe('repeat_finding')
  })

  it('검수자 세션 ID가 없으면 형식 복구는 원래 요청 전체를 다시 보낸다', async () => {
    const d = deps({ claude: [devOk(), qaOk()], reviewer: [{ text: '승인합니다', usage: USAGE }, approveV()] })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    const [first, repair] = d.reviewer.calls
    expect(repair!.resumeSessionId).toBeUndefined()
    expect(repair!.prompt).toContain(first!.prompt)
    expect(repair!.prompt).toContain('src/t1/a.ts') // diff
    expect(repair!.prompt).toContain('형식')
    expect(repair!.images).toEqual(first!.images)
    expect(repair!.outputSchema).toEqual(first!.outputSchema)
  })

  it('러너가 던진 format 오류는 재시도 후 repeat_error로 상신한다', async () => {
    const d = deps({
      claude: [new RunnerError('format', 'no result line'), new RunnerError('format', 'no result line'), ...round(1)],
      reviewer: [approveV()], master: [{ action: 'guidance', text: 'g' }],
    })
    expect(await runTaskLoop(T1, d)).toEqual({ kind: 'approved' })
    expect(payload(events().find((e) => e.type === 'ESCALATE')!).reason).toBe('repeat_error')
  })

  it('하위 태스크 없는 split은 사람에게', async () => {
    const out = await runTaskLoop(T1, deps({ claude: [...round(2)], reviewer: [rejectV(['F-1']), rejectV(['F-1'])], master: [{ action: 'split', text: '나눔' }] }))
    expect(out.kind).toBe('human_required')
    expect(types().at(-1)).toBe('HUMAN_REQUIRED')
  })

  it('알 수 없는 blocked 사유는 other로 상신하고 원래 사유를 detail에 남긴다', async () => {
    const d = deps({
      claude: [devOk({ blocked: { reason: 'disk_full', detail: '디스크 부족' } }), ...round(1)],
      reviewer: [approveV()], master: [{ action: 'guidance', text: 'g' }],
    })
    await runTaskLoop(T1, d)
    const p = payload(events().find((e) => e.type === 'ESCALATE')!)
    expect(p.reason).toBe('other')
    expect(p.detail).toContain('disk_full')
    expect(p.detail).toContain('디스크 부족')
  })

  it('rate_limit 등 다른 오류는 그대로 던진다', async () => {
    const d = deps({ claude: [new RunnerError('rate_limit', 'limit')], reviewer: [] })
    await expect(runTaskLoop(T1, d)).rejects.toMatchObject({ kind: 'rate_limit' })
  })

  it('QA는 Playwright MCP·증거 폴더로 실행하고 검수자는 마지막 캡처를 이미지로 받는다', async () => {
    const d = deps({ claude: [devOk(), qaOk({ 'S-1': 2, 'S-2': 1 })], reviewer: [approveV()] })
    await runTaskLoop(T1, d)
    const qa = d.claude.calls[1]!
    const wt = join(repo, '.worktrees', 't1')
    const evDir = join(store.paths.evidence, 't1', 'r1')
    expect(qa).toMatchObject({ role: 'qa', cwd: wt, allowedTools: ['mcp__playwright', 'Bash', 'Read', 'Write'], addDirs: [evDir] })
    expect(qa.mcpConfig).toBe(join(store.paths.raw, 'playwright-mcp.json'))
    expect(JSON.parse(readFileSync(qa.mcpConfig!, 'utf8'))).toEqual({ mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@0.0.83'] } } })
    expect(qa.prompt).toContain(evDir)
    const rv = d.reviewer.calls[0]!
    expect(rv).toMatchObject({ role: 'reviewer', model: 'codex-default', cwd: wt })
    expect(rv.outputSchema).toBeDefined()
    expect(rv.images).toEqual([join(evDir, 'S-1-2.png'), join(evDir, 'S-2-1.png')])
    expect(rv.images!.every((p) => isAbsolute(p))).toBe(true)
    expect(rv.prompt).toContain('src/t1/a.ts') // diff
  })

  it('start로 회차·세션·지침·지적을 이어받는다 (재개/사람 지침)', async () => {
    const d = deps({ claude: [devOk('s-old'), qaOk()], reviewer: [approveV(['F-9'])] })
    const prev = [{ id: 'F-9', severity: 'major' as const, issue: '이전 문제' }]
    expect(await runTaskLoop(T1, d, { round: 3, sessionId: 's-old', guidance: '사람 지침', findings: prev })).toEqual({ kind: 'approved' })
    expect(d.seedFor).not.toHaveBeenCalled()
    expect(d.claude.calls[0]).toMatchObject({ role: 'dev', resumeSessionId: 's-old' })
    expect(d.claude.calls[0]!.fork).toBeFalsy()
    expect(d.claude.calls[0]!.prompt).toContain('사람 지침')
    expect(d.claude.calls[0]!.prompt).toContain('F-9')
    expect(events()[0]).toMatchObject({ type: 'ASSIGN', round: 3 })
    const rev = events().find((e) => e.type === 'REVISION')!
    expect(rev.round).toBe(3)
    expect(payload(rev).addressed).toEqual(['F-9'])
  })

  it('ASSIGN·REVIEW_REQUEST는 promptRef를, 에이전트 응답 이벤트는 sessionRef·usage를 갖는다', async () => {
    await runTaskLoop(T1, deps({ claude: [devOk(), qaOk()], reviewer: [approveV()] }))
    const projRoot = join(store.paths.raw, '..')
    for (const t of ['ASSIGN', 'REVIEW_REQUEST', 'REPORT', 'APPROVE'] as const) {
      const e = events().find((x) => x.type === t)!
      expect(e.promptRef, t).toMatch(/^raw\/prompts\/.+\.txt$/)
      expect(existsSync(join(projRoot, e.promptRef!)), t).toBe(true)
      expect(e.task).toBe('t1')
      expect(e.round).toBe(1)
    }
    const rep = events().find((x) => x.type === 'REPORT')!
    expect(rep).toMatchObject({ from: 'dev', sessionRef: 'raw/sessions/dev-t1.jsonl', usage: USAGE })
    const ap = events().find((x) => x.type === 'APPROVE')!
    expect(ap).toMatchObject({ from: 'reviewer', sessionRef: 'raw/sessions/reviewer-t1.jsonl', usage: USAGE })
    // 이벤트 로그 파일에도 기록된다
    expect((await store.readEvents()).map((e) => e.type)).toEqual(types())
  })
})
