import { z } from 'zod'
import type { PackReviewContext, PackReviewFinding, WorkPack } from '../contract.js'

export const IpBusinessPlanInputSchema = z.object({
  concept: z.string().min(1),
  targetMarket: z.string().min(1),
  businessModel: z.string().min(1),
  planningHorizon: z.string().min(1),
  minSources: z.number().int().min(2).max(20),
  requiredSections: z.array(z.string().min(1)).min(1),
}).strict()
export type IpBusinessPlanInput = z.infer<typeof IpBusinessPlanInputSchema>

export const ipBusinessPlanPack: WorkPack<IpBusinessPlanInput> = {
  manifest: {
    id: 'ip-business-plan', version: '1.0.0', title: 'IP 사업 기획', domain: 'business-planning',
    description: 'IP 콘셉트의 시장성·권리·수익모델·재무 가정을 분리 검증해 사업계획서를 만든다.',
  },
  inputSchema: IpBusinessPlanInputSchema,
  exampleInput: {
    concept: '캐릭터 기반 교육 IP', targetMarket: '한국 초등 교육', businessModel: '라이선스와 구독',
    planningHorizon: '3년', minSources: 3, requiredSections: ['요약', '시장', '권리', '재무', '로드맵'],
  },
  roles: [
    { key: 'strategist', name: 'IP 전략 기획', goal: 'IP의 핵심 가치·타깃·확장 범위와 사업 가설을 명확히 한다.', backstory: '창작 가치와 사업 실행 가능성을 함께 보는 전략가다.', tools: [] },
    { key: 'researcher', name: '시장 조사', goal: '시장 규모·경쟁 IP·고객 수요를 출처와 기준 시점으로 검증한다.', backstory: '가정과 확인된 시장 사실을 구분하는 조사 담당자다.', tools: ['knowledge_search', 'web_fetch'] },
    { key: 'rights_reviewer', name: '권리 전략 검토', goal: '소유권·상표·저작권·라이선스·지역별 권리 위험을 식별한다.', backstory: '법률 자문이 필요한 쟁점을 숨기지 않고 표시하는 권리 검토자다.', tools: [] },
    { key: 'financial_analyst', name: '재무 분석', goal: '수익·비용·투자·손익분기 가정을 계산 가능하게 만든다.', backstory: '낙관·기준·비관 시나리오를 분리하는 재무 분석가다.', tools: ['workspace'] },
    { key: 'writer', name: '사업계획 작성', goal: '검증된 전략·시장·권리·재무 자료를 의사결정 문서로 통합한다.', backstory: '근거와 가정을 명시하는 사업 문서 작성자다.', tools: [] },
    { key: 'verifier', name: '독립 사업 검수', goal: '시장 근거, 권리 위험, 재무 산식, 실행 로드맵의 누락을 판정한다.', backstory: '작성 팀과 독립적으로 투자·운영 관점의 허점을 찾는 검수자다.', tools: [] },
  ],
  createBlueprint: (input) => ({
    title: `${input.concept} 사업 기획`,
    tasks: [
      {
        key: 'business-thesis', title: '사업 가설 정의', deps: [], role: 'strategist',
        instructions: 'IP 가치, 타깃 고객, 문제, 차별점, 수익모델, 검증할 핵심 가정을 정의한다.',
        acceptance: ['핵심 가정과 검증 기준이 명시됨'], outputs: [{ kind: 'business-thesis', description: '검증 가능한 사업 가설', mediaTypes: ['text/markdown'], required: true }],
      },
      {
        key: 'market-research', title: '시장·경쟁 조사', deps: ['business-thesis'], role: 'researcher',
        instructions: `${input.targetMarket}의 수요, 규모, 경쟁 IP, 유통 구조를 출처·시점과 함께 조사한다.`,
        acceptance: [`고유 출처 ${input.minSources}개 이상`, '시장 수치의 단위·시점·범위 명시'], outputs: [{ kind: 'market-evidence', description: '시장·경쟁 근거', mediaTypes: ['text/markdown', 'application/json'], required: true }],
      },
      {
        key: 'rights-strategy', title: '권리·라이선스 전략', deps: ['business-thesis'], role: 'rights_reviewer',
        instructions: '권리 소유, 등록, 라이선스 범위, 2차 저작물, 지역·채널 제한과 법률 자문 필요 항목을 정리한다.',
        acceptance: ['핵심 권리 위험과 대응 책임자가 있음'], outputs: [{ kind: 'rights-strategy', description: '권리 구조와 위험 검토', mediaTypes: ['application/json', 'text/markdown'], required: true }],
      },
      {
        key: 'financial-model', title: '재무 모델', deps: ['business-thesis', 'market-research'], role: 'financial_analyst',
        instructions: `${input.planningHorizon} 동안 ${input.businessModel}의 매출·비용·투자·손익분기 산식을 시나리오별로 작성한다.`,
        acceptance: ['모든 핵심 수치에 산식과 가정이 있음', '기준·낙관·비관 시나리오가 있음'], outputs: [{ kind: 'financial-model', description: '가정과 산식이 있는 재무 모델', mediaTypes: ['application/json', 'text/csv'], required: true }],
      },
      {
        key: 'write-plan', title: '사업계획서 작성', deps: ['market-research', 'rights-strategy', 'financial-model'], role: 'writer',
        instructions: '시장·권리·재무의 확인된 사실과 가정을 분리해 단계별 실행 로드맵이 있는 사업계획서를 작성한다.',
        acceptance: input.requiredSections.map((section) => `${section} 섹션 포함`), outputs: [{ kind: 'business-plan', description: '의사결정용 IP 사업계획서', mediaTypes: ['text/markdown'], required: true }],
      },
      {
        key: 'verify-plan', title: '독립 사업 검수', deps: ['write-plan'], role: 'verifier',
        instructions: '시장 근거, 권리 승인, 재무 산식, 실행 로드맵, 미해결 가정을 독립 검수한다.',
        acceptance: ['권리·재무·최종 검수 승인'], outputs: [{ kind: 'verification-report', description: '독립 사업 검수 결과', mediaTypes: ['application/json'], required: true }],
      },
    ],
  }),
  review: reviewIpBusinessPlan,
}

