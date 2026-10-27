import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '../../../src/protocol/plan.js'
import { makeScript, verdict, APPROVE, T1, PLAN_ONE, type Script } from './common.js'

// 각 스크립트는 호출 횟수를 세므로 테스트마다 새로 만든다.

/** 모든 단계가 한 번에 통과. */
export const HAPPY_SCRIPT = (): Script => makeScript()

/** t1이 1회차에 반려되고 2회차에 승인(minor 지적 1개 → backlog). */
export const REJECT_ONCE_SCRIPT = (): Script => makeScript({
  reviewTask: (_id, n) => n === 1
    ? verdict('reject', [{ id: 'F-1', file: 'src/t1/a.ts', issue: '빈 제목 허용' }])
    : verdict('approve', [{ id: 'F-2', severity: 'minor', file: 'src/t1/a.ts', issue: '변수 이름 다듬기' }], ['F-1']),
})

/** 시드(opus)·planner·시드(sonnet)·dev 다음, QA(= REPORT 이후 첫 claude 호출)에서 강제 종료. */
export const CRASH_AFTER_REPORT_SCRIPT = (): Script => makeScript({ crash: (req) => req.role === 'qa' })

/** 재개 후 남은 단계를 모두 통과. */
export const CONTINUE_SCRIPT = (): Script => makeScript()

/** t1 검수가 늘 같은 지적으로 반려 → 마스터 지침 → 다시 교착 → 사람. 최종 검수는 승인. */
export const DEADLOCK_SCRIPT = (approveAfter = Infinity): Script => makeScript({
  reviewTask: (_id, n) => (n > approveAfter ? APPROVE : verdict('reject', [{ id: 'F-1', file: 'src/t1/a.ts' }])),
})

/** 계획 검수가 같은 지적을 두 번 → 사람. 이후 승인. */
export const PLAN_DEADLOCK_SCRIPT = (): Script => makeScript({
  reviewPlan: (n) => (n <= 2 ? verdict('reject', [{ id: 'P-1', issue: '수용 기준 누락' }]) : APPROVE),
})

/** 두 태스크가 같은 파일(shared.txt)을 서로 다르게 만든다 → 두 번째 병합에서 충돌. */
export const CONFLICT_PLAN: Plan = {
  tasks: [
    { ...T1, id: 't1', ownedFiles: ['shared.txt'], qaScenarios: [] },
    { ...T1, id: 't2', title: '정렬', ownedFiles: ['*.txt'], qaScenarios: [] },
  ],
  testCommands: [], devCommand: 'npm run dev',
}
export const CONFLICT_SCRIPT = (): Script => makeScript({ plan: CONFLICT_PLAN, devFiles: { t1: 'shared.txt', t2: 'shared.txt' } })

/** 최종 검수가 1회 반려 → final-fix-1 → 승인. */
export const FINAL_REJECT_SCRIPT = (): Script => makeScript({
  devFiles: { 'final-fix-1': 'src/t1/a.ts' },
  reviewFinal: (n) => (n === 1 ? verdict('reject', [{ id: 'G-1', file: 'src/t1/a.ts', issue: '추가 버튼이 보이지 않음' }]) : APPROVE),
})

/** 두 태스크가 병렬로 교착 → 마스터가 둘 다 opus로 상향. */
export const UPGRADE_PLAN: Plan = {
  tasks: [{ ...T1, qaScenarios: [] }, { ...T1, id: 't2', ownedFiles: ['src/t2/**'], qaScenarios: [] }],
  testCommands: [], devCommand: 'npm run dev',
}
export const UPGRADE_SCRIPT = (): Script => makeScript({
  plan: UPGRADE_PLAN,
  master: () => ({ action: 'upgrade', text: '모델 상향' }),
  reviewTask: (id, n) => (n <= 2 ? verdict('reject', [{ id: `F-${id}` }]) : APPROVE),
})

/** 두 태스크 병렬, t1의 dev 호출에서 강제 종료. t2는 아직 진행 중. */
export const PARALLEL_PLAN: Plan = {
  tasks: [T1, { ...T1, id: 't2', title: '정렬', ownedFiles: ['src/t2/**'] }],
  testCommands: [], devCommand: 'npm run dev',
}
export const PARALLEL_CRASH_SCRIPT = (): Script => makeScript({
  plan: PARALLEL_PLAN, crash: (req) => req.role === 'dev' && req.cwd.endsWith('t1'),
})
export const PARALLEL_CONTINUE_SCRIPT = (): Script => makeScript({ plan: PARALLEL_PLAN })

/** c는 a에 의존. c의 dev가 돌 때 worktree에 a의 파일이 있는지 기록한다. */
export const DEPS_PLAN: Plan = {
  tasks: [{ ...T1, id: 'a', ownedFiles: ['src/a/**'], qaScenarios: [] }, { ...T1, id: 'c', deps: ['a'], ownedFiles: ['src/c/**'], qaScenarios: [] }],
  testCommands: [], devCommand: 'npm run dev',
}
export const DEPS_SCRIPT = (seen: Record<string, boolean>): Script => makeScript({
  plan: DEPS_PLAN, onDev: (id, req) => { seen[id] = existsSync(join(req.cwd, 'src/a/a.ts')) },
})

/** 최종 검수가 세 번 반려(rejectLimit=2로 쓰면 두 번째 뒤에 사람 개입) → 네 번째 승인. */
export const FINAL_GUIDANCE_SCRIPT = (): Script => makeScript({
  devFiles: { 'final-fix-1': 'src/t1/a.ts', 'final-fix-2': 'src/t1/a.ts', 'final-fix-3': 'src/t1/a.ts' },
  reviewFinal: (n) => (n <= 3 ? verdict('reject', [{ id: `G-${n}`, file: 'src/t1/a.ts', issue: `최종 문제 ${n}` }]) : APPROVE),
})

export { PLAN_ONE }
