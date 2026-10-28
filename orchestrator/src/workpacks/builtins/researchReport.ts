import { z } from 'zod'
import type { PackReviewContext, PackReviewFinding, WorkPack, WorkRole } from '../contract.js'

export const ResearchReportInputSchema = z.object({
  topic: z.string().min(1),
  objective: z.string().min(1),
  audience: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1),
  minSources: z.number().int().min(2).max(20),
  requiredSections: z.array(z.string().min(1)).min(1),
}).strict()
export type ResearchReportInput = z.infer<typeof ResearchReportInputSchema>

const roles: WorkRole[] = [
  {
    key: 'planner', name: '계획 담당',
    goal: '목표를 실행 가능한 조사 단계로 나누고 각 단계의 완료 기준을 정한다.',
    backstory: '여러 팀의 프로젝트를 이끈 PM으로서 단계는 적고 명확하게 구성한다.', tools: [],
  },
  {
    key: 'researcher', name: '조사 담당',
    goal: '필요한 사실과 근거를 찾아 출처와 확인 시점을 함께 정리한다.',
    backstory: '확인된 사실과 추정을 구분하고 근거가 없으면 없다고 말하는 리서처다.',
    tools: ['knowledge_search', 'web_fetch'],
  },
  {
    key: 'browser', name: '웹 탐색 담당',
    goal: 'API로 얻을 수 없는 자료를 웹에서 확인하고 방문 주소를 남긴다.',
    backstory: '페이지에서 직접 확인한 내용만 보고하는 웹 탐색 전문가다.', tools: ['browser'],
  },
  {
    key: 'writer', name: '작성 담당',
    goal: '조사 결과를 독자가 판단하기 쉬운 보고서로 종합한다.',
    backstory: '근거가 있는 내용만 쓰고 출처를 밝히는 테크니컬 라이터다.', tools: [],
  },
  {
    key: 'verifier', name: '검증 담당',
    goal: '보고서가 목표를 충족하고 모든 핵심 주장이 근거와 일치하는지 독립 검토한다.',
    backstory: '작성자와 독립적으로 판단하고 고칠 수 있는 지적을 남기는 엄격한 리뷰어다.', tools: [],
  },
]

export const researchReportPack: WorkPack<ResearchReportInput> = {
  manifest: {
    id: 'research-report', version: '1.0.0', title: '리서치 & 리포트 팀', domain: 'research',
    description: '계획 → 출처 조사·웹 탐색 → 작성 → 독립 검증으로 근거 있는 보고서를 만든다.',
  },
  inputSchema: ResearchReportInputSchema,
  exampleInput: {
    topic: '국내 AI 에이전트 SaaS', objective: '시장 진입 여부 판단', audience: '사업 책임자',
    questions: ['주요 경쟁사와 최근 변화는 무엇인가?'], minSources: 3,
    requiredSections: ['요약', '시장 동향', '경쟁 구도', '권고안', '출처'],
  },
  roles,
  createBlueprint: (input) => ({
    title: `${input.topic} 리서치 리포트`,
    tasks: [
      {
        key: 'research-plan', title: '조사 계획 수립', deps: [], role: 'planner',
        instructions: `목표(${input.objective})와 질문을 조사 항목, 출처 유형, 완료 기준으로 나눈다.`,
        acceptance: ['모든 질문에 조사 경로와 완료 기준이 있음'],
        outputs: [{ kind: 'research-plan', description: '질문·출처·완료 기준이 있는 조사 계획', mediaTypes: ['text/markdown'], required: true }],
      },
      {
        key: 'collect-sources', title: '근거 자료 조사', deps: ['research-plan'], role: 'researcher',
        instructions: '사실과 추정을 구분하고 각 자료의 제목, URL, 확인 시점, 관련 질문을 기록한다.',
        acceptance: [`서로 다른 유효 출처가 ${input.minSources}개 이상임`, '핵심 수치에 단위와 기준 시점이 있음'],
        outputs: [{ kind: 'source-notes', description: '출처별 근거 노트', mediaTypes: ['text/markdown', 'application/json'], required: true }],
      },
      {
        key: 'browse-gaps', title: '웹 자료 공백 보완', deps: ['research-plan'], role: 'browser',
        instructions: '일반 검색으로 확인하기 어려운 공식 페이지를 직접 열어 공백을 보완하고 방문 주소를 남긴다.',
        acceptance: ['직접 확인한 내용과 방문 주소가 대응됨'], outputs: [],
      },
      {
        key: 'write-report', title: '보고서 작성', deps: ['collect-sources', 'browse-gaps'], role: 'writer',
        instructions: `${input.audience}가 ${input.objective}를 판단할 수 있도록 결론 우선으로 쓰고 주장마다 출처를 연결한다.`,
        acceptance: [...input.requiredSections.map((section) => `${section} 섹션 포함`), '핵심 주장에 출처가 연결됨'],
        outputs: [{ kind: 'final-report', description: '최종 의사결정용 보고서', mediaTypes: ['text/markdown'], required: true }],
      },
      {
        key: 'verify-report', title: '독립 검증', deps: ['write-report'], role: 'verifier',
        instructions: '작성 과정과 독립적으로 질문 충족, 출처 일치, 과장, 누락, 미해결 주장을 검토한다.',
        acceptance: ['검증 판정이 승인임', '미해결 핵심 주장이 0개임'],
        outputs: [{ kind: 'verification-report', description: '독립 검증 판정과 지적 목록', mediaTypes: ['application/json', 'text/markdown'], required: true }],
      },
    ],
  }),
  review: reviewResearchReport,
}

