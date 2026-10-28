import { describe, expect, it } from 'vitest'
import { instantiateWorkPackRun, validatePackRun } from '../../src/workpacks/contract.js'
import { researchReportPack } from '../../src/workpacks/builtins/researchReport.js'
import { webAppPack } from '../../src/workpacks/builtins/webApp.js'
import type { ArtifactRecord, EvidenceRecord, WorkGraph } from '../../src/workpacks/model.js'

const now = '2026-10-28T00:00:00.000Z'

describe('same core, domain-specific review', () => {
  it('웹앱은 출처 수 없이도 테스트·브라우저·코드 검수 근거로 승인한다', () => {
    const graph = webGraph([0])
    expect(validatePackRun(webAppPack, graph, 'run-web')).toEqual({ ok: true, findings: [] })
  })

  it('웹앱의 명령 실패는 리포트 출처 근거로 대체할 수 없다', () => {
    const graph = webGraph([0, 7])
    graph.evidence.push(source('web-source', 'run-web.run-tests', 'https://example.com/reference'))
    const codes = validatePackRun(webAppPack, graph, 'run-web').findings.map((finding) => finding.code)
    expect(codes).toContain('test-command-failed')
    expect(codes).not.toContain('insufficient-sources')
  })

  it('리포트는 테스트 성공·브라우저 캡처가 있어도 출처가 부족하면 반려한다', () => {
    const graph = reportGraph()
    graph.evidence.push({
      id: 'unrelated-test', runId: 'run-report', taskId: 'run-report.verify-report', criterionId: 'test-run',
      kind: 'test', uri: 'artifacts/test.json', observedAt: now, metadata: { exitCodes: [0] },
    })
    const codes = validatePackRun(researchReportPack, graph, 'run-report').findings.map((finding) => finding.code)
    expect(codes).toContain('insufficient-sources')
    expect(codes).not.toContain('test-command-failed')
  })
})

function webGraph(exitCodes: number[]): WorkGraph {
  const input = {
    goal: '할 일 웹앱', acceptance: ['할 일을 추가할 수 있음'], testCommands: ['npm test'],
    qaScenarios: [{ id: 'todo-add', steps: ['페이지 열기', '할 일 추가', '목록 확인'] }],
  }
  const slice = instantiateWorkPackRun(webAppPack, { projectId: 'project-web', runId: 'run-web', input, createdAt: now })
  const artifacts: ArtifactRecord[] = [
    artifact('implementation-plan', 'run-web.specify', 'implementation-plan', 'artifacts/plan.json', {}),
    artifact('source-change', 'run-web.implement', 'source-change', 'artifacts/change.patch', {}),
    artifact('test-report', 'run-web.run-tests', 'test-report', 'artifacts/tests.json', { exitCodes }),
  ]
  const evidence: EvidenceRecord[] = [
    {
      id: 'browser-todo-add', runId: 'run-web', taskId: 'run-web.browser-qa', criterionId: 'browser-scenario',
      kind: 'browser', uri: 'evidence/todo-add.png', observedAt: now, metadata: { scenarioId: 'todo-add' },
    },
    {
      id: 'web-final-review', runId: 'run-web', taskId: 'run-web.final-review', criterionId: 'final-review',
      kind: 'review', uri: 'events/msg-web-review', observedAt: now, metadata: { verdict: 'approve' },
    },
  ]
  return {
    projects: [{ id: 'project-web', name: '웹앱', status: 'active', createdAt: now }],
    runs: [slice.run], tasks: slice.tasks, artifacts, evidence,
  }
}

function reportGraph(): WorkGraph {
  const input = {
    topic: 'AI 시장', objective: '진입 판단', audience: '대표', questions: ['경쟁사는?'], minSources: 3,
    requiredSections: ['요약', '출처'],
  }
  const slice = instantiateWorkPackRun(researchReportPack, { projectId: 'project-report', runId: 'run-report', input, createdAt: now })
  const artifacts: ArtifactRecord[] = [
    artifact('report-plan', 'run-report.research-plan', 'research-plan', 'artifacts/plan.md', {}),
    artifact('report-sources', 'run-report.collect-sources', 'source-notes', 'artifacts/sources.md', {}),
    artifact('report-final', 'run-report.write-report', 'final-report', 'artifacts/report.md', { sections: input.requiredSections, citationCount: 3 }),
    artifact('report-review', 'run-report.verify-report', 'verification-report', 'artifacts/review.json', {}),
  ].map((item) => ({ ...item, runId: 'run-report' }))
  const evidence: EvidenceRecord[] = [
    source('only-source', 'run-report.collect-sources', 'https://example.com/one', 'report-sources'),
    {
      id: 'report-final-review', runId: 'run-report', taskId: 'run-report.verify-report', artifactId: 'report-review',
      criterionId: 'final-review', kind: 'review', uri: 'events/msg-report-review', observedAt: now,
      metadata: { verdict: 'approve', unresolvedClaims: 0 },
    },
  ]
  return {
    projects: [{ id: 'project-report', name: '리포트', status: 'active', createdAt: now }],
    runs: [slice.run], tasks: slice.tasks, artifacts, evidence,
  }
}

function artifact(id: string, taskId: string, kind: string, path: string, metadata: Record<string, unknown>): ArtifactRecord {
  const mediaType = path.endsWith('.md') ? 'text/markdown' : path.endsWith('.patch') ? 'text/x-diff' : 'application/json'
  return { id, runId: 'run-web', taskId, kind, path, mediaType, createdAt: now, metadata }
}

function source(id: string, taskId: string, uri: string, artifactId?: string): EvidenceRecord {
  return {
    id, runId: taskId.startsWith('run-report') ? 'run-report' : 'run-web', taskId, ...(artifactId ? { artifactId } : {}),
    criterionId: 'source-traceability', kind: 'source', uri, observedAt: now, metadata: { title: id },
  }
}
