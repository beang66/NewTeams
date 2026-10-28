import { z } from 'zod'
import type { PackReviewContext, PackReviewFinding, WorkPack } from '../contract.js'

const ChannelSchema = z.enum(['blog', 'threads', 'instagram', 'shorts'])
export const ContentCampaignInputSchema = z.object({
  brand: z.string().min(1),
  objective: z.string().min(1),
  audience: z.string().min(1),
  channels: z.array(ChannelSchema).min(1),
  campaignTheme: z.string().min(1),
  tone: z.string().min(1),
  requiresSources: z.boolean(),
}).strict()
export type ContentCampaignInput = z.infer<typeof ContentCampaignInputSchema>

export const contentCampaignPack: WorkPack<ContentCampaignInput> = {
  manifest: {
    id: 'content-campaign', version: '1.0.0', title: '멀티채널 콘텐츠 캠페인', domain: 'content',
    description: '하나의 검증된 메시지를 블로그·스레드·인스타그램·쇼츠 형식으로 변환하고 권리를 검수한다.',
  },
  inputSchema: ContentCampaignInputSchema,
  exampleInput: {
    brand: 'Sample', objective: '인지도 확대', audience: '20대 직장인', channels: ['blog', 'shorts'],
    campaignTheme: '업무 자동화', tone: '명료함', requiresSources: true,
  },
  roles: [
    { key: 'planner', name: '콘텐츠 기획', goal: '목표·타깃·핵심 메시지와 채널별 성공 기준을 정한다.', backstory: '캠페인 메시지의 일관성과 실행 범위를 관리하는 기획자다.', tools: [] },
    { key: 'researcher', name: '자료 조사', goal: '콘텐츠의 사실 주장과 트렌드 근거를 출처와 함께 정리한다.', backstory: '사실과 의견을 구분하는 조사 담당자다.', tools: ['knowledge_search', 'web_fetch'] },
    { key: 'writer', name: '원문 작성', goal: '모든 채널의 기준이 되는 정확한 원문을 작성한다.', backstory: '브랜드 언어와 독자 이해를 함께 지키는 에디터다.', tools: [] },
    { key: 'editor', name: '채널 편집', goal: '핵심 의미를 유지하며 채널 문법과 길이에 맞게 변환한다.', backstory: '플랫폼별 형식과 훅을 이해하는 멀티채널 편집자다.', tools: [] },
    { key: 'verifier', name: '권리·브랜드 검수', goal: '출처, 저작권, 초상권, 금지 표현, 채널 누락을 독립 검토한다.', backstory: '게시 전 위험과 누락을 막는 검수자다.', tools: [] },
  ],
  createBlueprint: (input) => ({
    title: `${input.brand} — ${input.campaignTheme}`,
    tasks: [
      {
        key: 'content-brief', title: '콘텐츠 브리프', deps: [], role: 'planner',
        instructions: '목표, 타깃, 핵심 메시지, 톤, 채널, 금지 요소, 성과 기준을 확정한다.',
        acceptance: ['목표·타깃·메시지·채널이 명시됨'], outputs: [{ kind: 'content-brief', description: '승인 가능한 캠페인 브리프', mediaTypes: ['text/markdown'], required: true }],
      },
      {
        key: 'fact-research', title: '사실·트렌드 조사', deps: ['content-brief'], role: 'researcher',
        instructions: '사용할 사실 주장과 트렌드를 출처·확인 시점과 함께 정리한다.',
        acceptance: [input.requiresSources ? '사실 주장에 추적 가능한 출처가 있음' : '외부 사실 주장이 없거나 출처 필요 여부가 표시됨'],
        outputs: [{ kind: 'source-notes', description: '콘텐츠 사실 근거', mediaTypes: ['text/markdown', 'application/json'], required: input.requiresSources }],
      },
      {
        key: 'write-master', title: '마스터 원문 작성', deps: ['content-brief', 'fact-research'], role: 'writer',
        instructions: `${input.audience}에게 ${input.objective}를 달성할 핵심 원문을 ${input.tone} 톤으로 작성한다.`,
        acceptance: ['브리프의 핵심 메시지와 사실 근거를 유지함'], outputs: [{ kind: 'master-copy', description: '채널 변환 기준 원문', mediaTypes: ['text/markdown'], required: true }],
      },
      {
        key: 'adapt-channels', title: '채널별 변환', deps: ['write-master'], role: 'editor',
        instructions: `다음 채널별 형식과 길이에 맞게 변환한다: ${input.channels.join(', ')}`,
        acceptance: input.channels.map((channel) => `${channel} 버전 포함`), outputs: [{ kind: 'content-package', description: '채널별 게시 초안 패키지', mediaTypes: ['application/json', 'text/markdown'], required: true }],
      },
      {
        key: 'rights-review', title: '권리·브랜드 검수', deps: ['adapt-channels'], role: 'verifier',
        instructions: '저작권·초상권·상표·출처·브랜드 금지 표현과 채널 누락을 검수한다.',
        acceptance: ['권리 검수 승인'], outputs: [{ kind: 'rights-review', description: '권리·브랜드 체크리스트와 판정', mediaTypes: ['application/json'], required: true }],
      },
      {
        key: 'final-review', title: '게시 패키지 최종 검수', deps: ['rights-review'], role: 'verifier',
        instructions: '목표·타깃·메시지·채널 완결성과 권리 승인 결과를 확인한다.',
        acceptance: ['최종 콘텐츠 검수 승인'], outputs: [],
      },
    ],
  }),
  review: reviewContentCampaign,
}

function reviewContentCampaign(context: PackReviewContext<ContentCampaignInput>): PackReviewFinding[] {
  const findings: PackReviewFinding[] = []
  const content = context.artifacts.find((artifact) => artifact.kind === 'content-package')
  if (!content) findings.push(blocker('missing-content-package', '채널별 콘텐츠 패키지가 없음'))
  else {
    const channels = new Set(Array.isArray(content.metadata.channels)
      ? content.metadata.channels.filter((item): item is string => typeof item === 'string')
      : [])
    const missing = context.input.channels.filter((channel) => !channels.has(channel))
    if (missing.length) findings.push(blocker('missing-channels', `채널 콘텐츠 누락: ${missing.join(', ')}`))
  }
  if (context.input.requiresSources && countValidSources(context) < 2) {
    findings.push(blocker('insufficient-sources', '출처가 필요한 콘텐츠는 유효한 고유 출처가 2개 이상이어야 함'))
  }
  if (!isApproved(context, 'rights-review', 'rights')) findings.push(blocker('rights-not-approved', '권리·브랜드 검수가 승인되지 않음'))
  if (!isApproved(context, 'final-review', 'review')) findings.push(blocker('review-not-approved', '최종 콘텐츠 검수가 승인되지 않음'))
  return findings
}

function countValidSources(context: PackReviewContext<ContentCampaignInput>): number {
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

function isApproved(context: PackReviewContext<ContentCampaignInput>, criterionId: string, kind: 'rights' | 'review'): boolean {
  return context.evidence.some((item) => item.kind === kind && item.criterionId === criterionId && item.metadata.verdict === 'approve')
}

function blocker(code: string, message: string): PackReviewFinding {
  return { code, severity: 'blocker', message }
}
