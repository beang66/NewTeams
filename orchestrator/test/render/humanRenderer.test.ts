import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  renderTimeline, renderIteration, renderIntake, renderDecisions, renderPlan, renderAll, rawLink, hhmm,
} from '../../src/render/humanRenderer.js'
import { ProjectStore } from '../../src/store/projectStore.js'
import type { Plan } from '../../src/protocol/plan.js'
import { tmpDir, rmDir, stage, paused, resumed, escalate, guidance, humanRequired, chat, report, revision, reject, approve } from '../helpers.js'

describe('humanRenderer', () => {
  it('타임라인은 중단·호출·재개를 사람이 읽는 문장으로 쓰고 원본 링크를 붙인다', () => {
    const until = '2026-10-26T14:20:00Z'
    const md = renderTimeline([stage('BUILD'), paused('rate_limit', until), resumed(), escalate('t2', 'repeat_finding')])
    expect(md).toContain(`일시정지 — 사유: 사용량 한도, 재개 예정 ${hhmm(until)}`)
    expect(md).toContain('재개')
    expect(md).toContain('단계: BUILD')
    expect(md).toContain('t2 → 마스터 호출 (같은 지적 반복)')
    expect(md).toMatch(/\(\.\.\/raw\/events\.jsonl#msg-\d{4}\)/)
  })
  it('세션/시드만 있는 STATE_CHANGE는 타임라인에서 무시', () => {
    const e = stage('BUILD'); e.payload = { session: 'x', seed: 1 }
    expect(renderTimeline([e])).not.toContain('원본')
  })
  it('iteration 문서는 회차 순으로 제출 → 반려 사유 → 수정 → 승인을 기록', () => {
    const md = renderIteration('t1', [report('t1', 1), reject('t1', 1, [{ id: 'F-1', severity: 'major', issue: '빈 입력 시 저장됨' }]), revision('t1', 2), approve('t1')])
    expect(md.indexOf('## 1회차')).toBeLessThan(md.indexOf('## 2회차'))
    expect(md).toContain('F-1 [major] 빈 입력 시 저장됨')
    expect(md).toContain('✅ 승인')
    expect(md.indexOf('✅ 승인')).toBeGreaterThan(md.indexOf('## 2회차'))
  })
  it('plan iteration은 task==="plan" 이벤트를 쓴다', () => {
    const md = renderIteration('plan', [escalate('plan', 'auth')])
    expect(md).toContain('로그인 만료')
  })
  it('intake는 CHAT만 사용자/마스터 대화록으로', () => {
    expect(renderIntake([chat('user', '할 일 앱'), chat('master', '어떤 기능이 필요하세요?'), stage('BUILD')]))
      .toBe('# 요구사항 대화\n\n**사용자:** 할 일 앱\n\n**마스터:** 어떤 기능이 필요하세요?\n')
  })
  it('decisions는 지침·호출·사람 개입·스펙 승인을 담는다', () => {
    const md = renderDecisions([stage('SPEC_APPROVED'), escalate('t2', 'reject_limit'), guidance('t2', 'retry', '범위를 줄여라', 'F-1'), humanRequired('t3', 'permission', '디렉터리 쓰기'), chat('user', 'x')])
    expect(md).toContain('스펙 승인')
    expect(md).toContain('반려 상한 도달')
    expect(md).toContain('범위를 줄여라')
    expect(md).toContain('권한 부족')
    expect(md).toContain('디렉터리 쓰기')
    expect(md).not.toContain('x\n')
  })
  it('rawLink 형식', () => {
    expect(rawLink('msg-0142')).toBe('[원본](../raw/events.jsonl#msg-0142)')
  })
  it('renderPlan은 태스크 목록과 명령을 쓴다', () => {
    const plan: Plan = { tasks: [{ id: 't1', title: '저장', deps: [], ownedFiles: ['a.ts'], difficulty: 'low', acceptance: ['저장된다'], qaScenarios: [{ id: 'q1', steps: ['열기', '저장'] }] }], testCommands: ['npm test'], devCommand: 'npm run dev' }
    const md = renderPlan(plan)
    expect(md).toContain('t1')
    expect(md).toContain('저장된다')
    expect(md).toContain('npm test')
    expect(md).toContain('npm run dev')
  })

  describe('renderAll', () => {
    let dir: string
    beforeEach(async () => { dir = await tmpDir() })
    afterEach(async () => { await rmDir(dir) })
    it('모든 문서를 human/ 아래에 쓴다', async () => {
      const store = new ProjectStore(dir)
      await store.init()
      for (const e of [chat('user', '앱'), stage('BUILD'), report('t1', 1), escalate('plan', 'auth')]) await store.appendEvent(e)
      const plan: Plan = { tasks: [], testCommands: [], devCommand: 'x' }
      await fs.writeFile(store.paths.plan, JSON.stringify(plan))
      await renderAll(store)
      for (const f of ['intake.md', 'timeline.md', 'decisions.md', 'plan.md', 'iterations/t1.md', 'iterations/plan.md']) {
        await expect(fs.stat(join(store.paths.human, f))).resolves.toBeTruthy()
      }
    })
    it('plan.json이 없으면 plan.md를 쓰지 않는다', async () => {
      const store = new ProjectStore(dir)
      await store.init()
      await store.appendEvent(chat('user', '앱'))
      await renderAll(store)
      await expect(fs.stat(join(store.paths.human, 'plan.md'))).rejects.toThrow()
    })
  })
})