function reviewResearchReport(context: PackReviewContext<ResearchReportInput>): PackReviewFinding[] {
  const findings: PackReviewFinding[] = []
  const sourceNotes = context.artifacts.find((artifact) => artifact.kind === 'source-notes')
  const report = context.artifacts.find((artifact) => artifact.kind === 'final-report')
  const verification = context.artifacts.find((artifact) => artifact.kind === 'verification-report')

  if (!sourceNotes) findings.push(blocker('missing-source-notes', '출처 노트 산출물이 없음'))
  if (!report) findings.push(blocker('missing-final-report', '최종 보고서 산출물이 없음'))
  if (!verification) findings.push(blocker('missing-verification-report', '독립 검증 산출물이 없음'))

  const sources = validUniqueSources(context)
  if (sources.size < context.input.minSources) {
    findings.push(blocker('insufficient-sources', `유효한 고유 출처 ${sources.size}개: 최소 ${context.input.minSources}개 필요`))
  }
  if (report) findings.push(...reviewReportMetadata(report.metadata, context.input))
  findings.push(...reviewIndependentVerdict(context, verification?.id))
  return findings
}

function validUniqueSources(context: PackReviewContext<ResearchReportInput>): Set<string> {
  const urls = new Set<string>()
  for (const evidence of context.evidence) {
    if (evidence.kind !== 'source' || evidence.criterionId !== 'source-traceability') continue
    if (typeof evidence.metadata.title !== 'string' || evidence.metadata.title.trim() === '') continue
    try {
      const url = new URL(evidence.uri)
      if (url.protocol === 'http:' || url.protocol === 'https:') urls.add(url.href)
    } catch {
      // 잘못된 URL은 출처 수에 포함하지 않는다.
    }
  }
  return urls
}

function reviewReportMetadata(metadata: Record<string, unknown>, input: ResearchReportInput): PackReviewFinding[] {
  const sections = Array.isArray(metadata.sections) ? metadata.sections.filter((item): item is string => typeof item === 'string') : []
  const missing = input.requiredSections.filter((section) => !sections.includes(section))
  const findings: PackReviewFinding[] = []
  if (missing.length) findings.push(blocker('missing-report-sections', `보고서 필수 섹션 누락: ${missing.join(', ')}`))
  const citationCount = typeof metadata.citationCount === 'number' ? metadata.citationCount : 0
  if (citationCount < input.minSources) findings.push(blocker('insufficient-citations', `보고서 인용 ${citationCount}개: 최소 ${input.minSources}개 필요`))
  return findings
}

function reviewIndependentVerdict(context: PackReviewContext<ResearchReportInput>, verificationId?: string): PackReviewFinding[] {
  const review = context.evidence.find((item) => item.kind === 'review'
    && item.criterionId === 'final-review'
    && (!verificationId || item.artifactId === verificationId))
  if (!review) return [blocker('review-not-approved', '독립 검증 승인 근거가 없음')]

  const findings: PackReviewFinding[] = []
  if (review.metadata.verdict !== 'approve') findings.push(blocker('review-not-approved', '독립 검증이 승인되지 않음'))
  if (review.metadata.unresolvedClaims !== 0) findings.push(blocker('unresolved-claims', '미해결 주장이 남아 있음'))
  return findings
}

function blocker(code: string, message: string): PackReviewFinding {
  return { code, severity: 'blocker', message }
}
