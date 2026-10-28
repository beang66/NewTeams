import { describe, expect, it } from 'vitest'
import { instantiateWorkPackRun, validatePackRun, validateWorkPack } from '../../src/workpacks/contract.js'
import { researchReportPack } from '../../src/workpacks/builtins/researchReport.js'
import type { ArtifactRecord, EvidenceRecord, WorkGraph } from '../../src/workpacks/model.js'

const input = {
  topic: '국내 AI 에이전트 SaaS',
  objective: '시장 진입 여부 판단',
  audience: '사업 책임자',
  questions: ['시장 성장 요인은 무엇인가?', '주요 경쟁사는 누구인가?'],
  minSources: 3,
  requiredSections: ['요약', '시장 동향', '경쟁 구도', '권고안', '출처'],
}

function baseGraph(): WorkGraph {
  const slice = instantiateWorkPackRun(researchReportPack, {
    projectId: 'project-1', runId: 'run-report', input, createdAt: '2026-10-28T00:00:00.000Z',
  })
  return {
    projects: [{ id: 'project-1', name: '시장 조사', status: 'active', createdAt: '2026-10-28T00:00:00.000Z' }],
    runs: [slice.run], tasks: slice.tasks, artifacts: [], evidence: [],
  }
}

function completedGraph(): WorkGraph {
  const graph = baseGraph()
  const artifacts: ArtifactRecord[] = [
    artifact('artifact-plan', 'run-report.research-plan', 'research-plan', 'artifacts/plan.md', {}),
    artifact('artifact-sources', 'run-report.collect-sources', 'source-notes', 'artifacts/sources.md', {}),
    artifact('artifact-report', 'run-report.write-report', 'final-report', 'artifacts/report.md', {
      sections: input.requiredSections,
      citationCount: 3,
    }),
    artifact('artifact-review', 'run-report.verify-report', 'verification-report', 'artifacts/review.json', {}),
  ]
  const evidence: EvidenceRecord[] = [
    source('source-1', 'https://example.com/one', '자료 1'),
    source('source-2', 'https://example.org/two', '자료 2'),
    source('source-3', 'https://example.net/three', '자료 3'),
    {
      id: 'review-1', runId: 'run-report', taskId: 'run-report.verify-report', artifactId: 'artifact-review',
      criterionId: 'final-review', kind: 'review', uri: 'events/msg-review', observedAt: '2026-10-28T01:00:00.000Z',
      metadata: { verdict: 'approve', unresolvedClaims: 0 },
    },
  ]
  return { ...graph, artifacts, evidence }
}

function artifact(id: string, taskId: string, kind: string, path: string, metadata: Record<string, unknown>): ArtifactRecord {
  return { id, runId: 'run-report', taskId, kind, path, mediaType: path.endsWith('.json') ? 'application/json' : 'text/markdown', createdAt: '2026-10-28T00:30:00.000Z', metadata }
}

function source(id: string, uri: string, title: string): EvidenceRecord {
  return {
    id, runId: 'run-report', taskId: 'run-report.collect-sources', artifactId: 'artifact-sources',
    criterionId: 'source-traceability', kind: 'source', uri, observedAt: '2026-10-28T00:20:00.000Z', metadata: { title },
  }
}

describe('research report work pack', () => {
  it('이전 팀의 계획·조사·웹 탐색·작성·독립 검증 역할을 DAG로 옮긴다', () => {
    expect(validateWorkPack(researchReportPack)).toEqual([])
    expect(researchReportPack.roles.map((role) => role.key)).toEqual(['planner', 'researcher', 'browser', 'writer', 'verifier'])
    const slice = instantiateWorkPackRun(researchReportPack, {
      projectId: 'project-1', runId: 'run-report', input, createdAt: '2026-10-28T00:00:00.000Z',
    })
    expect(slice.tasks.map((task) => [task.key, task.deps])).toEqual([
      ['research-plan', []],
      ['collect-sources', ['run-report.research-plan']],
      ['browse-gaps', ['run-report.research-plan']],
      ['write-report', ['run-report.collect-sources', 'run-report.browse-gaps']],
      ['verify-report', ['run-report.write-report']],
    ])
  })

  it('최종 보고서·출처·섹션·독립 검증이 모두 있어야 승인한다', () => {
    expect(validatePackRun(researchReportPack, completedGraph(), 'run-report')).toEqual({ ok: true, findings: [] })
  })

  it('출처 중복, 섹션 누락, 미해결 주장과 검증 반려를 구체적으로 보고한다', () => {
    const graph = completedGraph()
    graph.evidence[2]!.uri = graph.evidence[1]!.uri
    graph.artifacts.find((item) => item.kind === 'final-report')!.metadata = { sections: ['요약'], citationCount: 1 }
    graph.evidence.find((item) => item.kind === 'review')!.metadata = { verdict: 'reject', unresolvedClaims: 2 }

    const codes = validatePackRun(researchReportPack, graph, 'run-report').findings.map((finding) => finding.code)
    expect(codes).toEqual(expect.arrayContaining([
      'insufficient-sources', 'missing-report-sections', 'insufficient-citations', 'review-not-approved', 'unresolved-claims',
    ]))
  })
})
