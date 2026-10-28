import { describe, expect, it } from 'vitest'
import {
  validateWorkGraph,
  type WorkGraph,
} from '../../src/workpacks/model.js'

const graph = (): WorkGraph => ({
  projects: [{ id: 'project-1', name: '샘플 프로젝트', status: 'active', createdAt: '2026-10-28T00:00:00.000Z' }],
  runs: [{
    id: 'run-1', projectId: 'project-1', workPack: { id: 'web-app', version: '1.0.0' },
    status: 'running', input: { goal: '샘플 앱' }, createdAt: '2026-10-28T00:01:00.000Z',
  }],
  tasks: [
    { id: 'task-plan', runId: 'run-1', key: 'plan', title: '계획', deps: [], role: 'planner', status: 'completed' },
    { id: 'task-build', runId: 'run-1', key: 'build', title: '구현', deps: ['task-plan'], role: 'developer', status: 'running' },
  ],
  artifacts: [{
    id: 'artifact-plan', runId: 'run-1', taskId: 'task-plan', kind: 'plan', path: 'human/plan.md',
    mediaType: 'text/markdown', createdAt: '2026-10-28T00:02:00.000Z', metadata: {},
  }],
  evidence: [{
    id: 'evidence-plan-review', runId: 'run-1', taskId: 'task-plan', artifactId: 'artifact-plan',
    criterionId: 'plan-review', kind: 'review', uri: 'events/msg-0001', observedAt: '2026-10-28T00:03:00.000Z', metadata: { verdict: 'approve' },
  }],
})

describe('work graph relationship contract', () => {
  it('project → run → task → artifact/evidence 관계를 허용한다', () => {
    expect(validateWorkGraph(graph())).toEqual([])
  })

  it('누락·중복·교차 실행 참조를 한 번에 보고한다', () => {
    const invalid = graph()
    invalid.projects.push({ ...invalid.projects[0]! })
    invalid.runs[0]!.projectId = 'missing-project'
    invalid.tasks[1]!.deps = ['missing-task']
    invalid.artifacts[0]!.runId = 'other-run'
    invalid.evidence[0]!.artifactId = 'missing-artifact'

    const codes = validateWorkGraph(invalid).map((finding) => finding.code)
    expect(codes).toEqual(expect.arrayContaining([
      'duplicate-id', 'missing-project', 'missing-dependency', 'cross-run-artifact', 'missing-artifact',
    ]))
  })

  it('같은 실행 안의 태스크 의존 순환을 거부한다', () => {
    const invalid = graph()
    invalid.tasks[0]!.deps = ['task-build']
    expect(validateWorkGraph(invalid).map((finding) => finding.code)).toContain('dependency-cycle')
  })
})
