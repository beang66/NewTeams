import { z } from 'zod'
import type { PackReviewContext, PackReviewFinding, WorkPack } from '../contract.js'

export const WebAppInputSchema = z.object({
  goal: z.string().min(1),
  acceptance: z.array(z.string().min(1)).min(1),
  testCommands: z.array(z.string().min(1)).min(1),
  qaScenarios: z.array(z.object({ id: z.string().min(1), steps: z.array(z.string().min(1)).min(1) }).strict()),
}).strict()
export type WebAppInput = z.infer<typeof WebAppInputSchema>

export const webAppPack: WorkPack<WebAppInput> = {
  manifest: {
    id: 'web-app', version: '1.0.0', title: '웹앱 개발', domain: 'software',
    description: '기존 Git 작업공간 기반 개발 흐름을 코드·테스트·브라우저·독립 검수 기준으로 표현한다.',
  },
  inputSchema: WebAppInputSchema,
  exampleInput: {
    goal: '할 일 웹앱', acceptance: ['할 일을 추가할 수 있음'], testCommands: ['npm test'],
    qaScenarios: [{ id: 'todo-add', steps: ['페이지 열기', '할 일 추가', '목록 확인'] }],
  },
  roles: [
    { key: 'planner', name: '계획 담당', goal: '요구사항을 파일 소유권과 의존성이 있는 계획으로 만든다.', backstory: '충돌 없는 작업 DAG를 설계하는 개발 PM이다.', tools: [] },
    { key: 'developer', name: '개발 담당', goal: '격리된 Git 작업공간에서 구현하고 자동 검사를 통과시킨다.', backstory: '작은 변경과 재현 가능한 테스트를 선호하는 엔지니어다.', tools: ['workspace'] },
    { key: 'qa', name: '브라우저 QA 담당', goal: '사용자 시나리오를 실행하고 최신 화면 근거를 남긴다.', backstory: '관찰한 동작만 증거로 기록하는 QA 담당자다.', tools: ['browser'] },
    { key: 'reviewer', name: '독립 검수 담당', goal: '코드·테스트·QA 근거가 수용 기준을 충족하는지 판정한다.', backstory: '구현과 분리된 읽기 전용 검수자다.', tools: [] },
  ],
  createBlueprint: (input) => ({
    title: input.goal,
    tasks: [
      {
        key: 'specify', title: '요구사항과 작업 계획 확정', deps: [], role: 'planner',
        instructions: '수용 기준, 파일 소유권, 태스크 의존성, 검수 시나리오를 확정한다.',
        acceptance: input.acceptance, outputs: [{ kind: 'implementation-plan', description: '승인된 개발 계획', mediaTypes: ['application/json', 'text/markdown'], required: true }],
      },
      {
        key: 'implement', title: '기능 구현', deps: ['specify'], role: 'developer',
        instructions: '격리된 작업공간에서 최소 변경으로 구현하고 변경 파일을 기록한다.',
        acceptance: input.acceptance, outputs: [{ kind: 'source-change', description: '검토 가능한 소스 변경', mediaTypes: ['text/x-diff', 'application/json'], required: true }],
      },
      {
        key: 'run-tests', title: '자동 검사', deps: ['implement'], role: 'developer',
        instructions: `다음 명령을 모두 실행하고 종료 코드를 기록한다: ${input.testCommands.join(', ')}`,
        acceptance: ['모든 테스트 명령 종료 코드가 0임'], outputs: [{ kind: 'test-report', description: '명령별 종료 코드와 출력 요약', mediaTypes: ['application/json'], required: true }],
      },
      ...(input.qaScenarios.length ? [{
        key: 'browser-qa', title: '브라우저 시나리오 검증', deps: ['implement'], role: 'qa',
        instructions: '각 사용자 시나리오를 실행하고 시나리오 id가 연결된 최신 캡처를 남긴다.',
        acceptance: input.qaScenarios.map((scenario) => `${scenario.id} 완료`), outputs: [],
      }] : []),
      {
        key: 'final-review', title: '최종 독립 검수', deps: ['run-tests', ...(input.qaScenarios.length ? ['browser-qa'] : [])], role: 'reviewer',
        instructions: '수용 기준, 소스 변경, 자동 검사, 브라우저 근거를 읽기 전용으로 검토한다.',
        acceptance: ['최종 검수 승인'], outputs: [],
      },
    ],
  }),
  review: reviewWebApp,
}

function reviewWebApp(context: PackReviewContext<WebAppInput>): PackReviewFinding[] {
  const findings: PackReviewFinding[] = []
  if (!context.artifacts.some((artifact) => artifact.kind === 'source-change')) {
    findings.push(blocker('missing-source-change', '소스 변경 산출물이 없음'))
  }
  const testReport = context.artifacts.find((artifact) => artifact.kind === 'test-report')
  if (!testReport) findings.push(blocker('missing-test-report', '자동 검사 보고서가 없음'))
  else {
    const exitCodes = Array.isArray(testReport.metadata.exitCodes)
      ? testReport.metadata.exitCodes.filter((value): value is number => typeof value === 'number')
      : []
    if (exitCodes.length !== context.input.testCommands.length || exitCodes.some((code) => code !== 0)) {
      findings.push(blocker('test-command-failed', '자동 검사 명령이 누락됐거나 종료 코드가 0이 아님'))
    }
  }

  const coveredScenarios = new Set(context.evidence
    .filter((item) => item.kind === 'browser' && item.criterionId === 'browser-scenario')
    .map((item) => item.metadata.scenarioId)
    .filter((value): value is string => typeof value === 'string'))
  const missingScenarios = context.input.qaScenarios.map((scenario) => scenario.id).filter((id) => !coveredScenarios.has(id))
  if (missingScenarios.length) findings.push(blocker('missing-browser-evidence', `브라우저 근거 누락: ${missingScenarios.join(', ')}`))

  const review = context.evidence.find((item) => item.kind === 'review' && item.criterionId === 'final-review')
  if (review?.metadata.verdict !== 'approve') findings.push(blocker('review-not-approved', '최종 코드 검수가 승인되지 않음'))
  return findings
}

function blocker(code: string, message: string): PackReviewFinding {
  return { code, severity: 'blocker', message }
}