function reviewIpBusinessPlan(context: PackReviewContext<IpBusinessPlanInput>): PackReviewFinding[] {
  const findings: PackReviewFinding[] = []
  const plan = context.artifacts.find((artifact) => artifact.kind === 'business-plan')
  if (!plan) findings.push(blocker('missing-business-plan', 'IP 사업계획서가 없음'))
  else {
    const sections = new Set(Array.isArray(plan.metadata.sections)
      ? plan.metadata.sections.filter((item): item is string => typeof item === 'string')
      : [])
    const missing = context.input.requiredSections.filter((section) => !sections.has(section))
    if (missing.length) findings.push(blocker('missing-plan-sections', `사업계획서 섹션 누락: ${missing.join(', ')}`))
  }
  if (!context.artifacts.some((artifact) => artifact.kind === 'financial-model')) {
    findings.push(blocker('missing-financial-model', '재무 모델이 없음'))
  }
  if (countSources(context) < context.input.minSources) {
    findings.push(blocker('insufficient-sources', `시장 근거가 최소 ${context.input.minSources}개보다 적음`))
  }
  if (!approved(context, 'rights-review', 'rights')) findings.push(blocker('rights-not-approved', '권리 전략 검토가 승인되지 않음'))
  if (!approved(context, 'financial-review', 'calculation')) findings.push(blocker('financial-not-approved', '재무 산식 검토가 승인되지 않음'))
  if (!approved(context, 'final-review', 'review')) findings.push(blocker('review-not-approved', '최종 사업 검수가 승인되지 않음'))
  return findings
}

function countSources(context: PackReviewContext<IpBusinessPlanInput>): number {
  const urls = new Set<string>()
  for (const item of context.evidence) {
    if (item.kind !== 'source') continue
    try {
      const url = new URL(item.uri)
      if (url.protocol === 'http:' || url.protocol === 'https:') urls.add(url.href)
    } catch { /* 잘못된 URL은 제외한다. */ }
  }
  return urls.size
}

function approved(context: PackReviewContext<IpBusinessPlanInput>, criterionId: string, kind: 'rights' | 'calculation' | 'review'): boolean {
  return context.evidence.some((item) => item.kind === kind && item.criterionId === criterionId && item.metadata.verdict === 'approve')
}

function blocker(code: string, message: string): PackReviewFinding {
  return { code, severity: 'blocker', message }
}
