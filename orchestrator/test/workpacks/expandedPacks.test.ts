import { describe, expect, it } from 'vitest'
import { instantiateWorkPackRun, validatePackRun, validateWorkPack, type WorkPack } from '../../src/workpacks/contract.js'
import { builtInWorkPacks, getBuiltInWorkPack } from '../../src/workpacks/builtins/index.js'
import { contentCampaignPack, type ContentCampaignInput } from '../../src/workpacks/builtins/contentCampaign.js'
import { ipBusinessPlanPack } from '../../src/workpacks/builtins/ipBusinessPlan.js'
import type { WorkGraph } from '../../src/workpacks/model.js'

const now = '2026-10-28T00:00:00.000Z'

describe('content and IP planning expansion', () => {
  it('내장 팩 id가 중복되지 않고 모든 계약이 유효하다', () => {
    const ids = builtInWorkPacks.map((pack) => pack.manifest.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(builtInWorkPacks.flatMap((pack) => validateWorkPack(pack))).toEqual([])
    expect(getBuiltInWorkPack('content-campaign')).toBe(contentCampaignPack)
    expect(getBuiltInWorkPack('missing')).toBeUndefined()
  })

  it('콘텐츠 팩은 요청 채널 전체와 권리·최종 승인을 요구한다', () => {
    const input: ContentCampaignInput = {
      brand: 'Sample', objective: '인지도 확대', audience: '20대 직장인', channels: ['blog', 'shorts'],
      campaignTheme: '업무 자동화', tone: '명료함', requiresSources: false,
    }
    const graph = emptyGraph(contentCampaignPack, 'content-project', 'content-run', input)
    graph.artifacts.push({
      id: 'content-package', runId: 'content-run', taskId: 'content-run.adapt-channels', kind: 'content-package',
      path: 'artifacts/content.json', mediaType: 'application/json', createdAt: now, metadata: { channels: ['blog'] },
    })
    const codes = validatePackRun(contentCampaignPack, graph, 'content-run').findings.map((finding) => finding.code)
    expect(codes).toEqual(expect.arrayContaining(['missing-channels', 'rights-not-approved', 'review-not-approved']))
  })

  it('콘텐츠 팩은 채널 패키지와 권리·최종 승인이 완전하면 통과한다', () => {
    const input: ContentCampaignInput = {
      brand: 'Sample', objective: '인지도 확대', audience: '20대 직장인', channels: ['blog', 'shorts'],
      campaignTheme: '업무 자동화', tone: '명료함', requiresSources: false,
    }
    const graph = emptyGraph(contentCampaignPack, 'content-project', 'content-run', input)
    graph.artifacts.push(
      artifact('content-brief', 'content-run', 'content-run.content-brief', 'content-brief', 'text/markdown'),
      artifact('master-copy', 'content-run', 'content-run.write-master', 'master-copy', 'text/markdown'),
      artifact('content-package', 'content-run', 'content-run.adapt-channels', 'content-package', 'application/json', { channels: input.channels }),
      artifact('rights-review-artifact', 'content-run', 'content-run.rights-review', 'rights-review', 'application/json'),
    )
    graph.evidence.push(
      approval('content-rights', 'content-run', 'content-run.rights-review', 'rights-review', 'rights'),
      approval('content-final', 'content-run', 'content-run.final-review', 'final-review', 'review'),
    )
    expect(validatePackRun(contentCampaignPack, graph, 'content-run')).toEqual({ ok: true, findings: [] })
  })

  it('IP 팩은 시장 근거뿐 아니라 권리·재무·최종 검토를 각각 요구한다', () => {
    const input = {
      concept: '캐릭터 기반 교육 IP', targetMarket: '한국 초등 교육', businessModel: '라이선스와 구독',
      planningHorizon: '3년', minSources: 3, requiredSections: ['요약', '시장', '권리', '재무', '로드맵'],
    }
    const graph = emptyGraph(ipBusinessPlanPack, 'ip-project', 'ip-run', input)
    const codes = validatePackRun(ipBusinessPlanPack, graph, 'ip-run').findings.map((finding) => finding.code)
    expect(codes).toEqual(expect.arrayContaining([
      'missing-business-plan', 'insufficient-sources', 'rights-not-approved', 'financial-not-approved', 'review-not-approved',
    ]))
  })

  it('IP 팩은 시장·권리·재무·최종 근거가 모두 완전하면 통과한다', () => {
    const input = {
      concept: '캐릭터 기반 교육 IP', targetMarket: '한국 초등 교육', businessModel: '라이선스와 구독',
      planningHorizon: '3년', minSources: 3, requiredSections: ['요약', '시장', '권리', '재무', '로드맵'],
    }
    const graph = emptyGraph(ipBusinessPlanPack, 'ip-project', 'ip-run', input)
    graph.artifacts.push(
      artifact('ip-thesis', 'ip-run', 'ip-run.business-thesis', 'business-thesis', 'text/markdown'),
      artifact('ip-market', 'ip-run', 'ip-run.market-research', 'market-evidence', 'text/markdown'),
      artifact('ip-rights', 'ip-run', 'ip-run.rights-strategy', 'rights-strategy', 'application/json'),
      artifact('ip-financial', 'ip-run', 'ip-run.financial-model', 'financial-model', 'application/json'),
      artifact('ip-plan', 'ip-run', 'ip-run.write-plan', 'business-plan', 'text/markdown', { sections: input.requiredSections }),
      artifact('ip-review', 'ip-run', 'ip-run.verify-plan', 'verification-report', 'application/json'),
    )
    for (let i = 1; i <= 3; i++) graph.evidence.push({
      id: `ip-source-${i}`, runId: 'ip-run', taskId: 'ip-run.market-research', artifactId: 'ip-market',
      criterionId: 'source-traceability', kind: 'source', uri: `https://example.com/source-${i}`,
      observedAt: now, metadata: { title: `자료 ${i}` },
    })
    graph.evidence.push(
      approval('ip-rights-review', 'ip-run', 'ip-run.rights-strategy', 'rights-review', 'rights'),
      approval('ip-financial-review', 'ip-run', 'ip-run.financial-model', 'financial-review', 'calculation'),
      approval('ip-final-review', 'ip-run', 'ip-run.verify-plan', 'final-review', 'review'),
    )
    expect(validatePackRun(ipBusinessPlanPack, graph, 'ip-run')).toEqual({ ok: true, findings: [] })
  })
})

function emptyGraph<I>(pack: WorkPack<I>, projectId: string, runId: string, input: I): WorkGraph {
  const slice = instantiateWorkPackRun(pack, { projectId, runId, input, createdAt: now })
  return {
    projects: [{ id: projectId, name: projectId, status: 'active', createdAt: now }],
    runs: [slice.run], tasks: slice.tasks, artifacts: [], evidence: [],
  }
}

function artifact(
  id: string,
  runId: string,
  taskId: string,
  kind: string,
  mediaType: string,
  metadata: Record<string, unknown> = {},
): WorkGraph['artifacts'][number] {
  return { id, runId, taskId, kind, path: `artifacts/${id}`, mediaType, createdAt: now, metadata }
}

function approval(
  id: string,
  runId: string,
  taskId: string,
  criterionId: string,
  kind: 'rights' | 'calculation' | 'review',
): WorkGraph['evidence'][number] {
  return { id, runId, taskId, criterionId, kind, uri: `events/${id}`, observedAt: now, metadata: { verdict: 'approve' } }
}
