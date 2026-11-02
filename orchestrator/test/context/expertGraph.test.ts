import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadGraph, splitFrontmatter, traverse } from '../../src/context/expertGraph.js'
import { buildPrompt, usePipelineNotes } from '../../src/context/contextBuilder.js'

function vault(): string {
  const root = mkdtempSync(join(tmpdir(), 'graph-'))
  const g = join(root, 'wiki', 'G')
  for (const d of ['작업', '지식', '과정', '도구', '기준', '_템플릿']) mkdirSync(join(g, d), { recursive: true })
  const w = (rel: string, fm: string, body: string) => writeFileSync(join(g, rel), `---\n${fm}\n---\n${body}`)
  w('작업/구현.md', 'type: 작업\napplies_to: [dev]\nknowledge: ["[[작은 변경]]"]\nprocess: "[[구현 과정]]"\ntools:\n  - "[[vitest]]"\ndone: "[[구현 완료 기준]]"\nrequires: ["[[기획]]"]', '구현 작업')
  w('작업/기획.md', 'type: 작업\napplies_to: [plan]\ndone: "[[기획 완료 기준]]"', '기획 작업')
  w('지식/작은 변경.md', 'type: 지식', '가장 작은 완전한 변경')
  w('과정/구현 과정.md', 'type: 과정', '1. 읽기 2. 고치기')
  w('도구/vitest.md', 'type: 도구', 'npx vitest run')
  w('기준/구현 완료 기준.md', 'type: 기준', '- [ ] 테스트 통과')
  w('기준/기획 완료 기준.md', 'type: 기준', '- [ ] 의존 순환 없음')
  w('_템플릿/작업.md', 'type: 작업\napplies_to: [dev]', '템플릿은 읽지 않는다')
  return root
}

describe('전문가 그래프', () => {
  it('작업에서 지식·과정·도구·기준, 선행 작업의 기준까지 순서대로 펼친다', () => {
    const root = vault()
    const docs = traverse(loadGraph(join(root, 'wiki', 'G'), root), 'dev')
    expect(docs.map((d) => d.path)).toEqual([
      'wiki/G/작업/구현.md', 'wiki/G/지식/작은 변경.md', 'wiki/G/과정/구현 과정.md', 'wiki/G/도구/vitest.md',
      'wiki/G/기준/구현 완료 기준.md', 'wiki/G/기준/기획 완료 기준.md',
    ])
    expect(docs.at(-1)!.via).toBe('구현 → requires 기획 → done')
    expect(traverse(loadGraph(join(root, 'wiki', 'G'), root), 'nobody')).toEqual([])
  })

  it('프롬프트에 경로와 노드가 붙고, 그래프에 없는 역할은 단계 노트로 대신한다', () => {
    const root = vault()
    usePipelineNotes((note) => ({ path: `P/${note}.md`, text: `${note} 노트` }), (key) => traverse(loadGraph(join(root, 'wiki', 'G'), root), key))
    try {
      const dev = buildPrompt({ role: 'dev', task: { id: 't1', title: 'x', goal: 'x', acceptance: [], dependsOn: [], ownedPaths: [], testCommands: [], qaScenarios: [] } as never, worktree: 'w' })
      expect(dev).toContain('읽은 경로: 작업 · 구현 → knowledge')
      expect(dev).toContain('테스트 통과')
      expect(dev).not.toContain('04 개발 노트')
      expect(buildPrompt({ role: 'seed', spec: '', repoMap: '', rules: '' })).toContain('02 시드 노트')
    } finally { usePipelineNotes(undefined) }
  })

  it('frontmatter 목록 형식 세 가지를 읽는다', () => {
    expect(splitFrontmatter('---\na: [x, y]\nb:\n  - "z"\nc: "[[w]]"\n---\n본문').meta).toEqual({ a: ['x', 'y'], b: ['z'], c: '[[w]]' })
  })
})
