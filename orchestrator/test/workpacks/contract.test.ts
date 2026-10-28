import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  instantiateWorkPackRun,
  validatePackRun,
  validateWorkPack,
  type WorkPack,
} from '../../src/workpacks/contract.js'
import type { WorkGraph } from '../../src/workpacks/model.js'

const pack: WorkPack<{ goal: string }> = {
  manifest: { id: 'sample-pack', version: '1.0.0', title: '샘플 팩', domain: 'sample', description: '계약 테스트' },
  inputSchema: z.object({ goal: z.string().min(1) }).strict(),
  exampleInput: { goal: '샘플 목표' },
  roles: [
    { key: 'planner', name: '계획 담당', goal: '계획', backstory: 'PM', tools: [] },
    { key: 'writer', name: '작성 담당', goal: '작성', backstory: 'Writer', tools: [] },
  ],
  createBlueprint: () => ({
    title: '샘플 실행',
    tasks: [
      { key: 'plan', title: '계획', deps: [], role: 'planner', instructions: '계획한다.', acceptance: ['계획 승인'], outputs: [] },
      { key: 'write', title: '작성', deps: ['plan'], role: 'writer', instructions: '작성한다.', acceptance: ['초안 완성'], outputs: [] },
    ],
  }),
  review: ({ artifacts }) => artifacts.some((artifact) => artifact.kind === 'final')
    ? []
    : [{ code: 'missing-final', severity: 'blocker', message: '최종 산출물 없음' }],
}

describe('work pack contract', () => {
  it('팩 청사진을 같은 코어의 실행·태스크 관계로 인스턴스화한다', () => {
    expect(validateWorkPack(pack)).toEqual([])
    const slice = instantiateWorkPackRun(pack, {
      projectId: 'project-1', runId: 'run-1', input: { goal: '보고서' }, createdAt: '2026-10-28T00:00:00.000Z',
    })

    expect(slice.run.workPack).toEqual({ id: 'sample-pack', version: '1.0.0' })
    expect(slice.tasks.map((task) => [task.id, task.deps])).toEqual([
      ['run-1.plan', []],
      ['run-1.write', ['run-1.plan']],
    ])
  })

  it('팩별 검수는 공통 관계 검증 뒤 실행된다', () => {
    const slice = instantiateWorkPackRun(pack, {
      projectId: 'project-1', runId: 'run-1', input: { goal: '보고서' }, createdAt: '2026-10-28T00:00:00.000Z',
    })
    const graph: WorkGraph = {
      projects: [{ id: 'project-1', name: '프로젝트', status: 'active', createdAt: '2026-10-28T00:00:00.000Z' }],
      runs: [slice.run], tasks: slice.tasks, artifacts: [], evidence: [],
    }

    expect(validatePackRun(pack, graph, 'run-1')).toMatchObject({
      ok: false,
      findings: [{ code: 'missing-final' }],
    })
  })

  it('다른 프로젝트의 손상된 실행이 대상 실행 검수를 오염시키지 않는다', () => {
    const slice = instantiateWorkPackRun(pack, {
      projectId: 'project-1', runId: 'run-1', input: { goal: '보고서' }, createdAt: '2026-10-28T00:00:00.000Z',
    })
    const graph: WorkGraph = {
      projects: [{ id: 'project-1', name: '프로젝트', status: 'active', createdAt: '2026-10-28T00:00:00.000Z' }],
      runs: [
        slice.run,
        { ...slice.run, id: 'broken-run', projectId: 'missing-project' },
      ],
      tasks: slice.tasks,
      artifacts: [{
        id: 'final-artifact', runId: 'run-1', taskId: 'run-1.write', kind: 'final', path: 'artifacts/final.md',
        mediaType: 'text/markdown', createdAt: '2026-10-28T00:10:00.000Z', metadata: {},
      }],
      evidence: [],
    }

    expect(validatePackRun(pack, graph, 'run-1')).toEqual({ ok: true, findings: [] })
  })

  it('중복 태스크와 없는 역할·의존을 계약 오류로 모아 보고한다', () => {
    const invalid: WorkPack<{ goal: string }> = {
      ...pack,
      createBlueprint: () => ({ title: '잘못된 실행', tasks: [
        { key: 'same', title: '1', deps: ['missing'], role: 'ghost', instructions: 'x', acceptance: [], outputs: [] },
        { key: 'same', title: '2', deps: [], role: 'writer', instructions: 'y', acceptance: [], outputs: [] },
      ] }),
    }
    expect(validateWorkPack(invalid).map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'duplicate-task-key', 'missing-role', 'missing-dependency',
    ]))
  })
})
